"""日別の電力使用量（`daily_energy`）の保存と集計。

取得元は日ごとの使用量（kWh）しか返さないことが多いため、金額は
`ui_settings` の `energy_unit_price`（円/kWh）を掛けて出す。取得元が金額まで
返してきた場合だけ、その値（`cost_yen`）を優先する。

集計の区切りは日付そのもの（JST の暦日）で、時刻は持たない。同じ日を何度
送っても最後の値で上書きする（AirCloud Home の当日ぶんは1日のあいだ増えて
いくため、追記ではなく上書きでないと二重計上になる）。
"""

from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy.orm import Session

from . import database, ui_settings

DEFAULT_SOURCE = "aircon"

#: スマートプラグの `source` に付く前置き（`tapo:冷蔵庫`）。
#: 「種別:識別子」の形にしておくと、機器が増えても列を足さずに済む。
TAPO_SOURCE_PREFIX = "tapo:"

#: ダッシュボードのカードが使う日別データの本数（直近30日ぶん）
DEFAULT_HISTORY_DAYS = 30


def source_label(source: str) -> str:
    """`source` を画面に出す名前へ。

    `aircon` → `エアコン`、`tapo:冷蔵庫` → `冷蔵庫`。知らない取得元はそのまま返す
    （取得元が増えたときに、名前が出ないより生の値が出るほうが原因を追える）。
    """
    if source == DEFAULT_SOURCE:
        return "エアコン"
    if source.startswith(TAPO_SOURCE_PREFIX):
        return source[len(TAPO_SOURCE_PREFIX) :] or source
    return source


def get_unit_price(db: Optional[Session] = None) -> float:
    settings = ui_settings.get_settings(db)
    return float(
        settings.get(
            ui_settings.SETTING_ENERGY_UNIT_PRICE,
            ui_settings.DEFAULT_ENERGY_UNIT_PRICE,
        )
    )


def parse_date(value: Any) -> datetime.date:
    """`2026-08-22` 形式、または date/datetime を日付へ落とす。"""
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    if isinstance(value, str):
        text = value.strip()
        try:
            return datetime.date.fromisoformat(text[:10])
        except ValueError as exc:
            raise ValueError(f"Invalid date: {value}") from exc
    raise ValueError(f"Invalid date: {value}")


def resolve_cost(kwh: Optional[float], cost_yen: Optional[float], unit_price: float) -> Optional[float]:
    """取得元が金額を返していればそれを、無ければ単価から計算する。"""
    if cost_yen is not None:
        return float(cost_yen)
    if kwh is None:
        return None
    return round(float(kwh) * unit_price, 1)


def upsert_records(db: Session, records: Sequence[Dict[str, Any]]) -> int:
    """同じ (date, source) は上書きする。書き込んだ件数を返す。"""
    written = 0
    for item in records:
        date = parse_date(item["date"])
        source = (item.get("source") or DEFAULT_SOURCE).strip() or DEFAULT_SOURCE
        row = (
            db.query(database.DailyEnergyRecord)
            .filter(
                database.DailyEnergyRecord.date == date,
                database.DailyEnergyRecord.source == source,
            )
            .first()
        )
        if row is None:
            row = database.DailyEnergyRecord(date=date, source=source)
            db.add(row)
        row.kwh = item.get("kwh")
        row.cost_yen = item.get("cost_yen")
        row.power_w = item.get("power_w")
        row.updated_at = datetime.datetime.utcnow()
        written += 1

    db.commit()
    return written


def _fetch_rows(
    db: Session,
    source: str,
    start: datetime.date,
    end: datetime.date,
) -> List[Dict[str, Any]]:
    rows = (
        db.query(database.DailyEnergyRecord)
        .filter(
            database.DailyEnergyRecord.source == source,
            database.DailyEnergyRecord.date >= start,
            database.DailyEnergyRecord.date <= end,
        )
        .order_by(database.DailyEnergyRecord.date.asc())
        .all()
    )
    return _serialize_rows(rows)


