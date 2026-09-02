"""前日夜・当日朝に「ゴミの日」を Signaly と PWA Push で通知する。

通知は「前日グループ」「当日グループ」の2つに分かれ、それぞれ独立に有効/無効・通知時刻を
持つ（#347）。品目（`data/garbage.json` の categories）ごとに、どちらのグループに属するかを
`garbage_notify_category_timing`（`app_settings`）で選べる。前日・当日の両方に属することもでき、
その場合は同じ品目について2回通知される。

前日グループの既定時刻は data/garbage.json の notify_hour（画面で設定していれば
`garbage_notify_time` を優先、#293）。当日グループの既定時刻は DEFAULT_SAME_DAY_NOTIFY_HOUR
（画面で設定していれば `garbage_notify_same_day_time` を優先）。

run_notify() は「通知する時刻か」「対象の収集があるか」「もう送っていないか」を毎回見て
判断するので、呼ぶ側は一定間隔で回すだけでよい。本番ではバックエンド
（backend/main.py の lifespan）が5分ごとに呼ぶ。手動で試すときは
`python -m backend.garbage_notify` を実行する。
同じ収集日・グループについて二重に通知しないよう、通知済みの日付を
data/garbage_notify_state.json に残す。
"""

from __future__ import annotations

import datetime
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from sqlalchemy.orm import Session

from . import database, garbage, notify_events, signaly_notify, ui_settings

load_dotenv()

logger = logging.getLogger(__name__)

STATE_PATH = Path(__file__).resolve().parent.parent / "data" / "garbage_notify_state.json"

#: 当日グループの既定の通知時刻（時）。前日グループと違い data/garbage.json には値を持たない
#: （当日は収集時刻より前の朝に送るのが実用的なため、前日夜の notify_hour とは別の既定値にする）
DEFAULT_SAME_DAY_NOTIFY_HOUR = 7

#: 前日・当日それぞれのグループの判定に必要な設定をまとめたもの。
#: state_key は data/garbage_notify_state.json のキー、dedupe_prefix は Push 通知の重複排除キー
#: の接頭辞（前日グループは既存の値 "garbage" を維持し、後方互換を保つ）
_GROUPS: List[Dict[str, Any]] = [
    {
        "timing": "before",
        "day_offset": 1,
        "enabled_key": ui_settings.SETTING_GARBAGE_NOTIFY_ENABLED,
        "enabled_default": ui_settings.DEFAULT_GARBAGE_NOTIFY_ENABLED,
        "time_key": ui_settings.SETTING_GARBAGE_NOTIFY_TIME,
        "state_key": "last_notified_date_before",
        "dedupe_prefix": "garbage",
        "title_fmt": "明日は{label}の日です",
        "body_fmt": "{label}を準備してください（{date_label}収集）",
        # 前日通知は #293 からの既存挙動どおり「時」だけを見る（分は無視する）。
        # 既存ユーザーの挙動を変えないため、当日通知（下）とは判定方法を変えていない
        "minute_precision": False,
    },
    {
        "timing": "same_day",
        "day_offset": 0,
        "enabled_key": ui_settings.SETTING_GARBAGE_NOTIFY_SAME_DAY_ENABLED,
        "enabled_default": ui_settings.DEFAULT_GARBAGE_NOTIFY_SAME_DAY_ENABLED,
        "time_key": ui_settings.SETTING_GARBAGE_NOTIFY_SAME_DAY_TIME,
        "state_key": "last_notified_date_same_day",
        "dedupe_prefix": "garbage-same-day",
        "title_fmt": "今日は{label}の日です",
        "body_fmt": "{label}を忘れずに出してください（{date_label}収集）",
        # 当日通知は収集時刻の直前に送りたい用途を想定し、分まで見る（#347のレビュー指摘）。
        # 「対象時刻を過ぎていて、その日まだ送っていない」で判定するため、5分間隔のループでも
        # 目的の分ちょうどを取りこぼさない
        "minute_precision": True,
    },
]


