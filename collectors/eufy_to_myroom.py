#!/usr/bin/env python3
"""eufy Clean（ロボット掃除機）の状態を LAN 経由で読んで MyRoom の `/api/cleaner` へ送る。

**観測のみ。起動・停止・帰還などの操作は一切しない。** 知りたいのは「いつ動いたか」だけで、
制御を足すとコマンドの経路・失敗時の扱い・二重起動の防止まで面倒を見ることになるため。

サブPCの systemd user timer から3分ごとに実行する想定
（`collectors/systemd/myroom-eufy-cleaner.timer`）。MyRoom 側は**状態が変わったときだけ**
行を足すので、同じ状態のあいだ何度送っても履歴は汚れない。

置き場所と実行環境
------------------
eufy Clean と同じ LAN にいるサブPCで動かす。Anker の公式パブリックAPIが無く、
Tuya のローカルプロトコル（TCP 6668）で機器を直接読むため、外からは届かない。

**このディレクトリの他の収集スクリプトと違い、依存が要る。** `tinytuya` はサブPCの
システムPythonに入っていないので、専用の venv を作って使う
（`collectors/requirements-cleaner.txt`）。

    python3 -m venv collectors/.venv-cleaner
    collectors/.venv-cleaner/bin/pip install -r collectors/requirements-cleaner.txt

local key が要る
----------------
**Tuya のローカルプロトコルは device_id と local_key の両方が無いと復号できない。**
local key はアプリからは見えず、Tuya IoT 開発者アカウントを作って API Explorer
（または `tinytuya wizard`）で取り出す。この作業だけは人がブラウザで行う必要がある。
手順は `collectors/README.md` を参照。

DP（データポイント）の番号は機種で違う
--------------------------------------
Tuya は状態を「DP番号 → 値」の辞書で返す。eufy の場合、稼働状態は `15`、バッテリー残量は
`104` であることが多いが、**機種とファームで変わる。** そのため番号は環境変数で上書きでき、
`--dump` で実機が返す辞書をそのまま表示できるようにしてある。番号が違っていたら
`--dump` の出力を見て `EUFY_STATUS_DP` / `EUFY_BATTERY_DP` を設定する。

状態名の読み替えはサーバー側（`backend/cleaner.py` の `EVENT_ALIASES`）に置いている。
ここでは小文字にするだけで、`Recharge` のような機種ごとの言い回しは MyRoom 側で吸収する。

使い方:
  collectors/.venv-cleaner/bin/python collectors/eufy_to_myroom.py
  collectors/.venv-cleaner/bin/python collectors/eufy_to_myroom.py --scan
  collectors/.venv-cleaner/bin/python collectors/eufy_to_myroom.py --dump
  collectors/.venv-cleaner/bin/python collectors/eufy_to_myroom.py --dry-run -v
"""

from __future__ import annotations

import argparse
import datetime
import json
import logging
import os
import os.path
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, Sequence

try:
    import tinytuya
except ImportError:  # pragma: no cover - サブPCの実行環境にだけ必要
    # **import 時には落とさない。** tinytuya が入っているのはサブPCの収集用 venv
    # だけで、バックエンドのテスト環境には無い。ここで SystemExit すると
    # `pytest tests/` がこのモジュールを収集した時点で失敗する。
    tinytuya = None  # type: ignore[assignment]


LOGGER = logging.getLogger("eufy_to_myroom")

#: 送り先。`collectors/tapo_to_myroom.py` と同じ作法で環境変数から上書きできる
DEFAULT_API_URL = "https://myroom.gucchii.com/api/cleaner"

#: JST。MyRoom は JST の naive な日時で揃えている（backend/main.py の `get_now_jst()`）
JST = datetime.timezone(datetime.timedelta(hours=9))

#: 稼働状態の DP。eufy の多くの機種はここに `standby` / `Running` などの文字列を返す
DEFAULT_STATUS_DP = "15"

#: バッテリー残量（%）の DP
DEFAULT_BATTERY_DP = "104"

#: Tuya のプロトコル版。eufy はおおむね 3.3
DEFAULT_PROTOCOL_VERSION = "3.3"

CONNECT_TIMEOUT = 8
POST_TIMEOUT = 15
SCAN_TIMEOUT = 18


class ConfigError(Exception):
    """環境変数が足りない・壊れている。"""


