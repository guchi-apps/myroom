#!/usr/bin/env python3
"""Tapo スマートプラグ（P110系）の消費電力を読んで MyRoom の `/api/energy` へ送る。

**計測のみ。ON/OFF の制御は行わない。**

サブPCの systemd user timer から5分ごとに実行する想定
（`collectors/systemd/myroom-tapo-energy.timer`）。`/api/energy` は同じ
`(date, source)` を上書きするため、当日ぶんを何度送っても二重計上しない。

置き場所と実行環境
------------------
ラズパイではなくサブPCで動かす。`python-kasa` が Python 3.11 以上と `cryptography` を
要求し、armv6 の Pi Zero W では導入が現実的でないため。プラグと同じ LAN にいれば
どこからでも読める（KLAP・TCP 80、ディスカバリーは UDP 20002）。

**このディレクトリの他の収集スクリプトと違い、依存が要る。** `python-kasa` はサブPCの
システムPythonに入っていないので、専用の venv を作って使う（`collectors/requirements-tapo.txt`）。

    python3 -m venv collectors/.venv-tapo
    collectors/.venv-tapo/bin/pip install -r collectors/requirements-tapo.txt

なぜ毎回ディスカバリーを投げるのか
----------------------------------
**停電やブレーカー断のあと、Tapo のローカル API はディスカバリー通信を受け取るまで
応答しない。** 遅延初期化のため、放っておくと数分〜場合によっては復活しない。
ホストを直接叩く前に必ずブロードキャストのディスカバリー（UDP/20002）を1回投げ、
その後で各機器へ接続する。1回あたり数百ミリ秒で済むので、毎回投げてよい。

ブロードキャストで見つからないとき
----------------------------------
**ディスカバリーの応答はホスト側のファイアウォールに落とされることがある。** ブロードキャスト
宛（255.255.255.255）に送った問い合わせへの応答は、送信元がプラグ個々の IP になるため
conntrack の ESTABLISHED に一致しない。サブPCのように ufw が `deny incoming` だと、
プラグは応答しているのに `[UFW BLOCK] ... SPT=20002` として捨てられ、0台に見える（#199）。

**ユニキャストなら通る。** そのため `--list-devices` はブロードキャストで0台だったときに
同じサブネットを1台ずつ当たり直す（`--scan` で範囲を指定できる）。収集本体は最初から
ユニキャストなので、この状態でも読み取りには影響しない。

過去ぶんはプラグ本体から取る
--------------------------
**P110 系は日別の使用量をプラグ自身が覚えている。** `get_energy_data`（`interval=1440`）で
月初起点の 92 日ぶんが Wh の配列として返るため、収集を始める前の日や、収集が止まっていた
あいだの日も後から埋められる（#208）。当日ぶんだけを送っていた頃は、スクリプトを動かし
始めた日より前がグラフから抜けていた。

既定は当日を含めて `DEFAULT_DAYS` 日ぶん。**過去1か月ぶんの取り込みは `--days 31` を1度だけ
流す。** 5分ごとの定期実行で毎回30行を書き直すのは重いので、既定にはしない。

使い方:
  collectors/.venv-tapo/bin/python collectors/tapo_to_myroom.py
  collectors/.venv-tapo/bin/python collectors/tapo_to_myroom.py --days 31
  collectors/.venv-tapo/bin/python collectors/tapo_to_myroom.py --list-devices
  collectors/.venv-tapo/bin/python collectors/tapo_to_myroom.py --list-devices --scan 192.168.2.0/24
  collectors/.venv-tapo/bin/python collectors/tapo_to_myroom.py --dry-run -v
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import ipaddress
import json
import logging
import os
import socket
import urllib.error
import urllib.request
import os.path
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    from kasa import Credentials, Discover
except ImportError:  # pragma: no cover - サブPCの実行環境にだけ必要
    # **import 時には落とさない。** python-kasa が入っているのはサブPCの収集用 venv
    # だけで、バックエンドのテスト環境には無い。ここで SystemExit すると
    # `pytest tests/` がこのモジュールを収集した時点で失敗する。
    Credentials = None  # type: ignore[assignment]
    Discover = None  # type: ignore[assignment]


LOGGER = logging.getLogger("tapo_to_myroom")

#: `daily_energy.source` の前置き。エアコン（`aircon`）と同じテーブルに混ぜるための名前空間
SOURCE_PREFIX = "tapo:"

#: 送り先。`collectors/aircon_energy_to_myroom.py` と同じ環境変数名で上書きできる
DEFAULT_API_URL = "https://myroom.gucchii.com/api/energy"

#: JST。MyRoom の集計は JST の暦日で区切る（backend/main.py の `get_now_jst()` と同じ）
JST = datetime.timezone(datetime.timedelta(hours=9))

DISCOVERY_TIMEOUT = 5
CONNECT_TIMEOUT = 10
POST_TIMEOUT = 15

#: ユニキャスト走査で1台に待つ秒数。LAN内なので応答は数十msで返る
SCAN_TIMEOUT = 3
#: ユニキャスト走査の同時実行数。/24 を SCAN_TIMEOUT=3 で約12秒
SCAN_CONCURRENCY = 64
#: 走査を受け付ける最大アドレス数（/20）。家庭のLANでこれを超える指定は打ち間違い
SCAN_MAX_HOSTS = 4096

#: 既定で送り直す日数（当日を含む）。当日ぶんは1日のあいだ増えていくので、直近の確定値も
#: 一緒に送り直して最終値へ寄せる。`collectors/aircon_energy_to_myroom.py` の
#: `DEFAULT_DAYS` と同じ考え方。
DEFAULT_DAYS = 3

#: `--days` の上限。プラグが返す日別履歴が月初起点の92日ぶんまでのため、これより
#: 大きい指定は受け付けても意味が無い。
MAX_DAYS = 92

#: `get_energy_data` の `interval`（分）。1440 = 1日ごと。
DAILY_INTERVAL_MINUTES = 1440


class ConfigError(Exception):
    """環境変数が足りない・壊れている。"""


# ---------------------------------------------------------------- 設定


def load_env_file(path: str) -> Dict[str, str]:
    """`KEY=value` 形式を読む簡易パーサ。

    `python-dotenv` はサブPCのシステムPythonに入っていない。ここで要るのは数行の
    `KEY=value` だけなので、依存を増やさず自前で読む。
    （`collectors/aircon_energy_to_myroom.py` にも同じものがある。片方だけの都合で
    直さないこと。）
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


