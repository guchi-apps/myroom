#!/usr/bin/env python3
"""Bambu Lab A1 mini の状態をローカルMQTTから読み、MyRoom の `/api/bambu/state` へ送る（#428）。

**読み取りのみ。印刷を操作するコマンドは送らない。** 例外は状態の再要求（`pushing.pushall`）
だけで、これが無いと全状態が手に入らない（下記）。

置き場所と実行環境
------------------
サブPCの systemd user service として**常駐**させる（`collectors/systemd/myroom-bambu.service`）。
既存の収集（Tapo・エアコン）は timer による周期実行だが、MQTT の購読は常時接続なので
service 側で持つ。ラズパイではなくサブPCなのは Tapo と同じ理由（Python 3.11 以上と
`cryptography` が要る）。

**依存は `paho-mqtt` だけで、専用の venv に入れる**（バックエンドの requirements.txt には入れない。
VPS はプリンターと同じLANにいない）。

    python3 -m venv collectors/.venv-bambu
    collectors/.venv-bambu/bin/pip install -r collectors/requirements-bambu.txt

接続方法
--------
- `bblp` ＋ LANアクセスコードで `8883`（TLS）へ繋ぎ、`device/<serial>/report` を購読する
- **LAN Only Mode は有効にしない。** クラウドへ紐付けたままローカルMQTTへ繋げる。有効にすると
  Bambuアカウントとの紐付けが切れる（Bambu Handy・クラウド送信・MakerWorld連携が使えなくなる）
- 証明書は BBL CA による自己署名。**プリンター自身の証明書を信頼の起点として渡し、ホスト名の
  検証だけを省く**（IPアドレスで繋ぐため、証明書のホスト名とは一致しない）

`pushall` が要る理由
--------------------
`report` は**差分更新**で届く。購読するだけでは初期状態が埋まらない（待機中に届く更新は
`nozzle_temper` などの数項目だけ）。接続直後に `pushall` を1回要求すると全状態（約65項目）が返る。
**P1/A1 系は更新値のみを送る作りなので、`pushall` は5分以上あけて要求する**（`PUSHALL_INTERVAL`）。
受け取った差分は `merge_report()` で1つの全状態へ重ね、MyRoom へは常に全状態を送る。

送信のしかた
------------
- 意味のある変化（状態・進捗・温度・AMS・エラー）があったとき、`MIN_POST_INTERVAL` 秒以上
  あけて送る。Wi-Fi の電波強度のような揺れだけでは送らない
- **変化が無くても `HEARTBEAT_INTERVAL` 秒ごとに送る。** MyRoom は最後の受信からの経過で
  「収集が止まっている」を判定するため、待機中に何も送らないと止まったように見える
- プリンターに繋がっていないあいだは `connected: false` だけを送る。全状態を受け取るまでは
  `connected: true` にしない（再接続直後に古い値を「いま」の値として見せないため）

ログ
----
**シリアル番号とアクセスコードはログに出さない**（`MaskingFormatter` が最終出力を伏せる）。
ファームウェア更新で項目・接続条件が変わったときに気付けるよう、次を WARNING で出す
（同じ内容は1度だけ）。

- 既知のリストに無い項目が `print` に現れた／想定している項目が全状態に無い
- `print` 以外の種別のメッセージが届いた
- 接続の失敗（TLS・認証拒否・到達不能）と、`pushall` に応答が無いこと

使い方:
  collectors/.venv-bambu/bin/python collectors/bambu_to_myroom.py
  collectors/.venv-bambu/bin/python collectors/bambu_to_myroom.py --dry-run --once 30 -v
"""

from __future__ import annotations

import argparse
import datetime
import ftplib
import io
import json
import logging
import os
import random
import signal
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ElementTree
import zipfile
from typing import Any, Callable, Dict, Optional, Sequence

try:
    import paho.mqtt.client as mqtt
except ImportError:  # pragma: no cover - サブPCの収集用 venv にだけ必要
    # **import 時には落とさない。** paho-mqtt が入っているのは収集用 venv だけで、
    # バックエンドのテスト環境には無い（tapo_to_myroom.py の python-kasa と同じ）。
    mqtt = None  # type: ignore[assignment]

LOGGER = logging.getLogger("bambu_to_myroom")

DEFAULT_API_URL = "https://myroom.gucchii.com/api/bambu/state"

JST = datetime.timezone(datetime.timedelta(hours=9))

MQTT_PORT = 8883
MQTT_USERNAME = "bblp"
KEEPALIVE_SECONDS = 60
CONNECT_TIMEOUT = 10
POST_TIMEOUT = 15

#: `pushall` を要求する間隔の下限。P1/A1 は更新値のみを送る作りで、短い間隔での要求は
#: 応答を返さなくなることがあるため5分以上あける。**再接続が続いても守る**（接続のたびに
#: 送らず、下限に満たなければ全状態の取得を待たせる）
PUSHALL_MIN_INTERVAL = 300
#: 接続中に `pushall` を取り直す間隔。取りこぼした差分を全状態で埋め直すため、下限より長めに持つ
PUSHALL_INTERVAL = 600
#: `pushall` を送ってから全状態が届くまで待つ秒数。超えたら警告を出す
PUSHALL_RESPONSE_TIMEOUT = 30
#: 全状態と見なす `print` の項目数。実機の全状態は65項目、差分は4〜5項目
FULL_REPORT_MIN_KEYS = 20

