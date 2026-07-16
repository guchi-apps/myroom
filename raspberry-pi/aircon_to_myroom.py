#!/usr/bin/env python3
"""
白くまくんアプリ (AirCloud Home) からエアコン状態を取得し、MyRoom API へ POST する。

使い方:
  python3 aircon_to_myroom.py
  python3 aircon_to_myroom.py --debug
  python3 aircon_to_myroom.py --dry-run
  python3 aircon_to_myroom.py --list-units
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import requests
from dotenv import load_dotenv

from aircloudhome_client import AirCloudDevice, AirCloudHomeClient, AirCloudHomeError

JST = timezone(timedelta(hours=9))


def now_jst_str() -> str:
    return datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")


def select_device(
    devices: List[AirCloudDevice],
    unit_name: Optional[str],
    unit_id: Optional[int],
) -> AirCloudDevice:
    if not devices:
        raise AirCloudHomeError("No air conditioner units found in AirCloud Home account")

    if unit_id is not None:
        for device in devices:
            if device.id == unit_id:
                return device
        raise AirCloudHomeError(f"Unit id={unit_id} not found")

    if unit_name:
        normalized = unit_name.strip().lower()
        for device in devices:
            if device.name.strip().lower() == normalized:
                return device
        raise AirCloudHomeError(f"Unit named '{unit_name}' not found")

    if len(devices) == 1:
        return devices[0]

    names = ", ".join(f"{d.name} (id={d.id})" for d in devices)
    raise AirCloudHomeError(
        f"Multiple units found ({names}). Set AIRCON_UNIT_NAME or AIRCON_UNIT_ID in .env"
    )


def build_payload(device: AirCloudDevice) -> dict:
    return {
        "datetime": now_jst_str(),
        "ac_id": device.id,
        "name": device.name,
        "room_temperature": device.room_temperature,
        "target_temperature": device.target_temperature,
        "humidity": device.humidity,
        "mode": device.mode,
        "power": device.power,
        "fan_speed": device.fan_speed,
        "fan_swing": device.fan_swing,
        "online": device.online,
        "model": device.model,
    }


def post_to_myroom(
    api_url: str,
    payload: dict,
    timeout: int,
    dry_run: bool,
) -> dict:
    if dry_run:
        print(f"[dry-run] POST {api_url}")
        print(f"[dry-run] payload: {payload}")
        return {"status": "dry_run", "payload": payload}

    response = requests.post(api_url, json=payload, timeout=timeout)
    response.raise_for_status()
    return response.json()


def _load_dotenv_if_readable() -> None:
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.isfile(env_file) and os.access(env_file, os.R_OK):
        load_dotenv(env_file)


def load_config() -> argparse.Namespace:
    _load_dotenv_if_readable()

    parser = argparse.ArgumentParser(description="AirCloud Home (白くまくん) -> MyRoom")
    parser.add_argument(
        "--email",
        default=os.getenv("AIRCON_EMAIL", ""),
        help="AirCloud Home account email",
    )
    parser.add_argument(
        "--password",
        default=os.getenv("AIRCON_PASSWORD", ""),
        help="AirCloud Home account password",
    )
    parser.add_argument(
        "--unit-name",
        default=os.getenv("AIRCON_UNIT_NAME", ""),
        help="AirCloud unit name (optional if only one unit)",
    )
    parser.add_argument(
        "--unit-id",
        type=int,
        default=int(os.getenv("AIRCON_UNIT_ID", "0")) or None,
        help="AirCloud unit id (optional)",
    )
    parser.add_argument(
        "--api-url",
        default=os.getenv(
            "MYROOM_AIRCON_API_URL",
            "https://myroom.gucchii.com/api/aircon",
        ),
        help="MyRoom POST endpoint URL",
    )
    parser.add_argument(
        "--http-timeout",
        type=int,
        default=int(os.getenv("HTTP_TIMEOUT", "30")),
        help="HTTP request timeout in seconds",
    )
    parser.add_argument("--debug", action="store_true", help="Print debug logs")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch only; do not POST to API",
    )
    parser.add_argument(
        "--list-units",
        action="store_true",
        help="List available units and exit",
    )
    parser.add_argument(
        "--dump-raw",
        action="store_true",
        help="Print raw idu-list API response (JSON) and exit; for investigating unmapped fields",
    )

    args = parser.parse_args()
    if not args.email or not args.password:
        parser.error("AIRCON_EMAIL and AIRCON_PASSWORD are required (env or CLI)")
    return args


def main() -> int:
    try:
        args = load_config()

        with AirCloudHomeClient(args.email, args.password, timeout=args.http_timeout) as client:
            if args.dump_raw:
                raw_devices = client.get_raw_devices()
                print(json.dumps(raw_devices, ensure_ascii=False, indent=2))
                return 0
            devices = client.get_devices()

        if args.list_units:
            for device in devices:
                print(
                    "id={} name={!r} online={} power={} mode={} room={}C target={}C".format(
                        device.id,
                        device.name,
                        device.online,
                        device.power,
                        device.mode,
                        device.room_temperature,
                        device.target_temperature,
                    )
                )
            return 0

        device = select_device(devices, args.unit_name or None, args.unit_id)
        payload = build_payload(device)

        if args.debug:
            print(f"selected: {device.name} (id={device.id})")
            print(f"api url: {args.api_url}")

        print(
            f"read: power={device.power} mode={device.mode} "
            f"room={device.room_temperature}C target={device.target_temperature}C "
            f"online={device.online}"
        )

        result = post_to_myroom(
            api_url=args.api_url,
            payload=payload,
            timeout=args.http_timeout,
            dry_run=args.dry_run,
        )
        print(f"posted: {result}")
        return 0
    except requests.HTTPError as exc:
        print(f"API error: {exc.response.status_code} {exc.response.text}", file=sys.stderr)
        return 1
    except AirCloudHomeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