def _serialize_rows(rows: Sequence[Any]) -> List[Dict[str, Any]]:
    return [
        {
            "date": row.date,
            "source": row.source,
            "kwh": row.kwh,
            "cost_yen": row.cost_yen,
            "power_w": row.power_w,
            "updated_at": row.updated_at,
        }
        for row in rows
    ]


def _fetch_all_rows(
    db: Session, start: datetime.date, end: datetime.date
) -> List[Dict[str, Any]]:
    """取得元を絞らずに引く。消費電力カードはエアコンとプラグを1枚にまとめるため。"""
    rows = (
        db.query(database.DailyEnergyRecord)
        .filter(
            database.DailyEnergyRecord.date >= start,
            database.DailyEnergyRecord.date <= end,
        )
        .order_by(
            database.DailyEnergyRecord.date.asc(),
            database.DailyEnergyRecord.source.asc(),
        )
        .all()
    )
    return _serialize_rows(rows)


def _total(rows: Sequence[Dict[str, Any]], unit_price: float) -> Dict[str, Any]:
    kwh = sum(float(row["kwh"]) for row in rows if row.get("kwh") is not None)
    cost = sum(
        cost
        for cost in (
            resolve_cost(row.get("kwh"), row.get("cost_yen"), unit_price) for row in rows
        )
        if cost is not None
    )
    return {
        "kwh": round(kwh, 2),
        "cost_yen": round(cost),
        "days": len(rows),
    }


def _month_start(date: datetime.date) -> datetime.date:
    return date.replace(day=1)


def _previous_month_start(date: datetime.date) -> datetime.date:
    return (date.replace(day=1) - datetime.timedelta(days=1)).replace(day=1)


def _same_day_of_previous_month(date: datetime.date) -> datetime.date:
    """先月の「同じ日」。月末の日数差は先月末で頭打ちにする。"""
    prev_start = _previous_month_start(date)
    last_day = (date.replace(day=1) - datetime.timedelta(days=1)).day
    return prev_start.replace(day=min(date.day, last_day))