#: 変化があったときの送信間隔の下限。印刷中は毎秒のように更新が来るため、そのたびには送らない
MIN_POST_INTERVAL = 10
#: 変化が無くても送る間隔。MyRoom 側の「収集が止まっている」判定（既定180秒）の1/3
HEARTBEAT_INTERVAL = 60

#: 3mf（この造形の使用量）を読む FTPS。プリンターは 990 番の暗黙的TLSで、`bblp` ＋ アクセスコード
FTPS_PORT = 990
FTPS_TIMEOUT = 20
#: 3mf 1件の大きさの上限。実機のファイルは数百KB〜十数MB
MAX_3MF_BYTES = 100 * 1024 * 1024
#: 読めなかったときの再試行までの待ち（秒）。すべて外れたらその造形は諦める（手入力で直せる）
FETCH_RETRY_DELAYS = (5.0, 30.0, 120.0)
#: 造形の最中と見なす `gcode_state`
ACTIVE_GCODE_STATES = frozenset({"INIT", "SLICING", "PREPARE", "RUNNING", "PAUSE"})
#: 3mf の置き場所（プリンターSD）の候補。`subtask_name` は実機で `<名前>.3mf`、
#: 古い「送信して印刷」の経路では `<名前>.gcode.3mf` がルートに置かれる
THREEMF_DIRECTORIES = ("/cache", "")

#: 再接続の待ち時間（秒）。失敗のたびに倍にして上限で止める
BACKOFF_BASE = 2.0
BACKOFF_MAX = 120.0

#: 実機（A1 mini）の全状態に含まれていた `print` の項目。**ここに無い項目が現れたら
#: ファームウェアが項目を足した合図**として警告する（値の中身は見ない）
KNOWN_PRINT_KEYS = frozenset(
    """ams ams_rfid_status ams_status bed_target_temper bed_temper big_fan1_speed big_fan2_speed
    cali_version chamber_temper command cooling_fan_speed fan_gear filam_bak flag3 force_upgrade
    gcode_file gcode_file_prepare_percent gcode_state heatbreak_fan_speed hms home_flag
    hw_switch_state info ipcam k layer_num lifecycle lights_report mc_percent mc_print_line_number
    mc_print_stage mc_print_sub_stage mc_remaining_time mess_production_state msg net
    nozzle_diameter nozzle_target_temper nozzle_temper nozzle_type online print_error print_type
    profile_id project_id queue_est queue_number queue_sts queue_total s_obj sdcard sequence_id
    spd_lvl spd_mag stg stg_cur subtask_id subtask_name task_id total_layer_num upgrade_state
    upload vt_tray wifi_signal xcam""".split()
)
KNOWN_TOP_LEVEL_KEYS = frozenset({"print"})

#: MyRoom の正規化が読む項目（`backend/bambu.py` の `EXPECTED_KEYS` と同じ）。
#: 全状態に無ければ項目名が変わった疑いがある
EXPECTED_KEYS = (
    "gcode_state",
    "mc_percent",
    "mc_remaining_time",
    "layer_num",
    "total_layer_num",
    "subtask_name",
    "nozzle_temper",
    "nozzle_target_temper",
    "bed_temper",
    "bed_target_temper",
    "spd_lvl",
    "print_error",
    "hms",
    "ams",
)

#: 「送るに値する変化」を判定する項目。温度は1℃刻みに丸める（加熱中の小数の揺れで毎回送らない）
TEMPERATURE_KEYS = ("nozzle_temper", "bed_temper")
SIGNIFICANT_KEYS = (
    "gcode_state",
    "mc_percent",
    "mc_remaining_time",
    "layer_num",
    "total_layer_num",
    "subtask_name",
    "nozzle_target_temper",
    "bed_target_temper",
    "spd_lvl",
    "print_error",
    "hms",
    "ams",
    "vt_tray",
)


class ConfigError(Exception):
    """環境変数が足りない・壊れている。"""


# ---------------------------------------------------------------- 設定


def load_env_file(path: str) -> Dict[str, str]:
    """`KEY=value` 形式を読む簡易パーサ。

    `tapo_to_myroom.py` にも同じものがある（片方だけの都合で直さないこと）。
    """
    values: Dict[str, str] = {}
    if not os.path.isfile(path) or not os.access(path, os.R_OK):
        return values

    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export ") :].strip()
            key, sep, value = line.partition("=")
            if not sep:
                continue
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            if key:
                values[key] = value
    return values


