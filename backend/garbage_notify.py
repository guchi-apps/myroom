"""前日夜に「明日はゴミの日」を Signaly で通知する。

通知する時刻は data/garbage.json の notify_hour（JST）で決める。run_notify() は「通知する時刻か」
「明日は収集があるか」「もう送っていないか」を毎回見て判断するので、呼ぶ側は一定間隔で回すだけでよい。
本番ではバックエンド（backend/main.py の lifespan）が5分ごとに呼ぶ。手動で試すときは
`python -m backend.garbage_notify` を実行する。
同じ収集日について二重に通知しないよう、通知済みの日付を data/garbage_notify_state.json に残す。
"""

from __future__ import annotations

import datetime
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv

from . import garbage, signaly_notify

load_dotenv()

logger = logging.getLogger(__name__)

STATE_PATH = Path(__file__).resolve().parent.parent / "data" / "garbage_notify_state.json"


def _load_state() -> Dict[str, Any]:
    if not STATE_PATH.exists():
        return {}
    try:
        with STATE_PATH.open(encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return data
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        logger.warning("Failed to read garbage notify state; resetting")
    return {}


def _write_state(state: Dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with STATE_PATH.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False, indent=2)


def get_now_jst() -> datetime.datetime:
    return datetime.datetime.now(garbage.JST).replace(tzinfo=None)


def run_notify(
    now: Optional[datetime.datetime] = None,
    notify: bool = True,
) -> Optional[Dict[str, Any]]:
    """明日の収集予定を返す。通知時刻・収集の有無・通知済みのいずれかで見送る場合は None。"""
    config = garbage.load_config()
    if not config["configured"]:
        logger.info("Garbage schedule is not configured; skipping")
        return None

    now = now or get_now_jst()
    if now.hour != config["notify_hour"]:
        logger.debug("Not the notify hour (%d); skipping", config["notify_hour"])
        return None

    today = now.date()
    tomorrow = today + datetime.timedelta(days=1)
    entry = garbage.build_day(config, tomorrow, today)
    if not entry["categories"]:
        logger.info("No garbage collection on %s; skipping", tomorrow.isoformat())
        return None

    state = _load_state()
    if state.get("last_notified_date") == entry["date"]:
        logger.info("Already notified for %s; skipping", entry["date"])
        return None

    if notify:
        signaly_notify.send_garbage_notification(
            date_label=f"{tomorrow.month}/{tomorrow.day}（{entry['weekday']}）",
            category_names=[category["name"] for category in entry["categories"]],
            notes=entry["notes"],
        )
        _write_state({"last_notified_date": entry["date"]})

    return entry


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    entry = run_notify()
    if entry:
        logger.info(
            "Garbage notification sent for %s: %s",
            entry["date"],
            "・".join(category["name"] for category in entry["categories"]),
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