def parse_hosts(raw: str) -> List[Tuple[str, Optional[str]]]:
    """`TAPO_HOSTS` を (IP, 表示名) の並びへ。

    `192.168.1.21=冷蔵庫,192.168.1.22` のように書く。`=表示名` を省いた場合は
    プラグ自身に設定されている名前（alias）を使う。
    """
    hosts: List[Tuple[str, Optional[str]]] = []
    for chunk in raw.split(","):
        entry = chunk.strip()
        if not entry:
            continue
        host, sep, name = entry.partition("=")
        host = host.strip()
        if not host:
            raise ConfigError(f"TAPO_HOSTS の書式が不正です: {entry!r}")
        hosts.append((host, name.strip() if sep and name.strip() else None))
    if not hosts:
        raise ConfigError("TAPO_HOSTS にプラグが1つも書かれていません")
    return hosts


def load_config(require_hosts: bool = True) -> Dict[str, Any]:
    """設定を環境変数から組み立てる。

    **`--list-devices` のときは `TAPO_HOSTS` を必須にしない。** あれは「まだ IP が
    分からない」初回設定のための機能で、そこで `TAPO_HOSTS` を要求すると、
    一番必要な場面で探索まで到達できない。
    """
    raw_hosts = os.getenv("TAPO_HOSTS", "").strip()
    if require_hosts:
        hosts = parse_hosts(_require_env("TAPO_HOSTS"))
    elif raw_hosts:
        try:
            hosts = parse_hosts(raw_hosts)
        except ConfigError as exc:
            LOGGER.warning("TAPO_HOSTS を読めませんでした（探索には影響しません）: %s", exc)
            hosts = []
    else:
        hosts = []

    return {
        "username": _require_env("TAPO_USERNAME"),
        "password": _require_env("TAPO_PASSWORD"),
        "hosts": hosts,
        "api_url": os.getenv("MYROOM_ENERGY_API_URL", DEFAULT_API_URL).strip(),
    }


# ---------------------------------------------------------------- 機器の読み取り