def apply_env_files(paths: Sequence[str]) -> None:
    """先に挙げたファイルを優先して環境変数へ載せる（既存の環境変数は上書きしない）。"""
    for path in paths:
        for key, value in load_env_file(path).items():
            os.environ.setdefault(key, value)


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ConfigError(f"環境変数 {name} が設定されていません")
    return value


def load_config() -> Dict[str, str]:
    return {
        "host": _require_env("BAMBU_HOST"),
        "serial": _require_env("BAMBU_SERIAL"),
        "access_code": _require_env("BAMBU_ACCESS_CODE"),
        "api_url": os.getenv("MYROOM_BAMBU_API_URL", DEFAULT_API_URL).strip(),
    }


# ---------------------------------------------------------------- ログ


class MaskingFormatter(logging.Formatter):
    """最終的なログ出力から秘密の値を伏せる。

    メッセージへ渡し忘れたものだけでなく、例外のトレースバックやライブラリ（paho）が
    出す文字列に紛れ込んだ値も対象にするため、`Formatter` で整形したあとに置き換える。
    トピック名にはシリアル番号が含まれる。
    """

    def __init__(self, secrets: Sequence[str], fmt: Optional[str] = None) -> None:
        super().__init__(fmt)
        # 短すぎる値は無関係な文字列まで潰すので対象にしない
        self._secrets = [s for s in secrets if s and len(s) >= 4]

    def format(self, record: logging.LogRecord) -> str:
        return mask_secrets(super().format(record), self._secrets)


def mask_secrets(text: str, secrets: Sequence[str]) -> str:
    for secret in secrets:
        text = text.replace(secret, "***")
    return text


# ---------------------------------------------------------------- 状態のマージ


def _merge_value(current: Any, update: Any) -> Any:
    """`update` を `current` へ重ねる。

    - 辞書は項目ごとに再帰する（`ams` のように入れ子で差分が来る）
    - `id` を持つ辞書のリスト（AMS のユニット・トレイ）は `id` で突き合わせて重ねる。
      差分に載ったトレイだけが来ても、他のトレイを消さない
    - それ以外（`hms` のような配列・スカラー）は置き換える
    """
    if isinstance(current, dict) and isinstance(update, dict):
        return merge_report(current, update)
    if _is_id_list(current) and _is_id_list(update):
        merged = [dict(item) for item in current]
        index = {str(item["id"]): i for i, item in enumerate(merged)}
        for item in update:
            key = str(item["id"])
            if key in index:
                merged[index[key]] = _merge_value(merged[index[key]], item)
            else:
                index[key] = len(merged)
                merged.append(item)
        return merged
    return update


def _is_id_list(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) > 0
        and all(isinstance(item, dict) and "id" in item for item in value)
    )


def merge_report(current: Dict[str, Any], update: Dict[str, Any]) -> Dict[str, Any]:
    """差分の `print` を、これまでの全状態へ重ねた新しい辞書を返す（引数は書き換えない）。"""
    merged = dict(current)
    for key, value in update.items():
        merged[key] = _merge_value(merged.get(key), value) if key in merged else value
    return merged


def significant_view(report: Dict[str, Any]) -> str:
    """「送るに値する変化」だけを取り出した比較用の文字列。"""
    view: Dict[str, Any] = {}
    for key in SIGNIFICANT_KEYS:
        if key in report:
            view[key] = report[key]
    for key in TEMPERATURE_KEYS:
        value = report.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            view[key] = round(value)
    return json.dumps(view, sort_keys=True, ensure_ascii=False)


def build_payload(
    connected: bool,
    report: Optional[Dict[str, Any]],
    last_message_at: Optional[datetime.datetime],
    job_filament: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "connected": connected,
        "last_message_at": last_message_at.astimezone(JST).isoformat(timespec="seconds")
        if last_message_at
        else None,
    }
    # 繋がっていないときは古い全状態を載せない（MyRoom は保存済みの状態を残す）
    if connected and report is not None:
        payload["report"] = report
        # 3mf から読めたときだけ（#454）。読めていないときは項目ごと省く
        if job_filament is not None:
            payload["job_filament"] = job_filament
    return payload


# ---------------------------------------------------------------- 再接続


def backoff_delay(
    attempt: int,
    rng: Callable[[], float] = random.random,
    base: float = BACKOFF_BASE,
    maximum: float = BACKOFF_MAX,
) -> float:
    """再接続までの待ち時間（秒）。`attempt` は0始まりの連続失敗回数。

    倍々に伸ばして `maximum` で止め、±20%のゆらぎを付ける（プリンターの再起動直後に
    毎回同じ間隔で叩き続けない）。
    """
    delay = min(maximum, base * (2 ** max(attempt, 0)))
    return delay * (0.8 + 0.4 * rng())


# ---------------------------------------------------------------- 監視の状態


