"""お掃除ロボット（eufy Clean）の稼働履歴（`cleaner_runs`）の記録と集計。

**記録するのは状態が変わった瞬間だけ。** サブPCの収集スクリプトは数分おきに機器を読んで
毎回送ってくるが、そのまま行にすると3分間隔で1日480行になり、履歴として読めなくなる。
直前の行と同じ状態なら新しい行を作らず、その行の `updated_at`（最後に同じ状態を確認した
時刻）と `battery` を更新するだけにする。

そのため `battery` は「起動時の残量」ではなく **その状態で最後に観測した残量** になる。
充電中の行なら充電が進むにつれて上がっていく。カードに出したいのは「いまどれだけ入って
いるか」なので、この意味のほうが都合がよい。

稼働（run）はテーブルに直接は持たない。`cleaning` の行を起点に、次の行までを1回の稼働と
みなして組み立てる。最後の行が `cleaning` なら、それはまだ動いている最中。
"""

from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy.orm import Session

from . import database

#: 掃除している状態。この行が1回の稼働の起点になる
EVENT_CLEANING = "cleaning"

#: 受け付ける状態と画面に出す名前。知らない値はそのまま通す（機種が増えたときに
#: 名前が出ないより、生の値が出るほうが原因を追える）
EVENT_LABELS: Dict[str, str] = {
    EVENT_CLEANING: "掃除中",
    "returning": "帰還中",
    "charging": "充電中",
    "docked": "待機中",
    "paused": "一時停止",
    "sleeping": "スリープ",
    "error": "エラー",
}

#: 収集側の言い回しをこちらの名前へ寄せる。Tuya の `status` DP は機種・ファーム
#: によって表記が揺れる（`Charging` / `charging` / `Recharge` など）
EVENT_ALIASES: Dict[str, str] = {
    "clean": EVENT_CLEANING,
    "cleaning": EVENT_CLEANING,
    "running": EVENT_CLEANING,
    "wall_follow": EVENT_CLEANING,
    "spiral": EVENT_CLEANING,
    "smart": EVENT_CLEANING,
    "auto": EVENT_CLEANING,
    "spot": EVENT_CLEANING,
    "single_room": EVENT_CLEANING,
    "selectroom": EVENT_CLEANING,
    "zone": EVENT_CLEANING,
    "edge": EVENT_CLEANING,
    "nosweep": EVENT_CLEANING,
    "recharge": "returning",
    "chargego": "returning",
    "goto_charge": "returning",
    "back_charge": "returning",
    "returning": "returning",
    "charging": "charging",
    "completed": "docked",
    "standby": "docked",
    "docked": "docked",
    "sleep": "sleeping",
    "sleeping": "sleeping",
    "pause": "paused",
    "paused": "paused",
    "stop": "paused",
    "error": "error",
    "fault": "error",
}

#: カードに並べる直近の稼働の本数
DEFAULT_RECENT_RUNS = 4

#: 集計に使う履歴の長さ。当月の回数と平均を出せればよいので、月初をまたぐぶんだけ持つ
DEFAULT_HISTORY_DAYS = 62

#: 最後に確認できてからこれ以上たっていたら「受信が途絶えている」とみなす。
#: 収集は3分間隔なので、数回落としたくらいでは警告しない幅を取る
STALE_MINUTES = 30


def normalize_event(value: Any) -> str:
    """収集側から来た状態名をこちらの名前へ。"""
    text = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if not text:
        raise ValueError("event is empty")
    # 知らない値をそのまま通すため、列の長さ（VARCHAR(20)）で頭を切っておく。
    # ここで切らないと、機種が変わったときに INSERT ごと落ちる
    return EVENT_ALIASES.get(text, text)[:20]


def event_label(event: str) -> str:
    return EVENT_LABELS.get(event, event)


