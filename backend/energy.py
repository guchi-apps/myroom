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

#: ダッシュボードのカードが使う日別データの本数（直近30日ぶん）
DEFAULT_HISTORY_DAYS = 30


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
    return [
        {
            "date": row.date,
            "source": row.source,
            "kwh": row.kwh,
            "cost_yen": row.cost_yen,
            "updated_at": row.updated_at,
        }
        for row in rows
    ]


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