async def wake_up_devices(credentials: Credentials) -> Dict[str, Any]:
    """ブロードキャストのディスカバリーを1回投げる。

    戻り値は「見つかった機器」だが、**主目的は返り値ではなく、停電明けに眠っている
    ローカル API を起こすこと**。失敗しても後続の接続は試すので、例外は握りつぶす。
    """
    try:
        found = await Discover.discover(
            credentials=credentials, discovery_timeout=DISCOVERY_TIMEOUT
        )
    except Exception as exc:  # noqa: BLE001 - 起こすのが目的で、結果は使わなくてよい
        LOGGER.warning("ディスカバリーに失敗しました（接続は続行します）: %s", exc)
        return {}
    LOGGER.debug("ディスカバリーで %d 台見つかりました", len(found))
    return found


async def close_device(device: Any) -> None:
    """機器との接続を閉じる。

    閉じないと python-kasa が握っている aiohttp のセッションが解放時に
    `Unclosed client session` を **ERROR で** 吐く。実際には成功しているのに
    `journalctl` では失敗に見えるため、読み終えたら必ず閉じる。
    """
    try:
        await device.disconnect()
    except Exception as exc:  # noqa: BLE001 - 後片付けの失敗は本筋に影響しない
        LOGGER.debug("切断に失敗しました: %s", exc)


def parse_scan_target(raw: str) -> ipaddress.IPv4Network:
    """`--scan` の CIDR を検証して返す。

    1アドレスずつ当たるので、広すぎる指定は事故になる（`/8` は1600万アドレス）。
    家庭のLANで想定するのは `/24`〜`/20` まで。
    """
    try:
        network = ipaddress.ip_network(raw, strict=False)
    except ValueError as exc:
        raise ConfigError(f"--scan の指定が不正です（{raw}）: {exc}") from exc
    if not isinstance(network, ipaddress.IPv4Network):
        raise ConfigError(f"--scan は IPv4 のみ対応しています: {raw}")
    if network.num_addresses > SCAN_MAX_HOSTS:
        raise ConfigError(
            f"--scan の範囲が広すぎます（{network} = {network.num_addresses} アドレス）。"
            f"{SCAN_MAX_HOSTS} アドレス以内で指定してください"
        )
    return network


