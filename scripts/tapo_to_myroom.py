#!/usr/bin/env python3
"""Tapo スマートプラグ（P110系）の消費電力を読んで MyRoom へ送る。

**計測のみ。ON/OFF の制御は行わない。**

置き場所と実行環境
------------------
サブPC（Ubuntu Server・常時起動・宅内LAN）から systemd タイマーで5分ごとに動かす。
Pi Zero W ではなくサブPCにしたのは、`python-kasa` が Python 3.11 以上と
`cryptography` を要求し、armv6 の Pi Zero W では導入が現実的でないため。

依存は `requirements-collector.txt`（`python-kasa` のみ）。
バックエンドの `requirements.txt` には入れない——VPS 側はプラグと同じ LAN にいないので
使い道が無く、入れるとデプロイのたびに無関係なビルドが走る。

なぜ毎回ディスカバリーを投げるのか
----------------------------------
**停電やブレーカー断のあと、Tapo のローカル API はディスカバリー通信を受け取るまで
応答しない。** 遅延初期化のため、放っておくと数分〜場合によっては復活しない。
ホストを直接叩く前に必ずブロードキャストのディスカバリー（UDP/20002）を1回投げ、
その後で各機器へ接続する。1回あたり数百ミリ秒で済むので、毎回投げてよい。

使い方
------
    # 1Password から資格情報を注入して実行する（サブPC）
    op run --env-file=scripts/tapo.env.tpl -- python3 scripts/tapo_to_myroom.py

    # LAN 上のプラグを探して IP と名前を出す（初回の設定用）
    op run --env-file=scripts/tapo.env.tpl -- python3 scripts/tapo_to_myroom.py --list-devices

    # 読むだけで POST しない
    op run --env-file=scripts/tapo.env.tpl -- python3 scripts/tapo_to_myroom.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

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

#: JST。MyRoom の集計は JST の暦日で区切る（backend/main.py の `get_now_jst()` と同じ）
JST = datetime.timezone(datetime.timedelta(hours=9))

DISCOVERY_TIMEOUT = 5
CONNECT_TIMEOUT = 10
POST_TIMEOUT = 15


class ConfigError(Exception):
    """環境変数が足りない・壊れている。"""


# ---------------------------------------------------------------- 設定


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


def load_config() -> Dict[str, Any]:
    api_base = os.getenv("MYROOM_API_BASE", "https://myroom.gucchii.com").strip()
    return {
        "username": _require_env("TAPO_USERNAME"),
        "password": _require_env("TAPO_PASSWORD"),
        "hosts": parse_hosts(_require_env("TAPO_HOSTS")),
        "api_base": api_base.rstrip("/"),
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


def _read_energy(device: Any) -> Dict[str, Optional[float]]:
    """python-kasa のバージョン差を吸収して、瞬時値と当日積算を取り出す。

    0.7 以降は `device.modules[Module.Energy]`、それ以前は `device.emeter_realtime`。
    どちらも無ければ「エネルギー計測に対応していない機器」として None を返す。
    """
    power_w: Optional[float] = None
    kwh_today: Optional[float] = None

    module = None
    try:
        from kasa import Module  # 遅延 import（古い版には Module が無い）

        module = device.modules.get(Module.Energy)
    except Exception:  # noqa: BLE001 - 古い版へのフォールバックに落とす
        module = None

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


async def read_device(
    host: str, name_override: Optional[str], credentials: Credentials
) -> Optional[Dict[str, Any]]:
    """1台ぶんを読む。読めなければ None（他の機器の送信は止めない）。"""
    try:
        device = await asyncio.wait_for(
            Discover.discover_single(host, credentials=credentials),
            timeout=CONNECT_TIMEOUT,
        )
        await asyncio.wait_for(device.update(), timeout=CONNECT_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 - 1台の不調で全体を落とさない
        LOGGER.warning("%s へ接続できませんでした: %s", host, exc)
        return None

    energy = _read_energy(device)
    if energy["kwh_today"] is None and energy["power_w"] is None:
        LOGGER.warning("%s はエネルギー計測に対応していないようです", host)
        return None

    return {
        "host": host,
        "name": name_override or getattr(device, "alias", None) or host,
        "model": getattr(device, "model", None),
        **energy,
    }


async def collect(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    credentials = Credentials(config["username"], config["password"])
    await wake_up_devices(credentials)

    results = await asyncio.gather(
        *(read_device(host, name, credentials) for host, name in config["hosts"])
    )
    return [item for item in results if item is not None]


# ---------------------------------------------------------------- 送信


def build_payload(
    readings: List[Dict[str, Any]], today: datetime.date
) -> Dict[str, Any]:
    """`POST /api/energy` の本文を作る。

    同じ (date, source) は API 側で上書きされる。当日の積算は1日のあいだ増えていくため、
    追記ではなく上書きでないと二重計上になる。
    """
    return {
        "records": [
            {
                "date": today.isoformat(),
                "source": f"{SOURCE_PREFIX}{item['name']}",
                "kwh": item["kwh_today"],
                "power_w": item["power_w"],
            }
            for item in readings
            if item["kwh_today"] is not None
        ]
    }


def post_payload(api_base: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{api_base}/api/energy"
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(request, timeout=POST_TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


# ---------------------------------------------------------------- CLI


async def run_list_devices(config: Dict[str, Any]) -> int:
    credentials = Credentials(config["username"], config["password"])
    found = await wake_up_devices(credentials)
    if not found:
        print("LAN 上に Tapo 機器が見つかりませんでした。")
        return 1

    print(f"{len(found)} 台見つかりました。TAPO_HOSTS にはこの IP を書きます。\n")
    for host, device in found.items():
        try:
            await device.update()
        except Exception as exc:  # noqa: BLE001 - 一覧表示なので読めない機器も出す
            print(f"  {host}  (更新できませんでした: {exc})")
            continue
        energy = _read_energy(device)
        supported = "計測あり" if energy["kwh_today"] is not None else "計測なし"
        print(
            f"  {host:<16} {getattr(device, 'alias', '?')}"
            f"  [{getattr(device, 'model', '?')}] {supported}"
        )
    return 0


async def run_collect(config: Dict[str, Any], dry_run: bool) -> int:
    readings = await collect(config)
    if not readings:
        LOGGER.error("どのプラグからも読み取れませんでした")
        return 1

    today = datetime.datetime.now(JST).date()
    payload = build_payload(readings, today)

    for item in readings:
        LOGGER.info(
            "%s (%s): %s kWh / %s W",
            item["name"],
            item["host"],
            item["kwh_today"],
            item["power_w"],
        )

    if not payload["records"]:
        LOGGER.error("送信できる積算値がありませんでした")
        return 1

    if dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    try:
        result = post_payload(config["api_base"], payload)
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
        "--dry-run", action="store_true", help="読み取るだけで POST しない"
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="詳細ログを出す")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    if Discover is None:
        LOGGER.error(
            "python-kasa が見つかりません。"
            "`pip install -r requirements-collector.txt` を実行してください。"
        )
        return 2

    try:
        config = load_config()
    except ConfigError as exc:
        LOGGER.error("%s", exc)
        LOGGER.error("scripts/tapo.env.tpl を参照してください。")
        return 2

    if args.list_devices:
        return asyncio.run(run_list_devices(config))
    return asyncio.run(run_collect(config, args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