def parse_datetime(value: Any) -> datetime.datetime:
    """`2026-08-22 14:32:00` 形式、または datetime を naive な JST の datetime へ。"""
    if isinstance(value, datetime.datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    if isinstance(value, str):
        text = value.strip()
        for parser in (
            lambda t: datetime.datetime.strptime(t, "%Y-%m-%d %H:%M:%S"),
            datetime.datetime.fromisoformat,
        ):
            try:
                parsed = parser(text)
            except ValueError:
                continue
            return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
    raise ValueError(f"Invalid datetime: {value}")


def parse_battery(value: Any) -> Optional[int]:
    """0〜100 に収める。範囲外・数値でないものは「取れなかった」として捨てる。"""
    if value is None:
        return None
    try:
        battery = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    if battery < 0 or battery > 100:
        return None
    return battery


# ---------------------------------------------------------------- 記録


def _latest_record(db: Session) -> Optional[Any]:
    return (
        db.query(database.CleanerRunRecord)
        .order_by(database.CleanerRunRecord.datetime.desc())
        .first()
    )


def record_observation(
    db: Session,
    observed_at: datetime.datetime,
    event: str,
    battery: Optional[int] = None,
) -> Dict[str, Any]:
    """1回の観測を反映する。状態が変わったときだけ行が増える。

    戻り値の `changed` は行が増えたかどうか。収集スクリプトのログで
    「送ったのに増えていない＝状態が変わっていない」を読み取れるようにしている。
    """
    latest = _latest_record(db)

    if latest is not None and latest.event == event:
        # 同じ状態が続いている。行は増やさず、最後に確認した時刻と残量だけ進める。
        # 観測が過去に戻ることはないが、時計のずれで巻き戻らないよう max を取る。
        if latest.updated_at is None or observed_at > latest.updated_at:
            latest.updated_at = observed_at
        if battery is not None:
            latest.battery = battery
        db.commit()
        return {"changed": False, "event": event}

    if latest is not None and observed_at <= latest.datetime:
        # 同じ秒に別の状態が来た場合でも主キーが衝突しないようずらす。
        observed_at = latest.datetime + datetime.timedelta(seconds=1)

    db.add(
        database.CleanerRunRecord(
            datetime=observed_at,
            event=event,
            battery=battery,
            updated_at=observed_at,
        )
    )
    db.commit()
    return {"changed": True, "event": event}


# ---------------------------------------------------------------- 集計


def _serialize_rows(rows: Sequence[Any]) -> List[Dict[str, Any]]:
    return [
        {
            "datetime": row.datetime,
            "event": row.event,
            "battery": row.battery,
            "updated_at": row.updated_at,
        }
        for row in rows
    ]


def _fetch_rows(
    db: Session, start: datetime.datetime, end: datetime.datetime
) -> List[Dict[str, Any]]:
    rows = (
        db.query(database.CleanerRunRecord)
        .filter(
            database.CleanerRunRecord.datetime >= start,
            database.CleanerRunRecord.datetime <= end,
        )
        .order_by(database.CleanerRunRecord.datetime.asc())
        .all()
    )
    return _serialize_rows(rows)


def _minutes_between(start: datetime.datetime, end: datetime.datetime) -> int:
    return max(0, int(round((end - start).total_seconds() / 60.0)))


def build_runs(
    rows: Sequence[Dict[str, Any]], now: datetime.datetime
) -> List[Dict[str, Any]]:
    """`cleaning` の行を1回の稼働に組み立てる（古い順）。

    終わりは次の行の時刻。次の行が無ければまだ動いている最中で、経過時間は「いま」まで。
    """
    ordered = sorted(rows, key=lambda row: row["datetime"])
    runs: List[Dict[str, Any]] = []

    for index, row in enumerate(ordered):
        if row["event"] != EVENT_CLEANING:
            continue
        started_at = row["datetime"]
        ended_at = ordered[index + 1]["datetime"] if index + 1 < len(ordered) else None
        running = ended_at is None
        runs.append(
            {
                "started_at": started_at.isoformat(),
                "ended_at": ended_at.isoformat() if ended_at else None,
                "duration_minutes": _minutes_between(started_at, ended_at or now),
                "running": running,
            }
        )

    return runs


def _month_start(value: datetime.datetime) -> datetime.datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def build_summary(
    rows: Sequence[Dict[str, Any]],
    now: datetime.datetime,
    recent_limit: int = DEFAULT_RECENT_RUNS,
) -> Dict[str, Any]:
    """カードが必要とするものをまとめて作る。DBアクセスを含まない。"""
    ordered = sorted(rows, key=lambda row: row["datetime"])
    runs = build_runs(ordered, now)

    latest = ordered[-1] if ordered else None
    last_seen = None
    if latest is not None:
        last_seen = latest["updated_at"] or latest["datetime"]

    current = None
    if latest is not None:
        current = {
            "event": latest["event"],
            "label": event_label(latest["event"]),
            "since": latest["datetime"].isoformat(),
            "battery": latest["battery"],
        }

    # 当月の回数と平均。平均は終わった稼働だけで出す（動いている最中のものを
    # 混ぜると、時間がたつほど平均が伸びていく）
    month_start = _month_start(now)
    month_runs = [
        run
        for run in runs
        if datetime.datetime.fromisoformat(run["started_at"]) >= month_start
    ]
    finished = [run for run in month_runs if not run["running"]]
    average_minutes = (
        int(round(sum(run["duration_minutes"] for run in finished) / len(finished)))
        if finished
        else None
    )

    # 前回の稼働からの間隔。1回しか記録が無ければ出しようがない
    days_since_previous = None
    if len(runs) >= 2:
        last_start = datetime.datetime.fromisoformat(runs[-1]["started_at"])
        prev_start = datetime.datetime.fromisoformat(runs[-2]["started_at"])
        days_since_previous = max(0, (last_start.date() - prev_start.date()).days)

    return {
        "current": current,
        "last_run": runs[-1] if runs else None,
        "recent_runs": list(reversed(runs[-recent_limit:])),
        "this_month": {
            "count": len(month_runs),
            "average_minutes": average_minutes,
            "start": month_start.date().isoformat(),
        },
        "days_since_previous_run": days_since_previous,
        "last_seen_at": last_seen.isoformat() if last_seen else None,
        "stale": (
            last_seen is not None and _minutes_between(last_seen, now) > STALE_MINUTES
        ),
        "now": now.isoformat(),
    }


def get_summary(
    db: Optional[Session],
    now: datetime.datetime,
    history_days: int = DEFAULT_HISTORY_DAYS,
    recent_limit: int = DEFAULT_RECENT_RUNS,
) -> Dict[str, Any]:
    if database.DB_MOCK or db is None:
        rows = database.generate_mock_cleaner_rows(now)
    else:
        # 当月の集計に足りるよう、月初より前から引く
        start = min(
            _month_start(now), now - datetime.timedelta(days=history_days - 1)
        )
        rows = _fetch_rows(db, start, now)

    return build_summary(rows, now, recent_limit=recent_limit)