def build_summary(
    rows: Sequence[Dict[str, Any]],
    today: datetime.date,
    unit_price: float,
    source: str,
    history_days: int = DEFAULT_HISTORY_DAYS,
) -> Dict[str, Any]:
    """カードが必要とする集計をまとめて作る。DBアクセスを含まない（テストしやすくするため）。"""
    by_date = {row["date"]: row for row in rows}

    def day_payload(date: datetime.date) -> Optional[Dict[str, Any]]:
        row = by_date.get(date)
        if row is None:
            return None
        return {
            "date": date.isoformat(),
            "kwh": round(float(row["kwh"]), 2) if row.get("kwh") is not None else None,
            "cost_yen": resolve_cost(row.get("kwh"), row.get("cost_yen"), unit_price),
        }

    yesterday = today - datetime.timedelta(days=1)
    month_start = _month_start(today)
    prev_month_start = _previous_month_start(today)
    prev_month_end = month_start - datetime.timedelta(days=1)
    prev_month_same_day = _same_day_of_previous_month(today)

    this_month_rows = [row for row in rows if month_start <= row["date"] <= today]
    last_month_rows = [row for row in rows if prev_month_start <= row["date"] <= prev_month_end]
    last_month_to_date_rows = [
        row for row in rows if prev_month_start <= row["date"] <= prev_month_same_day
    ]

    history_start = today - datetime.timedelta(days=history_days - 1)
    daily = [
        {
            "date": row["date"].isoformat(),
            "kwh": round(float(row["kwh"]), 2) if row.get("kwh") is not None else None,
            "cost_yen": resolve_cost(row.get("kwh"), row.get("cost_yen"), unit_price),
        }
        for row in rows
        if history_start <= row["date"] <= today
    ]

    latest = max((row["date"] for row in rows), default=None)
    updated_at = max(
        (row["updated_at"] for row in rows if row.get("updated_at") is not None),
        default=None,
    )

    return {
        "source": source,
        "unit_price": unit_price,
        "today": day_payload(today),
        "yesterday": day_payload(yesterday),
        "this_month": {
            **_total(this_month_rows, unit_price),
            "start": month_start.isoformat(),
            "end": today.isoformat(),
        },
        "last_month": {
            **_total(last_month_rows, unit_price),
            "start": prev_month_start.isoformat(),
            "end": prev_month_end.isoformat(),
        },
        "last_month_to_date": {
            **_total(last_month_to_date_rows, unit_price),
            "start": prev_month_start.isoformat(),
            "end": prev_month_same_day.isoformat(),
        },
        "daily": daily,
        "latest_date": latest.isoformat() if latest else None,
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


def get_summary(
    db: Optional[Session],
    today: datetime.date,
    source: str = DEFAULT_SOURCE,
    history_days: int = DEFAULT_HISTORY_DAYS,
) -> Dict[str, Any]:
    unit_price = get_unit_price(db)

    if database.DB_MOCK or db is None:
        rows = database.generate_mock_daily_energy(source)
    else:
        # 先月ぶんの集計にも足りるよう、月初より前から引く
        start = min(
            _previous_month_start(today),
            today - datetime.timedelta(days=history_days - 1),
        )
        rows = _fetch_rows(db, source, start, today)

    return build_summary(rows, today, unit_price, source, history_days=history_days)


# --------------------------------------------------------------- 取得元をまたぐ集計
#
# 消費電力カードはエアコン（`aircon`）とスマートプラグ（`tapo:*`）を1枚にまとめる。
# 知りたいのは「家全体で今月いくらか」で、取得元ごとにカードを分けると足し算が
# 読み手の仕事になるため。`daily_energy` が取得元非依存の1テーブルなのに合わせて、
# 画面へ渡す集計もここで1つに畳む。


def _period_total(
    rows: Sequence[Dict[str, Any]], unit_price: float
) -> Dict[str, Any]:
    """期間合計。`days` は**行数ではなく日数**を数える。

    取得元が複数あると1日につき複数行あるため、`len(rows)` を日数として使うと
    「4台つないだ月は日数が4倍」になってしまう。
    """
    kwh = sum(float(row["kwh"]) for row in rows if row.get("kwh") is not None)
    cost = sum(
        cost
        for cost in (
            resolve_cost(row.get("kwh"), row.get("cost_yen"), unit_price) for row in rows
        )
        if cost is not None
    )
    return {
        "kwh": round(kwh, 2),
        "cost_yen": round(cost),
        "days": len({row["date"] for row in rows}),
    }


def _source_order_key(entry: Dict[str, Any]) -> Any:
    """エアコンを先頭に、あとは今月の使用量が多い順。

    毎回同じ並びにしたいので、使用量が並んだときは取得元の名前で決める。
    """
    return (
        0 if entry["source"] == DEFAULT_SOURCE else 1,
        -entry["this_month_kwh"],
        entry["source"],
    )


def build_breakdown(
    rows: Sequence[Dict[str, Any]],
    today: datetime.date,
    unit_price: float,
    history_days: int = DEFAULT_HISTORY_DAYS,
) -> Dict[str, Any]:
    """カードと詳細パネルが必要とするものをまとめて作る。DBアクセスを含まない。"""
    month_start = _month_start(today)
    prev_month_start = _previous_month_start(today)
    prev_month_end = month_start - datetime.timedelta(days=1)
    prev_month_same_day = _same_day_of_previous_month(today)
    history_start = today - datetime.timedelta(days=history_days - 1)

    def in_range(row: Dict[str, Any], start: datetime.date, end: datetime.date) -> bool:
        return start <= row["date"] <= end

    # --- 取得元ごとの行 -------------------------------------------------
    sources: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        entry = sources.setdefault(
            row["source"],
            {
                "source": row["source"],
                "label": source_label(row["source"]),
                "today_kwh": None,
                "today_cost_yen": None,
                "power_w": None,
                "this_month_kwh": 0.0,
                "latest_date": None,
            },
        )
        if row["date"] == today:
            entry["today_kwh"] = (
                round(float(row["kwh"]), 2) if row.get("kwh") is not None else None
            )
            entry["today_cost_yen"] = resolve_cost(
                row.get("kwh"), row.get("cost_yen"), unit_price
            )
            entry["power_w"] = row.get("power_w")
        if in_range(row, month_start, today) and row.get("kwh") is not None:
            entry["this_month_kwh"] += float(row["kwh"])
        if entry["latest_date"] is None or row["date"] > entry["latest_date"]:
            entry["latest_date"] = row["date"]

    source_rows = sorted(sources.values(), key=_source_order_key)
    for entry in source_rows:
        entry["this_month_kwh"] = round(entry["this_month_kwh"], 2)
        entry["latest_date"] = (
            entry["latest_date"].isoformat() if entry["latest_date"] else None
        )

    # --- 日別（取得元ごとの内訳つき） -----------------------------------
    daily_map: Dict[datetime.date, Dict[str, Any]] = {}
    for row in rows:
        if not in_range(row, history_start, today):
            continue
        day = daily_map.setdefault(
            row["date"], {"date": row["date"], "kwh": 0.0, "cost_yen": 0.0, "by_source": {}}
        )
        if row.get("kwh") is not None:
            day["kwh"] += float(row["kwh"])
            day["by_source"][row["source"]] = round(float(row["kwh"]), 2)
        cost = resolve_cost(row.get("kwh"), row.get("cost_yen"), unit_price)
        if cost is not None:
            day["cost_yen"] += cost

    daily = [
        {
            "date": day["date"].isoformat(),
            "kwh": round(day["kwh"], 2),
            "cost_yen": round(day["cost_yen"]),
            "by_source": day["by_source"],
        }
        for day in sorted(daily_map.values(), key=lambda item: item["date"])
    ]

    today_rows = [row for row in rows if row["date"] == today]
    latest = max((row["date"] for row in rows), default=None)
    updated_at = max(
        (row["updated_at"] for row in rows if row.get("updated_at") is not None),
        default=None,
    )

    return {
        "unit_price": unit_price,
        "sources": source_rows,
        "today": {
            "date": today.isoformat(),
            **_period_total(today_rows, unit_price),
        },
        "this_month": {
            **_period_total(
                [row for row in rows if in_range(row, month_start, today)], unit_price
            ),
            "start": month_start.isoformat(),
            "end": today.isoformat(),
        },
        "last_month": {
            **_period_total(
                [row for row in rows if in_range(row, prev_month_start, prev_month_end)],
                unit_price,
            ),
            "start": prev_month_start.isoformat(),
            "end": prev_month_end.isoformat(),
        },
        "last_month_to_date": {
            **_period_total(
                [
                    row
                    for row in rows
                    if in_range(row, prev_month_start, prev_month_same_day)
                ],
                unit_price,
            ),
            "start": prev_month_start.isoformat(),
            "end": prev_month_same_day.isoformat(),
        },
        "daily": daily,
        "latest_date": latest.isoformat() if latest else None,
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


def get_breakdown(
    db: Optional[Session],
    today: datetime.date,
    history_days: int = DEFAULT_HISTORY_DAYS,
) -> Dict[str, Any]:
    unit_price = get_unit_price(db)

    if database.DB_MOCK or db is None:
        rows = database.generate_mock_energy_rows()
    else:
        # 先月ぶんの集計にも足りるよう、月初より前から引く
        start = min(
            _previous_month_start(today),
            today - datetime.timedelta(days=history_days - 1),
        )
        rows = _fetch_all_rows(db, start, today)

    return build_breakdown(rows, today, unit_price, history_days=history_days)