def local_subnet() -> Optional[ipaddress.IPv4Network]:
    """既定の経路が出ていくインターフェースの IP から、走査するサブネット（/24）を推定する。

    UDP ソケットの `connect()` はパケットを送らず、カーネルの経路表を引くだけ。相手へ
    到達できなくても、既定経路のインターフェースのアドレスが取れる。Tailscale の
    アドレスは /32 で既定経路を持たないため、ここには出てこない。

    **/24 決め打ち。** それ以外のLANでは `--scan` で明示すること。
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("192.0.2.1", 9))  # TEST-NET-1。実際には送らない
        address = sock.getsockname()[0]
    except OSError as exc:
        LOGGER.warning("自ホストの IP を取得できませんでした: %s", exc)
        return None
    finally:
        sock.close()

    try:
        return ipaddress.ip_network(f"{address}/24", strict=False)
    except ValueError as exc:  # pragma: no cover - getsockname が壊れた値を返した場合
        LOGGER.warning("サブネットを決められませんでした（%s）: %s", address, exc)
        return None


async def _probe_host(
    host: str, credentials: Credentials, semaphore: asyncio.Semaphore
) -> Optional[Any]:
    async with semaphore:
        try:
            return await asyncio.wait_for(
                Discover.discover_single(host, credentials=credentials),
                timeout=SCAN_TIMEOUT,
            )
        except Exception:  # noqa: BLE001 - 大半は「Tapo 機器ではない」だけなので黙る
            return None


async def scan_subnet(
    network: ipaddress.IPv4Network, credentials: Credentials
) -> Dict[str, Any]:
    """サブネットの各アドレスへ**ユニキャストで**ディスカバリーを投げて機器を探す。

    ブロードキャストの応答がファイアウォールに落とされる環境（モジュール冒頭の説明を
    参照）向けのフォールバック。/24 なら十数秒で終わる。
    """
    hosts = [str(host) for host in network.hosts()]
    LOGGER.info("%s を1台ずつ探します（%d アドレス）…", network, len(hosts))
    semaphore = asyncio.Semaphore(SCAN_CONCURRENCY)
    devices = await asyncio.gather(
        *(_probe_host(host, credentials, semaphore) for host in hosts)
    )
    return {
        host: device for host, device in zip(hosts, devices) if device is not None
    }


def _energy_module(device: Any) -> Optional[Any]:
    """python-kasa 0.7 以降の Energy モジュールを返す。古い版・非対応機器では None。"""
    try:
        from kasa import Module  # 遅延 import（古い版には Module が無い）

        return device.modules.get(Module.Energy)
    except Exception:  # noqa: BLE001 - 古い版へのフォールバックに落とす
        return None


def _read_energy(device: Any) -> Dict[str, Optional[float]]:
    """python-kasa のバージョン差を吸収して、瞬時値と当日積算を取り出す。

    0.7 以降は `device.modules[Module.Energy]`、それ以前は `device.emeter_realtime`。
    どちらも無ければ「エネルギー計測に対応していない機器」として None を返す。
    """
    power_w: Optional[float] = None
    kwh_today: Optional[float] = None

    module = _energy_module(device)

    if module is not None:
        power_w = getattr(module, "current_consumption", None)
        kwh_today = getattr(module, "consumption_today", None)
    else:
        realtime = getattr(device, "emeter_realtime", None)
        if realtime is not None:
            power_w = getattr(realtime, "power", None)
        kwh_today = getattr(device, "emeter_today", None)

    return {
        "power_w": float(power_w) if power_w is not None else None,
        "kwh_today": float(kwh_today) if kwh_today is not None else None,
    }


def window_start(today: datetime.date, days: int) -> datetime.date:
    """送り直す期間の先頭。`days=1` なら当日のみ（従来の挙動）。"""
    if days < 1:
        raise ValueError("days must be >= 1")
    return today - datetime.timedelta(days=days - 1)


def _day_start_timestamp(date: datetime.date) -> int:
    return int(datetime.datetime.combine(date, datetime.time(), JST).timestamp())


def extract_daily_history(
    response: Any, today: datetime.date, start: datetime.date
) -> List[Tuple[datetime.date, float]]:
    """`get_energy_data` の応答を `(日付, kWh)` の並びへ。古い順。

    応答の `data` は **Wh の配列**で、`start_timestamp` の日から1日ずつ並ぶ。要求した
    期間より広く返る（プラグ側が起点を月初へ丸め、92日ぶん返す）ため、こちらで切り詰める。

    **計測を始める前の日も `0` が返る。** 「まだ計測していない日」と「本当に0だった日」は
    区別できないので、**配列全体で最初に0でなかった日より前は捨てる**（プラグを付ける前の
    日が0で埋まり、グラフが平らに伸びるのを防ぐ）。その日以降の0は「使わなかった日」
    として残す。

    当日ぶんは瞬時電力と一緒に別途送るため、ここには含めない。
    """
    payload = response.get("get_energy_data", response) if isinstance(response, dict) else None
    if not isinstance(payload, dict):
        raise ValueError("get_energy_data の応答が辞書ではありません")

    data = payload.get("data")
    start_timestamp = payload.get("start_timestamp")
    if not isinstance(data, list) or start_timestamp is None:
        raise ValueError("get_energy_data の応答に data / start_timestamp がありません")

    first_day = datetime.datetime.fromtimestamp(int(start_timestamp), JST).date()
    first_measured = next((index for index, value in enumerate(data) if value), None)
    if first_measured is None:
        return []

    history: List[Tuple[datetime.date, float]] = []
    for index in range(first_measured, len(data)):
        date = first_day + datetime.timedelta(days=index)
        if date < start or date >= today:
            continue
        value = data[index]
        if value is None:
            continue
        history.append((date, round(float(value) / 1000.0, 3)))
    return history


async def read_daily_history(
    device: Any, today: datetime.date, start: datetime.date
) -> List[Tuple[datetime.date, float]]:
    """プラグ本体が持つ日別履歴を読む。読めなければ空（当日ぶんの送信は止めない）。"""
    module = _energy_module(device)
    if module is None:
        return []

    params = {
        # プラグは起点を月初へ丸めるので、こちらも月初で渡して素直に受け取る
        "start_timestamp": _day_start_timestamp(start.replace(day=1)),
        "end_timestamp": _day_start_timestamp(today + datetime.timedelta(days=1)),
        "interval": DAILY_INTERVAL_MINUTES,
    }
    try:
        response = await asyncio.wait_for(
            module.call("get_energy_data", params), timeout=CONNECT_TIMEOUT
        )
    except Exception as exc:  # noqa: BLE001 - 過去ぶんが取れなくても当日ぶんは送る
        LOGGER.warning("日別履歴を取得できませんでした: %s", exc)
        return []

    try:
        return extract_daily_history(response, today, start)
    except (ValueError, TypeError, OverflowError, OSError) as exc:
        LOGGER.warning("日別履歴を解釈できませんでした: %s", exc)
        return []


async def read_device(
    host: str,
    name_override: Optional[str],
    credentials: Credentials,
    today: datetime.date,
    start: datetime.date,
) -> Optional[Dict[str, Any]]:
    """1台ぶんを読む。読めなければ None（他の機器の送信は止めない）。"""
    device = None
    try:
        device = await asyncio.wait_for(
            Discover.discover_single(host, credentials=credentials),
            timeout=CONNECT_TIMEOUT,
        )
        await asyncio.wait_for(device.update(), timeout=CONNECT_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 - 1台の不調で全体を落とさない
        LOGGER.warning("%s へ接続できませんでした: %s", host, exc)
        if device is not None:
            await close_device(device)
        return None

    try:
        energy = _read_energy(device)
        if energy["kwh_today"] is None and energy["power_w"] is None:
            LOGGER.warning("%s はエネルギー計測に対応していないようです", host)
            return None

        history = (
            await read_daily_history(device, today, start) if start < today else []
        )

        return {
            "host": host,
            "name": name_override or getattr(device, "alias", None) or host,
            "model": getattr(device, "model", None),
            "history": history,
            **energy,
        }
    finally:
        await close_device(device)


async def collect(
    config: Dict[str, Any], today: datetime.date, start: datetime.date
) -> List[Dict[str, Any]]:
    credentials = Credentials(config["username"], config["password"])
    for device in (await wake_up_devices(credentials)).values():
        await close_device(device)

    results = await asyncio.gather(
        *(
            read_device(host, name, credentials, today, start)
            for host, name in config["hosts"]
        )
    )
    return [item for item in results if item is not None]


# ---------------------------------------------------------------- 送信


def build_payload(
    readings: List[Dict[str, Any]], today: datetime.date
) -> Dict[str, Any]:
    """`POST /api/energy` の本文を作る。古い日付から順に並べる。

    同じ (date, source) は API 側で上書きされる。当日の積算は1日のあいだ増えていくため、
    追記ではなく上書きでないと二重計上になる。

    **瞬時電力（`power_w`）が付くのは当日ぶんだけ。** 過去ぶんはプラグの日別履歴から
    取っており、その日の瞬時値は残っていない。
    """
    records: List[Dict[str, Any]] = []
    for item in readings:
        source = f"{SOURCE_PREFIX}{item['name']}"
        for date, kwh in item.get("history") or ():
            records.append(
                {
                    "date": date.isoformat(),
                    "source": source,
                    "kwh": kwh,
                    "power_w": None,
                }
            )
        if item["kwh_today"] is not None:
            records.append(
                {
                    "date": today.isoformat(),
                    "source": source,
                    "kwh": item["kwh_today"],
                    "power_w": item["power_w"],
                }
            )
    return {"records": records}


def post_payload(api_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        api_url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(request, timeout=POST_TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


# ---------------------------------------------------------------- CLI


NOT_FOUND_HINT = """LAN 上に Tapo 機器が見つかりませんでした。次を確認してください。

  1. プラグがこのホストと同じ LAN・同じ VLAN にあり、ping が通ること
  2. ホストのファイアウォールがディスカバリーの応答を落としていないこと
     （ufw が deny incoming だとブロードキャストの応答は捨てられます）

       journalctl -k --since '-5min' | grep 'UFW BLOCK' | grep 'SPT=20002'

     ここに行が出ていれば、プラグは応答しているのに捨てられています。
     IP が分かっているなら TAPO_HOSTS に直接書けば収集は動きます（収集は
     ユニキャストのため、この状態でも読めます）。
  3. サブネットが /24 でない場合は --scan で範囲を指定すること
     （例: --scan 192.168.2.0/23）"""


async def run_list_devices(config: Dict[str, Any], scan: Optional[str]) -> int:
    credentials = Credentials(config["username"], config["password"])
    found = await wake_up_devices(credentials)

    if not found:
        # ブロードキャストの応答はファイアウォールに落とされることがある（#199）。
        # ユニキャストなら通るので、同じサブネットを1台ずつ当たり直す。
        LOGGER.info(
            "ブロードキャストでは見つかりませんでした。"
            "ユニキャストで探し直します（応答がファイアウォールに落とされている可能性）。"
        )
        try:
            network = parse_scan_target(scan) if scan else local_subnet()
        except ConfigError as exc:
            LOGGER.error("%s", exc)
            return 2
        if network is not None:
            found = await scan_subnet(network, credentials)

    if not found:
        print(NOT_FOUND_HINT)
        return 1

    print(f"{len(found)} 台見つかりました。TAPO_HOSTS にはこの IP を書きます。\n")
    for host, device in found.items():
        try:
            await device.update()
        except Exception as exc:  # noqa: BLE001 - 一覧表示なので読めない機器も出す
            print(f"  {host}  (更新できませんでした: {exc})")
            await close_device(device)
            continue
        energy = _read_energy(device)
        supported = "計測あり" if energy["kwh_today"] is not None else "計測なし"
        print(
            f"  {host:<16} {getattr(device, 'alias', '?')}"
            f"  [{getattr(device, 'model', '?')}] {supported}"
        )
        await close_device(device)
    return 0


async def run_collect(config: Dict[str, Any], dry_run: bool, days: int) -> int:
    today = datetime.datetime.now(JST).date()
    start = window_start(today, days)

    readings = await collect(config, today, start)
    if not readings:
        LOGGER.error("どのプラグからも読み取れませんでした")
        return 1

    payload = build_payload(readings, today)

    for item in readings:
        LOGGER.info(
            "%s (%s): %s kWh / %s W（過去 %d 日ぶん）",
            item["name"],
            item["host"],
            item["kwh_today"],
            item["power_w"],
            len(item["history"]),
        )

    if not payload["records"]:
        LOGGER.error("送信できる積算値がありませんでした")
        return 1

    if dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    try:
        result = post_payload(config["api_url"], payload)
    except urllib.error.HTTPError as exc:
        LOGGER.error("POST が %s で失敗しました: %s", exc.code, exc.read().decode("utf-8", "replace"))
        return 1
    except Exception as exc:  # noqa: BLE001 - ネットワーク断は次回の実行で取り返す
        LOGGER.error("POST に失敗しました: %s", exc)
        return 1

    LOGGER.info("送信しました: %s", result)
    # 全台読めたときだけ 0。1台でも落ちていれば 1 にして systemd のログに残す
    return 0 if len(readings) == len(config["hosts"]) else 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Tapo スマートプラグの消費電力を MyRoom へ送る（計測のみ）"
    )
    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="LAN 上の Tapo 機器を探して IP と名前を表示する（初回の設定用）",
    )
    parser.add_argument(
        "--scan",
        metavar="CIDR",
        help=(
            "--list-devices でブロードキャストが空だったときに1台ずつ当たる範囲"
            "（省略時は自ホストの IP から /24 を推定）"
        ),
    )
    parser.add_argument(
        "--days",
        type=int,
        default=DEFAULT_DAYS,
        metavar="N",
        help=(
            f"当日を含めて何日ぶん送り直すか（既定 {DEFAULT_DAYS}・最大 {MAX_DAYS}）。"
            "過去1か月ぶんの取り込みは --days 31 を1度だけ流す"
        ),
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

    if not 1 <= args.days <= MAX_DAYS:
        LOGGER.error(
            "--days は 1〜%d で指定してください（プラグが持つ履歴は月初起点の %d 日ぶんまで）",
            MAX_DAYS,
            MAX_DAYS,
        )
        return 2

    script_dir = os.path.dirname(os.path.abspath(__file__))
    apply_env_files(
        [
            os.path.join(script_dir, ".env"),
            os.path.join(os.path.dirname(script_dir), ".env"),
        ]
    )

    if Discover is None:
        LOGGER.error(
            "python-kasa が見つかりません。"
            "`collectors/.venv-tapo/bin/pip install -r collectors/requirements-tapo.txt` "
            "を実行し、その venv の python で動かしてください。"
        )
        return 2

    try:
        # 一覧表示は IP を調べるための機能なので、TAPO_HOSTS が無くても動かす
        config = load_config(require_hosts=not args.list_devices)
    except ConfigError as exc:
        LOGGER.error("%s", exc)
        LOGGER.error("collectors/tapo.env.example を参照してください。")
        return 2

    if args.list_devices:
        return asyncio.run(run_list_devices(config, args.scan))
    return asyncio.run(run_collect(config, args.dry_run, args.days))


if __name__ == "__main__":
    raise SystemExit(main())