class BambuMonitor:
    """届いた `report` を全状態へ重ね、送信のタイミングと異常の検知を持つ。

    MQTT にも HTTP にも触らない（テストできるようにするため）。
    """

    def __init__(self, now: Callable[[], float] = time.time) -> None:
        self._now = now
        self._lock = threading.Lock()
        self.report: Dict[str, Any] = {}
        self.last_message_at: Optional[datetime.datetime] = None
        #: この接続で全状態を受け取ったか。受け取るまでは connected を true にしない
        self.full_received = False
        #: 最後に pushall を要求した時刻。接続をまたいで持つ（再接続の連発で間隔を割らないため）
        self.last_pushall_at: Optional[float] = None
        self._sent_view: Optional[str] = None
        self._warned: set = set()
        #: いまの（直近の）造形。開始を検出するたびに作り直す（#454）
        self._job: Optional[Dict[str, Any]] = None
        self._job_active = False
        #: 3mf から読めたこの造形の使用量。読めるまで、また造形が変わるまでは None
        self.job_filament: Optional[Dict[str, Any]] = None
        self._sent_job_filament: Optional[Dict[str, Any]] = None

    def new_session(self) -> None:
        """接続し直したとき。全状態はもう一度 pushall で受け取り直す。"""
        with self._lock:
            self.full_received = False

    def _warn_once(self, key: str, message: str, *args: Any) -> None:
        if key in self._warned:
            return
        self._warned.add(key)
        LOGGER.warning(message, *args)

    def pushall_allowed(self) -> bool:
        with self._lock:
            return (
                self.last_pushall_at is None
                or self._now() - self.last_pushall_at >= PUSHALL_MIN_INTERVAL
            )

    def mark_pushall(self) -> None:
        with self._lock:
            self.last_pushall_at = self._now()

    def handle_message(self, raw: bytes) -> bool:
        """MQTT のメッセージ1件を取り込む。`print` の全状態・差分なら True。"""
        try:
            message = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            self._warn_once("bad-json", "Bambu: JSON として読めないメッセージを受け取りました")
            return False
        if not isinstance(message, dict):
            return False

        unknown_top = sorted(set(message) - KNOWN_TOP_LEVEL_KEYS)
        if unknown_top:
            self._warn_once(
                "top:" + ",".join(unknown_top),
                "Bambu: print 以外の種別のメッセージを受け取りました（無視します）: %s",
                ", ".join(unknown_top),
            )

        update = message.get("print")
        if not isinstance(update, dict):
            return False
        # push_status 以外（コマンドへの応答など）は状態ではない
        if update.get("command", "push_status") != "push_status":
            return False

        new_keys = sorted(set(update) - KNOWN_PRINT_KEYS)
        if new_keys:
            self._warn_once(
                "keys:" + ",".join(new_keys),
                "Bambu: 既知のリストに無い項目が届きました（ファームウェア更新で項目が増えた可能性）: %s",
                ", ".join(new_keys),
            )

        with self._lock:
            self.report = merge_report(self.report, update)
            self.last_message_at = datetime.datetime.now(JST)
            self._track_job_locked()
            if len(update) >= FULL_REPORT_MIN_KEYS and not self.full_received:
                self.full_received = True
                missing = [key for key in EXPECTED_KEYS if key not in self.report]
                if missing:
                    self._warn_once(
                        "missing:" + ",".join(missing),
                        "Bambu: 全状態に想定している項目がありません"
                        "（項目名が変わった可能性）: %s",
                        ", ".join(missing),
                    )
        return True

    def has_change(self) -> bool:
        """最後に送った内容から、送るに値する変化があるか。"""
        with self._lock:
            return self.full_received and (
                significant_view(self.report) != self._sent_view
                or self.job_filament != self._sent_job_filament
            )

    def snapshot(self, mqtt_connected: bool) -> Dict[str, Any]:
        """いま送るペイロード。全状態を受け取るまでは connected を false にする。"""
        with self._lock:
            connected = mqtt_connected and self.full_received
            return build_payload(
                connected, dict(self.report), self.last_message_at, self.job_filament
            )

    def mark_sent(self) -> None:
        with self._lock:
            self._sent_view = significant_view(self.report)
            self._sent_job_filament = self.job_filament

    # ---- 造形ごとの使用量（3mf）

    def _track_job_locked(self) -> None:
        """造形の開始を検出する。**開始のたびに新しい `key` を作る**（同じファイルの再印刷も別の造形）。

        名前（`subtask_name`）が届く前は始めない。接続直後の差分には状態だけが来て名前が無いことがある。
        造形が終わっても `job_filament` は消さない（完了の瞬間に MyRoom へ渡すのに要る）。
        次の造形が始まったときに作り直す。
        """
        active = self.report.get("gcode_state") in ACTIVE_GCODE_STATES
        if not active:
            self._job_active = False
            return
        raw_name = self.report.get("subtask_name")
        name = raw_name.strip() if isinstance(raw_name, str) else ""
        if not name:
            return
        if self._job_active and self._job is not None and self._job["name"] == name:
            return
        self._job_active = True
        started = datetime.datetime.fromtimestamp(self._now(), JST).isoformat(timespec="seconds")
        self._job = {
            "key": f"{name}@{started}",
            "name": name,
            "attempts": 0,
            "next_at": 0.0,
            "fetching": False,
            "done": False,
        }
        self.job_filament = None

    def take_fetch_request(self) -> Optional[Dict[str, str]]:
        """3mf を読みに行くべきなら、その造形の `key` と `name` を返す（読み込み中は返さない）。"""
        with self._lock:
            job = self._job
            if job is None or job["done"] or job["fetching"] or self._now() < job["next_at"]:
                return None
            job["fetching"] = True
            return {"key": job["key"], "name": job["name"]}

    def finish_fetch(self, key: str, filaments: Optional[list]) -> bool:
        """3mf の読み込みの結果を受け取る。**この造形の結果として受け取れたら True。**

        読めなかったときは間隔を空けて再試行し、`FETCH_RETRY_DELAYS` を使い切ったら諦める。
        そのあいだに造形が変わっていたら（`key` が違う）捨てる。
        """
        with self._lock:
            job = self._job
            if job is None or job["key"] != key:
                return False
            job["fetching"] = False
            if filaments:
                job["done"] = True
                self.job_filament = {"job_key": job["key"], "name": job["name"], "filaments": filaments}
                return True
            job["attempts"] += 1
            if job["attempts"] > len(FETCH_RETRY_DELAYS):
                job["done"] = True
                self._warn_once(
                    "3mf-giveup:" + job["key"],
                    "Bambu: 3mf から使用量を読めませんでした（この造形は在庫へ自動では引かれません）: %s",
                    job["name"],
                )
            else:
                job["next_at"] = self._now() + FETCH_RETRY_DELAYS[job["attempts"] - 1]
            return False