def _load_state() -> Dict[str, Any]:
    if not STATE_PATH.exists():
        return {}
    try:
        with STATE_PATH.open(encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            # 旧形式（前日グループのみを想定した単一キー）からの読み替え。
            # 実行時に自動生成されるキャッシュなので移行スクリプトは書かず、ここで一度だけ読み替える
            if "last_notified_date" in data and "last_notified_date_before" not in data:
                data["last_notified_date_before"] = data["last_notified_date"]
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


def _resolve_notify_hour(configured_time: Optional[str], default_hour: int) -> int:
    """通知時刻（時）。画面で設定していればそちらを優先する。"""
    if configured_time:
        return int(configured_time.split(":")[0])
    return default_hour


def _resolve_notify_time(configured_time: Optional[str], default_hour: int) -> datetime.time:
    """通知時刻（時分）。画面で設定していればそちらを優先する。"""
    if configured_time:
        hour, minute = (int(part) for part in configured_time.split(":")[:2])
        return datetime.time(hour, minute)
    return datetime.time(default_hour, 0)


def _passes_time_gate(
    group: Dict[str, Any], configured_time: Optional[str], default_hour: int, now: datetime.datetime
) -> bool:
    if group["minute_precision"]:
        target = _resolve_notify_time(configured_time, default_hour)
        return now.time() >= target
    return now.hour == _resolve_notify_hour(configured_time, default_hour)


def _notify_for_group(
    group: Dict[str, Any],
    *,
    config: Dict[str, Any],
    settings: Dict[str, Any],
    category_timing: Dict[str, List[str]],
    today: datetime.date,
    now: datetime.datetime,
    state: Dict[str, Any],
    notify: bool,
) -> Optional[Dict[str, Any]]:
    if not settings.get(group["enabled_key"], group["enabled_default"]):
        return None

    default_hour = (
        config["notify_hour"] if group["timing"] == "before" else DEFAULT_SAME_DAY_NOTIFY_HOUR
    )
    configured_time = settings.get(group["time_key"])
    if not _passes_time_gate(group, configured_time, default_hour, now):
        return None

    day = today + datetime.timedelta(days=group["day_offset"])
    entry = garbage.build_day(config, day, today)
    categories = [
        category
        for category in entry["categories"]
        if group["timing"]
        in category_timing.get(category["id"], ui_settings.DEFAULT_GARBAGE_NOTIFY_CATEGORY_TIMINGS)
    ]
    if not categories:
        return None

    if state.get(group["state_key"]) == entry["date"]:
        logger.info(
            "Already notified %s group for %s; skipping", group["timing"], entry["date"]
        )
        return None

    result = {**entry, "categories": categories, "timing": group["timing"]}

    if notify:
        date_label = f"{day.month}/{day.day}（{entry['weekday']}）"
        category_names = [category["name"] for category in categories]
        category_label = "・".join(category_names)
        signaly_notify.send_garbage_notification(
            date_label=date_label,
            category_names=category_names,
            notes=entry["notes"],
            timing=group["timing"],
        )
        notify_events.dispatch_push_event(
            notify_events.NotificationEvent(
                kind="garbage",
                title=group["title_fmt"].format(label=category_label),
                body=group["body_fmt"].format(label=category_label, date_label=date_label),
                priority="normal",
                url="/",
                occurred_at=now.isoformat(),
                dedupe_key=f"{group['dedupe_prefix']}-{entry['date']}",
            )
        )
        state[group["state_key"]] = entry["date"]

    return result


def run_notify(
    now: Optional[datetime.datetime] = None,
    notify: bool = True,
    db: Optional[Session] = None,
) -> List[Dict[str, Any]]:
    """前日・当日それぞれの通知対象を返す（0〜2件）。

    通知時刻・収集の有無・通知済みのいずれかで見送るグループは結果に含まれない。
    """
    config = garbage.load_config()
    if not config["configured"]:
        logger.info("Garbage schedule is not configured; skipping")
        return []

    session = db
    opened_session = False
    if session is None and not database.DB_MOCK and database.SessionLocal is not None:
        session = database.SessionLocal()
        opened_session = True

    try:
        settings = ui_settings.get_settings(session)
        category_timing = settings.get(ui_settings.SETTING_GARBAGE_NOTIFY_CATEGORY_TIMING, {})
        now = now or get_now_jst()
        today = now.date()
        state = _load_state()

        results: List[Dict[str, Any]] = []
        for group in _GROUPS:
            entry = _notify_for_group(
                group,
                config=config,
                settings=settings,
                category_timing=category_timing,
                today=today,
                now=now,
                state=state,
                notify=notify,
            )
            if entry:
                results.append(entry)

        if notify and results:
            _write_state(state)

        return results
    finally:
        if opened_session and session is not None:
            session.close()


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    entries = run_notify()
    for entry in entries:
        logger.info(
            "Garbage notification sent (%s) for %s: %s",
            entry["timing"],
            entry["date"],
            "・".join(category["name"] for category in entry["categories"]),
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