class ReadError(Exception):
    """機器から状態を読めなかった。"""


# ---------------------------------------------------------------- 設定


def load_env_file(path: str) -> Dict[str, str]:
    """`KEY=value` 形式を読む簡易パーサ。

    `python-dotenv` はサブPCのシステムPythonに入っていない。ここで要るのは数行の
    `KEY=value` だけなので、依存を増やさず自前で読む。
    （`collectors/tapo_to_myroom.py` にも同じものがある。片方だけの都合で直さないこと。）
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


def load_config(require_device: bool = True) -> Dict[str, Any]:
    """設定を環境変数から組み立てる。

    **`--scan` のときは機器の情報を必須にしない。** あれは「まだ IP も device_id も
    分からない」初回設定のための機能で、そこで要求すると一番必要な場面で使えない。
    """
    if require_device:
        device_id = _require_env("EUFY_DEVICE_ID")
        local_key = _require_env("EUFY_LOCAL_KEY")
        host = _require_env("EUFY_IP")
    else:
        device_id = os.getenv("EUFY_DEVICE_ID", "").strip()
        local_key = os.getenv("EUFY_LOCAL_KEY", "").strip()
        host = os.getenv("EUFY_IP", "").strip()

    return {
        "device_id": device_id,
        "local_key": local_key,
        "host": host,
        "version": os.getenv("EUFY_VERSION", DEFAULT_PROTOCOL_VERSION).strip()
        or DEFAULT_PROTOCOL_VERSION,
        "status_dp": os.getenv("EUFY_STATUS_DP", DEFAULT_STATUS_DP).strip()
        or DEFAULT_STATUS_DP,
        "battery_dp": os.getenv("EUFY_BATTERY_DP", DEFAULT_BATTERY_DP).strip()
        or DEFAULT_BATTERY_DP,
        "api_url": os.getenv("MYROOM_CLEANER_API_URL", DEFAULT_API_URL).strip(),
    }


# ---------------------------------------------------------------- 機器の読み取り


def extract_event(dps: Dict[str, Any], status_dp: str) -> str:
    """状態のDPから `cleaning` などの元になる文字列を取り出す。

    値が真偽値で返る機種（掃除中かどうかだけを返すもの）にも当たれるよう、
    True/False も読み替える。読み替えの本体は MyRoom 側にある。
    """
    if status_dp not in dps:
        raise ReadError(
            f"状態のDP {status_dp} が見つかりません。--dump で実機の値を確認し、"
            "EUFY_STATUS_DP を設定してください"
        )

    value = dps[status_dp]
    if isinstance(value, bool):
        return "cleaning" if value else "docked"

    event = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    if not event:
        raise ReadError(f"状態のDP {status_dp} が空です")
    return event


def extract_battery(dps: Dict[str, Any], battery_dp: str) -> Optional[int]:
    """バッテリー残量（%）。取れなければ None（残量が無くても稼働履歴は残せる）。"""
    if battery_dp not in dps:
        return None
    try:
        battery = int(round(float(dps[battery_dp])))
    except (TypeError, ValueError):
        return None
    if battery < 0 or battery > 100:
        return None
    return battery


def _connect(config: Dict[str, Any]):
    device = tinytuya.Device(
        config["device_id"], config["host"], config["local_key"]
    )
    device.set_version(float(config["version"]))
    device.set_socketTimeout(CONNECT_TIMEOUT)
    return device


def read_status(config: Dict[str, Any]) -> Dict[str, Any]:
    """機器の生の状態（DPの辞書）を返す。"""
    device = _connect(config)
    status = device.status()
    if not isinstance(status, dict):
        raise ReadError(f"想定外の応答です: {status!r}")
    if "Error" in status or "err" in status:
        raise ReadError(f"読み取りに失敗しました: {status}")
    dps = status.get("dps")
    if not isinstance(dps, dict) or not dps:
        raise ReadError(f"DPが空です: {status}")
    return {str(key): value for key, value in dps.items()}


# ---------------------------------------------------------------- 送信


def build_payload(
    dps: Dict[str, Any],
    status_dp: str,
    battery_dp: str,
    now: Optional[datetime.datetime] = None,
) -> Dict[str, Any]:
    observed_at = now or datetime.datetime.now(JST).replace(tzinfo=None)
    return {
        "datetime": observed_at.strftime("%Y-%m-%d %H:%M:%S"),
        "event": extract_event(dps, status_dp),
        "battery": extract_battery(dps, battery_dp),
    }


def post_payload(api_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        api_url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(request, timeout=POST_TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


# ---------------------------------------------------------------- 実行


def run_collect(config: Dict[str, Any], dry_run: bool) -> int:
    try:
        dps = read_status(config)
    except ReadError as exc:
        LOGGER.error("%s", exc)
        return 1
    except Exception as exc:  # 機器が寝ている・IPが変わった等
        LOGGER.error("eufy に接続できませんでした（%s）: %s", config["host"], exc)
        return 1

    LOGGER.debug("dps=%s", dps)

    try:
        payload = build_payload(dps, config["status_dp"], config["battery_dp"])
    except ReadError as exc:
        LOGGER.error("%s", exc)
        return 1

    LOGGER.info(
        "状態=%s バッテリー=%s",
        payload["event"],
        "—" if payload["battery"] is None else f"{payload['battery']}%",
    )

    if dry_run:
        LOGGER.info("--dry-run のため送信しません: %s", payload)
        return 0

    try:
        result = post_payload(config["api_url"], payload)
    except urllib.error.HTTPError as exc:
        LOGGER.error("送信に失敗しました（HTTP %s）: %s", exc.code, exc.read()[:200])
        return 1
    except Exception as exc:
        LOGGER.error("送信に失敗しました: %s", exc)
        return 1

    # changed=False は「状態が変わっていないので行は増えていない」という正常な結果
    LOGGER.info(
        "送信しました: %s",
        "記録した" if result.get("changed") else "状態に変化なし",
    )
    return 0


def run_scan() -> int:
    """LAN 上の Tuya 機器を探して表示する（初回の設定用）。

    ここで分かるのは IP・device_id・プロトコル版まで。**local key は出てこない。**
    あれは Tuya のクラウド側にしか無く、開発者アカウントから取り出す必要がある。
    """
    LOGGER.info("LAN 上の Tuya 機器を探しています（%d秒）...", SCAN_TIMEOUT)
    devices = tinytuya.deviceScan(False, SCAN_TIMEOUT)
    if not devices:
        LOGGER.warning(
            "見つかりませんでした。機器がドックにいて電源が入っているか、"
            "サブPCが同じLAN・同じセグメントにいるかを確認してください。"
        )
        return 1

    for ip, info in devices.items():
        LOGGER.info(
            "IP=%s device_id=%s version=%s",
            ip,
            info.get("gwId") or info.get("id") or "?",
            info.get("version") or "?",
        )
    LOGGER.info("local key は別途 Tuya IoT の API Explorer で取得します（README参照）。")
    return 0


def run_dump(config: Dict[str, Any]) -> int:
    """機器が返す DP の辞書をそのまま表示する（DP番号の特定用）。"""
    try:
        dps = read_status(config)
    except Exception as exc:
        LOGGER.error("読み取れませんでした: %s", exc)
        return 1

    print(json.dumps(dps, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="eufy Clean の稼働状態を MyRoom へ送る（観測のみ・制御はしない）"
    )
    parser.add_argument(
        "--scan",
        action="store_true",
        help="LAN 上の Tuya 機器を探して IP と device_id を表示する（初回の設定用）",
    )
    parser.add_argument(
        "--dump",
        action="store_true",
        help="機器が返す DP の辞書をそのまま表示する（DP番号の特定用）",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="読み取るだけで POST しない"
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="詳細ログを出す")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    script_dir = os.path.dirname(os.path.abspath(__file__))
    apply_env_files(
        [
            os.path.join(script_dir, ".env"),
            os.path.join(os.path.dirname(script_dir), ".env"),
        ]
    )

    if tinytuya is None:
        LOGGER.error(
            "tinytuya が見つかりません。"
            "`collectors/.venv-cleaner/bin/pip install -r collectors/requirements-cleaner.txt` "
            "を実行し、その venv の python で動かしてください。"
        )
        return 2

    if args.scan:
        return run_scan()

    try:
        config = load_config()
    except ConfigError as exc:
        LOGGER.error("%s", exc)
        LOGGER.error("collectors/eufy.env.example を参照してください。")
        return 2

    if args.dump:
        return run_dump(config)
    return run_collect(config, args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