# ---------------------------------------------------------------- 送信


def post_payload(api_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        api_url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(request, timeout=POST_TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


class Poster:
    """送信の失敗で常駐を止めない。連続失敗は最初の1回だけ WARNING にする。"""

    def __init__(self, api_url: str, dry_run: bool) -> None:
        self._api_url = api_url
        self._dry_run = dry_run
        self._failing = False

    def send(self, payload: Dict[str, Any]) -> bool:
        if self._dry_run:
            report = payload.get("report") or {}
            LOGGER.info(
                "[dry-run] connected=%s gcode_state=%s mc_percent=%s layer=%s/%s "
                "nozzle=%s/%s bed=%s/%s（%d項目）",
                payload["connected"],
                report.get("gcode_state"),
                report.get("mc_percent"),
                report.get("layer_num"),
                report.get("total_layer_num"),
                report.get("nozzle_temper"),
                report.get("nozzle_target_temper"),
                report.get("bed_temper"),
                report.get("bed_target_temper"),
                len(report),
            )
            if payload.get("job_filament"):
                LOGGER.info("[dry-run] job_filament=%s", json.dumps(payload["job_filament"], ensure_ascii=False))
            return True
        try:
            post_payload(self._api_url, payload)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            if not self._failing:
                LOGGER.warning("MyRoom への送信に失敗しました（次回以降は再試行）: %s", exc)
            self._failing = True
            return False
        if self._failing:
            LOGGER.info("MyRoom への送信が回復しました")
        self._failing = False
        return True


# ---------------------------------------------------------------- 3mf（造形の使用量）


class ImplicitFTPTLS(ftplib.FTP_TLS):
    """暗黙的TLS（接続した瞬間からTLS）の FTPS。プリンターは 990 番でこの形。

    標準の `FTP_TLS` は明示的（`AUTH TLS`）しか話せないので、接続とデータ接続を差し替える。
    """

    def connect(self, host="", port=0, timeout=-999, source_address=None):  # type: ignore[override]
        if host:
            self.host = host
        if port:
            self.port = port
        if timeout != -999:
            self.timeout = timeout
        self.sock = socket.create_connection((self.host, self.port), self.timeout)
        self.af = self.sock.family
        self.sock = self.context.wrap_socket(self.sock, server_hostname=self.host)
        self.file = self.sock.makefile("r", encoding=self.encoding)
        self.welcome = self.getresp()
        return self.welcome

    def ntransfercmd(self, cmd, rest=None):  # type: ignore[override]
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            conn = self.context.wrap_socket(
                conn, server_hostname=self.host, session=self.sock.session
            )
        return conn, size


def threemf_paths(name: str) -> list:
    """`subtask_name` から、プリンターSDの3mfの置き場所の候補を作る。

    ファイル名として使えない名前（ディレクトリを抜ける・制御文字）は候補にしない。
    プリンターから届いた文字列をそのままFTPのコマンドへ入れないため。
    """
    if not name or name.startswith(".") or any(c in name for c in '/\\\r\n\x00'):
        return []
    names = [name]
    if name.endswith(".3mf"):
        if not name.endswith(".gcode.3mf"):
            names.append(name[: -len(".3mf")] + ".gcode.3mf")
    else:
        names += [name + ".3mf", name + ".gcode.3mf"]
    return [f"{directory}/{candidate}" for directory in THREEMF_DIRECTORIES for candidate in names]


def parse_slice_info(text: str) -> Optional[list]:
    """`Metadata/slice_info.config`（XML）から、使うフィラメントの一覧を取る。

    `<filament id="1" type="PLA" color="#BCBCBC" used_g="24.41" .../>`。**プレートが1つでないときは
    None**（どのプレートを印刷したのか分からない。送信のときは1プレートだけが入る）。
    """
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError:
        return None
    plates = root.findall("plate")
    if len(plates) != 1:
        return None
    filaments = []
    for item in plates[0].findall("filament"):
        try:
            used = float(item.get("used_g", ""))
        except ValueError:
            continue
        if used <= 0 or used != used:
            continue
        try:
            slot = int(item.get("id", ""))
        except ValueError:
            slot = None
        filaments.append(
            {"id": slot, "type": item.get("type"), "color": item.get("color"), "used_g": used}
        )
    return filaments or None


def read_filaments_from_3mf(data: bytes) -> Optional[list]:
    """3mf（zip）の `Metadata/slice_info.config` を読む。壊れた zip・中身が無いときは None。"""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            info = archive.getinfo("Metadata/slice_info.config")
            if info.file_size > 1024 * 1024:
                return None
            return parse_slice_info(archive.read(info).decode("utf-8", "replace"))
    except (zipfile.BadZipFile, KeyError):
        return None


def download_3mf(host: str, access_code: str, paths: Sequence[str]) -> Optional[bytes]:
    """プリンターSDから3mfを読む（**読み取りのみ**）。候補の順に試し、最初に見つかったものを返す。"""
    context = build_tls_context(fetch_printer_certificate(host, FTPS_PORT))
    ftp = ImplicitFTPTLS(context=context)
    try:
        ftp.connect(host, FTPS_PORT, timeout=FTPS_TIMEOUT)
        ftp.login(MQTT_USERNAME, access_code)
        ftp.prot_p()
        for path in paths:
            buffer = io.BytesIO()

            def receive(chunk: bytes) -> None:
                if buffer.tell() + len(chunk) > MAX_3MF_BYTES:
                    raise ValueError("3mf が大きすぎます")
                buffer.write(chunk)

            try:
                ftp.retrbinary(f"RETR {path}", receive)
            except ftplib.error_perm:  # 550: その場所には無い
                continue
            return buffer.getvalue()
        return None
    finally:
        try:
            ftp.quit()
        except Exception:  # すでに切れている
            ftp.close()


def fetch_job_filaments(config: Dict[str, str], name: str) -> Optional[list]:
    """この造形の使用量を、プリンターSDの3mfから読む。読めなければ None（理由はログへ）。"""
    paths = threemf_paths(name)
    if not paths:
        LOGGER.warning("Bambu: 3mf のファイル名として使えない名前です（読みません）")
        return None
    try:
        data = download_3mf(config["host"], config["access_code"], paths)
    except (OSError, ftplib.Error, ValueError) as exc:
        LOGGER.info("Bambu: 3mf を読めませんでした: %s", classify_connect_error(exc))
        return None
    if data is None:
        LOGGER.info("Bambu: プリンターSDに 3mf が見つかりませんでした（クラウド経由の印刷など）")
        return None
    filaments = read_filaments_from_3mf(data)
    if filaments is None:
        LOGGER.info("Bambu: 3mf から使用量を読めませんでした（複数プレート・フィラメント情報なし）")
    return filaments


# ---------------------------------------------------------------- MQTT


def fetch_printer_certificate(host: str, port: int = MQTT_PORT) -> str:
    """プリンター自身の証明書（PEM）を取る。BBL CA の自己署名なので、これを信頼の起点にする。"""
    return ssl.get_server_certificate((host, port), timeout=CONNECT_TIMEOUT)


def build_tls_context(pem: str) -> ssl.SSLContext:
    """プリンターの証明書だけを信頼し、ホスト名の検証は省く（IPで繋ぐため）。

    証明書は検証する（`CERT_REQUIRED`）ので、繋ぎ先が別の機器なら失敗する。
    プリンターが送ってくる証明書は末端のもので、発行元（BBL CA）は付いてこないため、
    末端を信頼の起点にできる `VERIFY_X509_PARTIAL_CHAIN` が要る。
    """
    context = ssl.create_default_context(cadata=pem)
    context.check_hostname = False
    context.verify_flags |= getattr(ssl, "VERIFY_X509_PARTIAL_CHAIN", 0)
    return context


def pushall_message() -> str:
    """状態の再要求。**印刷を操作するものではない**（読み取りのための唯一の送信）。"""
    return json.dumps(
        {"pushing": {"sequence_id": "0", "command": "pushall", "version": 1, "push_target": 1}}
    )


def classify_connect_error(exc: BaseException) -> str:
    """接続の失敗を、見る場所が分かる言葉にする。"""
    if isinstance(exc, ssl.SSLCertVerificationError):
        return "TLS の証明書検証に失敗しました（繋ぎ先がプリンターではない／証明書が変わった可能性）"
    if isinstance(exc, ssl.SSLError):
        return "TLS の接続に失敗しました"
    if isinstance(exc, (TimeoutError, ConnectionRefusedError)):
        return "接続できません（プリンターの電源・BAMBU_HOST の IP アドレスを確認）"
    if isinstance(exc, OSError):
        return "ネットワークに接続できません（プリンターの電源・LAN・BAMBU_HOST を確認）"
    return "接続に失敗しました"


class Session:
    """1回の接続。切れたら `run()` が返る。"""

    def __init__(
        self,
        config: Dict[str, str],
        monitor: BambuMonitor,
        poster: Poster,
        stop: threading.Event,
    ) -> None:
        self._config = config
        self._monitor = monitor
        self._poster = poster
        self._stop = stop
        self._connected = threading.Event()
        self._closed = threading.Event()
        self._refused: Optional[str] = None
        self._pushall_sent_at: Optional[float] = None
        self._pushall_warned = False
        self._pushall_requested = False
        #: 直近に MyRoom へ送れた connected の値
        self._sent_connected = False
        self.got_message = False
        self._client: Any = None

    # paho のコールバック（別スレッド）
    def _on_connect(self, client, _userdata, _flags, reason_code, _properties=None):
        if getattr(reason_code, "is_failure", False):
            self._refused = str(reason_code)
            self._closed.set()
            return
        client.subscribe(f"device/{self._config['serial']}/report")
        self._connected.set()

    def _on_message(self, _client, _userdata, message):
        if self._monitor.handle_message(message.payload):
            self.got_message = True

    def _on_disconnect(self, _client, _userdata, *_args):
        self._connected.clear()
        self._closed.set()

    def _request_pushall(self, client) -> None:
        client.publish(f"device/{self._config['serial']}/request", pushall_message())
        self._monitor.mark_pushall()
        self._pushall_sent_at = time.time()
        self._pushall_warned = False
        self._pushall_requested = True

    def _start_job_filament_fetch(self) -> None:
        """造形が始まっていて使用量をまだ読めていなければ、別スレッドで3mfを読みに行く（#454）。

        FTPS は数秒かかり得るので、状態の送信（ハートビート）を止めないよう別スレッドにする。
        """
        request = self._monitor.take_fetch_request()
        if request is None:
            return

        def work() -> None:
            filaments: Optional[list] = None
            try:
                filaments = fetch_job_filaments(self._config, request["name"])
            except Exception:  # 使用量が読めないだけで、状態の収集は止めない
                LOGGER.exception("Bambu: 3mf の読み込みで想定外のエラーが起きました")
            if self._monitor.finish_fetch(request["key"], filaments):
                LOGGER.info(
                    "Bambu: 造形の使用量を読みました（%.1f g）: %s",
                    sum(item["used_g"] for item in filaments or []),
                    request["name"],
                )

        threading.Thread(target=work, name="bambu-3mf", daemon=True).start()

    def run(self, once_seconds: Optional[float] = None) -> str:
        """接続して、切れる・止められるまで回す。戻り値は終了の理由。"""
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, protocol=mqtt.MQTTv311)
        self._client = client
        client.username_pw_set(MQTT_USERNAME, self._config["access_code"])
        client.tls_set_context(build_tls_context(fetch_printer_certificate(self._config["host"])))
        client.on_connect = self._on_connect
        client.on_message = self._on_message
        client.on_disconnect = self._on_disconnect
        # 再接続は外側のループ（バックオフ付き）に任せる
        client.reconnect_delay_set(min_delay=1, max_delay=1)

        self._monitor.new_session()
        started = time.time()
        client.connect(self._config["host"], MQTT_PORT, KEEPALIVE_SECONDS)
        client.loop_start()
        last_post = 0.0
        try:
            while not self._stop.is_set() and not self._closed.is_set():
                self._stop.wait(1.0)
                now = time.time()
                if once_seconds is not None and now - started >= once_seconds:
                    return "once"
                if not self._connected.is_set():
                    if now - started > CONNECT_TIMEOUT:
                        return "connect-timeout"
                    continue

                # 接続直後の1回と、接続中の定期的な取り直し。どちらも下限（5分）を割らない。
                # 下限に満たない再接続では、間隔が空くまで全状態を待つ（そのあいだ connected は false）
                last_pushall = self._monitor.last_pushall_at
                needs_first = not self._pushall_requested
                needs_refresh = last_pushall is not None and now - last_pushall >= PUSHALL_INTERVAL
                if (needs_first or needs_refresh) and self._monitor.pushall_allowed():
                    self._request_pushall(client)
                if (
                    self._pushall_sent_at is not None
                    and not self._pushall_warned
                    and not self._monitor.full_received
                    and now - self._pushall_sent_at > PUSHALL_RESPONSE_TIMEOUT
                ):
                    self._pushall_warned = True
                    LOGGER.warning(
                        "Bambu: pushall に %d 秒たっても応答がありません"
                        "（要求の間隔が短すぎる／ファームウェアの仕様変更の可能性）",
                        PUSHALL_RESPONSE_TIMEOUT,
                    )

                self._start_job_filament_fetch()

                due_heartbeat = now - last_post >= HEARTBEAT_INTERVAL
                due_change = (
                    self._monitor.has_change() and now - last_post >= MIN_POST_INTERVAL
                )
                # 全状態が届いて「繋がった」に変わった瞬間は、間隔を待たずに伝える
                # （接続直後の最初の送信は全状態の到着前で、connected: false のまま残るため）
                due_connected = self._monitor.full_received and not self._sent_connected
                if due_heartbeat or due_change or due_connected:
                    payload = self._monitor.snapshot(True)
                    if self._poster.send(payload):
                        self._monitor.mark_sent()
                        self._sent_connected = payload["connected"]
                    last_post = now
            return "stopped" if self._stop.is_set() else "disconnected"
        finally:
            client.loop_stop()
            try:
                client.disconnect()
            except Exception:  # 切断の失敗は握りつぶす（すでに切れている）
                pass

    @property
    def refused(self) -> Optional[str]:
        return self._refused


# ---------------------------------------------------------------- 常駐ループ


def run_forever(
    config: Dict[str, str],
    dry_run: bool,
    once_seconds: Optional[float],
    stop: threading.Event,
) -> int:
    monitor = BambuMonitor()
    poster = Poster(config["api_url"], dry_run)
    attempt = 0
    last_reason = ""

    while not stop.is_set():
        session = Session(config, monitor, poster, stop)
        try:
            reason = session.run(once_seconds)
            error: Optional[BaseException] = None
        except Exception as exc:  # 接続前後の失敗（TLS・到達不能）。常駐は止めない
            reason, error = "error", exc

        if reason in ("stopped", "once"):
            return 0

        if session.got_message:
            attempt = 0  # ちゃんと繋がっていた接続が切れただけなら、待たずに近い間隔で再接続する
        message = describe_failure(reason, error, session.refused)
        # 同じ理由が続くあいだは、最初の1回と10回ごとだけ WARNING にする（ログを埋めない）
        repeated = message == last_reason
        if not repeated or attempt % 10 == 0:
            LOGGER.warning("Bambu: %s（%d回目・再接続します）", message, attempt + 1)
        else:
            LOGGER.debug("Bambu: %s（%d回目）", message, attempt + 1)
        last_reason = message

        # 切れたことを MyRoom へ伝える（次の全状態が来るまで「オンライン」にしない）
        poster.send(monitor.snapshot(False))

        delay = backoff_delay(attempt)
        attempt += 1
        # 待つあいだも、収集が生きていることが伝わるよう定期的に送る
        waited = 0.0
        while waited < delay and not stop.is_set():
            step = min(1.0, delay - waited)
            stop.wait(step)
            waited += step
            if int(waited) % HEARTBEAT_INTERVAL == 0 and waited >= HEARTBEAT_INTERVAL:
                poster.send(monitor.snapshot(False))
    return 0


def describe_failure(reason: str, error: Optional[BaseException], refused: Optional[str]) -> str:
    if refused:
        return (
            "MQTT の接続が拒否されました（%s）。LAN アクセスコードが変わった可能性があります"
            "（プリンター本体の画面で確認）" % refused
        )
    if error is not None:
        return classify_connect_error(error)
    if reason == "connect-timeout":
        return "MQTT の接続確立が %d 秒以内に完了しませんでした" % CONNECT_TIMEOUT
    return "プリンターとの接続が切れました"


# ---------------------------------------------------------------- CLI


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bambu Lab A1 mini の状態をローカルMQTTから読んで MyRoom へ送る（読み取りのみ）"
    )
    parser.add_argument("--dry-run", action="store_true", help="読み取るだけで POST しない")
    parser.add_argument(
        "--once",
        type=float,
        metavar="SECONDS",
        help="指定秒数だけ接続して終了する（動作確認用。省略時は常駐する）",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="詳細ログを出す")
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    apply_env_files(
        [os.path.join(script_dir, ".env"), os.path.join(os.path.dirname(script_dir), ".env")]
    )

    try:
        config = load_config()
    except ConfigError as exc:
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
        LOGGER.error("%s", exc)
        LOGGER.error("collectors/bambu.env.example を参照してください。")
        return 2

    handler = logging.StreamHandler()
    handler.setFormatter(
        MaskingFormatter(
            [config["serial"], config["access_code"]], "%(asctime)s %(levelname)s %(message)s"
        )
    )
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO, handlers=[handler], force=True
    )

    if mqtt is None:
        LOGGER.error(
            "paho-mqtt が見つかりません。"
            "`collectors/.venv-bambu/bin/pip install -r collectors/requirements-bambu.txt` "
            "を実行し、その venv の python で動かしてください。"
        )
        return 2

    stop = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: stop.set())

    LOGGER.info("Bambu 収集を開始します（送り先: %s）", "dry-run" if args.dry_run else config["api_url"])
    return run_forever(config, args.dry_run, args.once, stop)


if __name__ == "__main__":
    raise SystemExit(main())
