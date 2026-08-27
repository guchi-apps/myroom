"""ゴミ収集日の定義（data/garbage.json）を読み、指定日の収集品目を求める。

センサーのように外部から届くデータではなく、手で書いた収集ルールから日付を計算するだけなので
DB は使わず JSON ファイルのみを正とする。年末年始などの変則日程は exceptions で上書きする。
"""

from __future__ import annotations

import calendar
import datetime
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

JST = datetime.timezone(datetime.timedelta(hours=9))

CONFIG_PATH = Path(__file__).resolve().parent.parent / "data" / "garbage.json"

DEFAULT_NOTIFY_HOUR = 20
#: 収集が終わる時刻（JST）。これを過ぎたら当日の収集は済んだものとして扱う
DEFAULT_COLLECTION_TIME = "08:30"
DEFAULT_COLOR = "#95a5a6"

#: Notion へ書き出す期間（今日からの日数）
DEFAULT_NOTION_WINDOW_DAYS = 60
#: 「種類」プロパティへ入れる値。myroom が書いたページの目印になる
DEFAULT_NOTION_CATEGORY_VALUE = "ゴミの日"
#: 書き込み先のプロパティ名。Notion 側で名前を変えている場合だけ設定で上書きする
DEFAULT_NOTION_PROPERTIES = {
    "title": "タイトル",
    "date": "日付",
    "category": "種類",
    "memo": "メモ",
}

#: 今日・明日より先の収集予定として返す最大件数
UPCOMING_LIMIT = 3
#: 予定を探す範囲（第N曜日ルールでも2か月あれば必ず1回は見つかる）
UPCOMING_SEARCH_DAYS = 70

WEEKDAY_ALIASES: Dict[str, int] = {
    "mon": 0, "monday": 0, "月": 0, "月曜": 0, "月曜日": 0,
    "tue": 1, "tuesday": 1, "火": 1, "火曜": 1, "火曜日": 1,
    "wed": 2, "wednesday": 2, "水": 2, "水曜": 2, "水曜日": 2,
    "thu": 3, "thursday": 3, "木": 3, "木曜": 3, "木曜日": 3,
    "fri": 4, "friday": 4, "金": 4, "金曜": 4, "金曜日": 4,
    "sat": 5, "saturday": 5, "土": 5, "土曜": 5, "土曜日": 5,
    "sun": 6, "sunday": 6, "日": 6, "日曜": 6, "日曜日": 6,
}

WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"]


def get_today_jst() -> datetime.date:
    return datetime.datetime.now(JST).date()


def weekday_label(day: datetime.date) -> str:
    return WEEKDAY_LABELS[day.weekday()]


def _parse_weekday(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 0 <= value <= 6 else None
    if isinstance(value, str):
        return WEEKDAY_ALIASES.get(value.strip().lower())
    return None


def _parse_weeks(value: Any) -> List[int]:
    raw = value if isinstance(value, list) else [value]
    weeks: List[int] = []
    for entry in raw:
        if isinstance(entry, bool) or not isinstance(entry, int):
            continue
        if entry in weeks:
            continue
        if 1 <= entry <= 5 or entry == -1:
            weeks.append(entry)
    return weeks


def _parse_date(value: Any) -> Optional[datetime.date]:
    if not isinstance(value, str):
        return None
    try:
        return datetime.date.fromisoformat(value.strip())
    except ValueError:
        return None


def _parse_collection_time(value: Any) -> Optional[str]:
    """"HH:MM" を検証して "%02d:%02d" へ正規化する。壊れた値・範囲外は None を返す。

    手で書くファイルなので "9:15" のような0詰めしない書き方も受ける。秒まで書かれていても
    分単位へ丸める（画面には "8:30" として出すため）。
    """
    if not isinstance(value, str):
        return None
    parts = value.strip().split(":")
    if len(parts) < 2:
        return None
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return f"{hour:02d}:{minute:02d}"


def collection_time_of(config: Dict[str, Any]) -> datetime.time:
    """設定の collection_time を time として返す。"""
    hour, minute = config["collection_time"].split(":")
    return datetime.time(int(hour), int(minute))


def _normalize_rule(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    rule_type = str(raw.get("type", "weekly")).strip().lower()

    if rule_type == "weekly":
        source = raw.get("weekdays", raw.get("weekday"))
        entries = source if isinstance(source, list) else [source]
        weekdays: List[int] = []
        for entry in entries:
            weekday = _parse_weekday(entry)
            if weekday is not None and weekday not in weekdays:
                weekdays.append(weekday)
        if not weekdays:
            return None
        return {"type": "weekly", "weekdays": weekdays}

    if rule_type == "monthly":
        weekday = _parse_weekday(raw.get("weekday"))
        weeks = _parse_weeks(raw.get("weeks", raw.get("week")))
        if weekday is None or not weeks:
            return None
        return {"type": "monthly", "weekday": weekday, "weeks": weeks}

    logger.warning("Unknown garbage rule type: %s", rule_type)
    return None


def _normalize_category(raw: Any, index: int) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    name = str(raw.get("name") or "").strip()
    if not name:
        return None

    category_id = str(raw.get("id") or "").strip() or f"category{index + 1}"
    color = str(raw.get("color") or "").strip() or DEFAULT_COLOR
    note = str(raw.get("note") or "").strip()

    rules = [rule for rule in map(_normalize_rule, raw.get("rules") or []) if rule]

    return {
        "id": category_id,
        "name": name,
        "color": color,
        "note": note,
        "rules": rules,
    }


def _normalize_exception(raw: Any, category_ids: List[str]) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    day = _parse_date(raw.get("date"))
    if day is None:
        return None

    cancel_raw = raw.get("cancel", False)
    if cancel_raw is True:
        cancel: Any = True
    elif isinstance(cancel_raw, list):
        cancel = [str(entry) for entry in cancel_raw if str(entry) in category_ids]
    else:
        cancel = []

    add_raw = raw.get("add") or []
    add = [str(entry) for entry in add_raw if str(entry) in category_ids] if isinstance(add_raw, list) else []

    return {
        "date": day,
        "cancel": cancel,
        "add": add,
        "note": str(raw.get("note") or "").strip(),
    }


def _normalize_notion(raw: Any) -> Dict[str, Any]:
    """Notion への書き出し設定。未指定・壊れた値は既定へ落とす。"""
    source = raw if isinstance(raw, dict) else {}

    window_days = source.get("window_days", DEFAULT_NOTION_WINDOW_DAYS)
    if (
        isinstance(window_days, bool)
        or not isinstance(window_days, int)
        or not 1 <= window_days <= 365
    ):
        window_days = DEFAULT_NOTION_WINDOW_DAYS

    properties = dict(DEFAULT_NOTION_PROPERTIES)
    raw_properties = source.get("properties")
    if isinstance(raw_properties, dict):
        for field in properties:
            name = raw_properties.get(field)
            if isinstance(name, str) and name.strip():
                properties[field] = name.strip()

    return {
        # 既定は有効。実際に書き出すかどうかは環境変数（トークン・データソースID）で決まる
        "enabled": source.get("enabled", True) is not False,
        "window_days": window_days,
        "category_value": (
            str(source.get("category_value") or "").strip() or DEFAULT_NOTION_CATEGORY_VALUE
        ),
        "properties": properties,
    }


def _empty_config() -> Dict[str, Any]:
    return {
        "configured": False,
        "area": "",
        "notify_hour": DEFAULT_NOTIFY_HOUR,
        "collection_time": DEFAULT_COLLECTION_TIME,
        "categories": [],
        "exceptions": [],
        "notion": _normalize_notion(None),
    }


def _normalize_config(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return _empty_config()

    categories = [
        category
        for category in (
            _normalize_category(entry, index)
            for index, entry in enumerate(raw.get("categories") or [])
        )
        if category
    ]
    category_ids = [category["id"] for category in categories]

    exceptions = [
        exception
        for exception in (
            _normalize_exception(entry, category_ids)
            for entry in (raw.get("exceptions") or [])
        )
        if exception
    ]

    notify_hour = raw.get("notify_hour", DEFAULT_NOTIFY_HOUR)
    if isinstance(notify_hour, bool) or not isinstance(notify_hour, int) or not 0 <= notify_hour <= 23:
        notify_hour = DEFAULT_NOTIFY_HOUR

    collection_time = _parse_collection_time(raw.get("collection_time")) or DEFAULT_COLLECTION_TIME

    return {
        "configured": bool(categories),
        "area": str(raw.get("area") or "").strip(),
        "notify_hour": notify_hour,
        "collection_time": collection_time,
        "categories": categories,
        "exceptions": exceptions,
        "notion": _normalize_notion(raw.get("notion")),
    }


def load_config() -> Dict[str, Any]:
    """収集ルールを読み込む。ファイルが無い・壊れている場合は未設定として扱う。"""
    if not CONFIG_PATH.exists():
        return _empty_config()

    try:
        with CONFIG_PATH.open(encoding="utf-8") as f:
            return _normalize_config(json.load(f))
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        logger.warning("Failed to read %s; treating garbage schedule as unconfigured", CONFIG_PATH)
        return _empty_config()


def _nth_weekday_of_month(day: datetime.date) -> int:
    """その日が月内で第何週目の曜日か（第1〜第5）。"""
    return (day.day - 1) // 7 + 1


def _is_last_weekday_of_month(day: datetime.date) -> bool:
    days_in_month = calendar.monthrange(day.year, day.month)[1]
    return day.day + 7 > days_in_month


def _rule_matches(rule: Dict[str, Any], day: datetime.date) -> bool:
    if rule["type"] == "weekly":
        return day.weekday() in rule["weekdays"]

    if rule["type"] == "monthly":
        if day.weekday() != rule["weekday"]:
            return False
        weeks = rule["weeks"]
        if _nth_weekday_of_month(day) in weeks:
            return True
        return -1 in weeks and _is_last_weekday_of_month(day)

    return False


def _exceptions_on(config: Dict[str, Any], day: datetime.date) -> List[Dict[str, Any]]:
    return [exception for exception in config["exceptions"] if exception["date"] == day]


def categories_on(config: Dict[str, Any], day: datetime.date) -> List[Dict[str, Any]]:
    """指定日に収集される品目。exceptions による中止・臨時収集を反映する。"""
    exceptions = _exceptions_on(config, day)
    cancelled_all = any(exception["cancel"] is True for exception in exceptions)
    cancelled_ids = {
        category_id
        for exception in exceptions
        if isinstance(exception["cancel"], list)
        for category_id in exception["cancel"]
    }
    added_ids = {
        category_id for exception in exceptions for category_id in exception["add"]
    }

    collected: List[Dict[str, Any]] = []
    for category in config["categories"]:
        if category["id"] in added_ids:
            scheduled = True
        elif cancelled_all or category["id"] in cancelled_ids:
            scheduled = False
        else:
            scheduled = any(_rule_matches(rule, day) for rule in category["rules"])

        if scheduled:
            collected.append(
                {
                    "id": category["id"],
                    "name": category["name"],
                    "color": category["color"],
                    "note": category["note"],
                }
            )
    return collected


def build_day(config: Dict[str, Any], day: datetime.date, today: datetime.date) -> Dict[str, Any]:
    return {
        "date": day.isoformat(),
        "weekday": weekday_label(day),
        "days_until": (day - today).days,
        "categories": categories_on(config, day),
        "notes": [
            exception["note"] for exception in _exceptions_on(config, day) if exception["note"]
        ],
    }


def collection_days(
    config: Dict[str, Any],
    start: datetime.date,
    end: datetime.date,
) -> List[Dict[str, Any]]:
    """start〜end（両端を含む）のうち、収集がある日を古い順に返す。

    build_day() は「今日から何日後か」を出すために基準日を要る。期間をまとめて書き出す
    用途では基準日が意味を持たないため、日付・曜日・品目・注記だけを返す別の入口にする。
    """
    days: List[Dict[str, Any]] = []
    day = start
    while day <= end:
        categories = categories_on(config, day)
        if categories:
            days.append(
                {
                    "date": day,
                    "weekday": weekday_label(day),
                    "categories": categories,
                    "notes": [
                        exception["note"]
                        for exception in _exceptions_on(config, day)
                        if exception["note"]
                    ],
                }
            )
        day += datetime.timedelta(days=1)
    return days


def find_upcoming(
    config: Dict[str, Any],
    today: datetime.date,
    *,
    start_offset: int = 2,
    limit: int = UPCOMING_LIMIT,
) -> List[Dict[str, Any]]:
    """start_offset 日後以降で、収集がある日を limit 件返す。"""
    upcoming: List[Dict[str, Any]] = []
    for offset in range(start_offset, UPCOMING_SEARCH_DAYS):
        day = today + datetime.timedelta(days=offset)
        entry = build_day(config, day, today)
        if entry["categories"]:
            upcoming.append(entry)
            if len(upcoming) >= limit:
                break
    return upcoming


def find_next_by_category(
    config: Dict[str, Any],
    today: datetime.date,
    *,
    start_offset: int = 0,
) -> List[Dict[str, Any]]:
    """品目ごとに「次にいつ出せるか」を求める。

    設定に書いた品目の順でそのまま返す（カードもこの順に並べる）。既定では今日の収集も対象に
    含めるが、当日の収集が済んでいる（collection_time を過ぎている）場合は start_offset=1 を
    渡して明日以降から探す。UPCOMING_SEARCH_DAYS 先まで見つからない品目は next を None にして、
    行そのものは残す（ルールの書き忘れに気付けるようにするため）。
    """
    pending = {category["id"]: category for category in config["categories"]}
    found: Dict[str, Dict[str, Any]] = {}

    for offset in range(start_offset, UPCOMING_SEARCH_DAYS):
        if not pending:
            break
        day = today + datetime.timedelta(days=offset)
        for collected in categories_on(config, day):
            if collected["id"] in pending and collected["id"] not in found:
                found[collected["id"]] = {
                    "date": day.isoformat(),
                    "weekday": weekday_label(day),
                    "days_until": offset,
                }
        pending = {
            category_id: category
            for category_id, category in pending.items()
            if category_id not in found
        }

    return [
        {
            "id": category["id"],
            "name": category["name"],
            "color": category["color"],
            "note": category["note"],
            "next": found.get(category["id"]),
        }
        for category in config["categories"]
    ]


def is_today_collection_done(
    config: Dict[str, Any],
    today: datetime.date,
    now: Optional[datetime.datetime],
) -> bool:
    """当日の収集がもう終わっているか。

    now を渡さない（基準時刻が分からない）場合は「まだ」として扱う。日付だけを指定する
    呼び出し（テスト・Notion への書き出しなど）で、時刻を持ち出さずに済ませるため。
    """
    if now is None or now.date() != today:
        return False
    if not categories_on(config, today):
        return False
    return now.time() >= collection_time_of(config)


def build_payload(
    today: Optional[datetime.date] = None,
    now: Optional[datetime.datetime] = None,
) -> Dict[str, Any]:
    """ダッシュボードのゴミの日カード用のペイロード。

    now（JST）を渡すと collection_time との比較で「当日の収集は済んだか」を判定し、
    済んでいれば品目ごとの次の収集を明日以降から探す。カード先頭の「次の収集」を
    繰り上げるのは今日の行を残したままにしたいフロント側の仕事なので、today は
    そのまま返し、判定の結果だけを today_done として添える（#270）。
    """
    config = load_config()
    if today is None and now is None:
        now = datetime.datetime.now(JST)
    if today is None:
        today = now.date()
    tomorrow = today + datetime.timedelta(days=1)
    today_done = is_today_collection_done(config, today, now)

    return {
        "configured": config["configured"],
        "area": config["area"],
        "collection_time": config["collection_time"],
        "today_done": today_done,
        "today": build_day(config, today, today),
        "tomorrow": build_day(config, tomorrow, today),
        "upcoming": find_upcoming(config, today) if config["configured"] else [],
        "by_category": (
            find_next_by_category(config, today, start_offset=1 if today_done else 0)
            if config["configured"]
            else []
        ),
    }
