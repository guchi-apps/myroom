"""部屋の掃除の予定（場所・間隔・やること）と、実施した記録を扱う。

ゴミの日と違い、収集ルールのように外から決まるものではなく、住んでいる人が
その場で足したり間隔を変えたりするため、定義もアプリ画面から編集できるようにする。
そのため正は data/*.json ではなく DB に置く。

**保存先は既存の `app_settings` テーブル（キーと JSON テキストの2列）。**
掃除のためにテーブルを増やすと `migrate_db.py` へ DDL を足すことになり、本番の
アプリ用DBユーザーには CREATE 権限が無いのでデプロイが落ちる（#193）。
掃除の項目はせいぜい十数件で、1行の JSON に収まる規模なので既存の器を使う。

DB_MOCK（ローカルのモック実行）のときは `data/cleaning.json` へ書く。
`backend/ui_settings.py` と同じ二本立てで、モックでも画面の編集が試せる。

次の掃除日は「最後にやった日 + 間隔（日数）」で決める。曜日固定にすると、
1日ずれただけで次の週まで飛んでしまい、掃除の実態と合わない。

実施履歴の1件は `{"date": "2026-08-30", "recorded_at": "2026-08-31T09:15:00+09:00"}`。
**掃除した日（date）とアプリへ登録した日時（recorded_at）は別の値**で、予定の計算・
一覧・最終掃除日はすべて date を見る（#294）。当日に押し忘れて翌日に前日ぶんを
登録できるようにするための分けかたで、recorded_at は「いつ入力したか」を後から
辿るためだけに持つ。

`["2026-08-30", ...]` という**日付の文字列だけの古い形も読める**。読み取り時に
`recorded_at: None` を補うので、`migrate_db.py` へのDDLもデータの書き換えも要らない。
"""

from __future__ import annotations

import datetime
import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from . import database

JST = datetime.timezone(datetime.timedelta(hours=9))

CONFIG_PATH = Path(__file__).resolve().parent.parent / "data" / "cleaning.json"

#: app_settings のキー。定義と実施履歴をまとめて1行に持つ
SETTING_KEY = "cleaning_tasks"

#: 間隔（日数）の範囲。0以下は次回が決まらず、1年を超える掃除は予定として役に立たない
MIN_INTERVAL_DAYS = 1
MAX_INTERVAL_DAYS = 365

#: 1項目あたりに持つ実施履歴の件数。画面に出すのは直近3件で、残りは間隔を見直すときの手がかり
HISTORY_LIMIT = 10

#: 上限。UI から増やせるものなので、際限なく増えないところで止める
MAX_TASKS = 50
MAX_STEPS = 20
MAX_NAME_LENGTH = 40
MAX_STEP_LENGTH = 120


def get_today_jst() -> datetime.date:
    return datetime.datetime.now(JST).date()


def get_now_jst() -> datetime.datetime:
    """登録日時に入れる「いま」。秒より細かい値は要らないので落とす。"""
    return datetime.datetime.now(JST).replace(microsecond=0)


# --- 正規化 -------------------------------------------------------------------


def _parse_date(value: Any) -> Optional[datetime.date]:
    if not isinstance(value, str):
        return None
    try:
        return datetime.date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


def _clean_text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    # 全角スペースだけの入力を空として扱いたいので、正規化してから strip する
    text = unicodedata.normalize("NFKC", value).strip()
    return text[:limit]


def _slugify(name: str, index: int) -> str:
    """ID を持たない項目に振る識別子。日本語の名前でも衝突しない形にする。"""
    ascii_part = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return ascii_part or f"task-{index + 1}"


def _normalize_interval(raw: Any) -> int:
    try:
        interval = int(raw)
    except (TypeError, ValueError):
        return 7
    return max(MIN_INTERVAL_DAYS, min(MAX_INTERVAL_DAYS, interval))


def _parse_recorded_at(value: Any) -> Optional[str]:
    """登録日時。読めない値は「分からない」として捨てる（掃除した日には影響しない）。"""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    # タイムゾーンが無い値は JST として読む。この列に入るのは自分で書いた値だけ
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=JST)
    return parsed.astimezone(JST).replace(microsecond=0).isoformat()


def _normalize_history(raw: Any) -> List[Dict[str, Any]]:
    """実施履歴。掃除した日の新しい順に並べ、重複と未来の日付は落とす。

    古い形（日付の文字列だけの配列）もそのまま読み、登録日時は None にする。
    既存の記録を書き換えずに新しい形へ移すための受け口（#294）。
    """
    if not isinstance(raw, list):
        return []

    today = get_today_jst()
    entries: List[Tuple[datetime.date, Optional[str]]] = []
    seen: List[datetime.date] = []
    for entry in raw:
        if isinstance(entry, dict):
            day = _parse_date(entry.get("date"))
            recorded_at = _parse_recorded_at(entry.get("recorded_at"))
        else:
            day = _parse_date(entry)
            recorded_at = None
        # 同じ日が2つあるときは先に来たほうを残す。押し直しで登録日時が動かない
        if day is None or day > today or day in seen:
            continue
        seen.append(day)
        entries.append((day, recorded_at))

    entries.sort(key=lambda item: item[0], reverse=True)
    return [
        {"date": day.isoformat(), "recorded_at": recorded_at}
        for day, recorded_at in entries[:HISTORY_LIMIT]
    ]


def _normalize_task(raw: Any, index: int, used_ids: List[str]) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    name = _clean_text(raw.get("name"), MAX_NAME_LENGTH)
    if not name:
        return None

    task_id = _clean_text(raw.get("id"), 64) or _slugify(name, index)
    # 同じ名前を2つ作られても取り違えないよう、後から来たほうへ連番を足す
    if task_id in used_ids:
        suffix = 2
        while f"{task_id}-{suffix}" in used_ids:
            suffix += 1
        task_id = f"{task_id}-{suffix}"
    used_ids.append(task_id)

    steps: List[str] = []
    for step in raw.get("steps") or []:
        text = _clean_text(step, MAX_STEP_LENGTH)
        if text:
            steps.append(text)

    return {
        "id": task_id,
        "name": name,
        "interval_days": _normalize_interval(raw.get("interval_days")),
        "steps": steps[:MAX_STEPS],
        "history": _normalize_history(raw.get("history")),
    }


def normalize_tasks(raw: Any) -> List[Dict[str, Any]]:
    """保存されている値を、画面と Notion 同期がそのまま使える形へ揃える。

    並び順は与えられた順のまま保つ（画面の「設定」で並べ替えた順が正）。
    """
    if not isinstance(raw, list):
        return []

    used_ids: List[str] = []
    tasks: List[Dict[str, Any]] = []
    for index, entry in enumerate(raw[:MAX_TASKS]):
        task = _normalize_task(entry, index, used_ids)
        if task is not None:
            tasks.append(task)
    return tasks


# --- 予定の計算 ---------------------------------------------------------------


def history_dates(task: Dict[str, Any]) -> List[datetime.date]:
    """履歴に入っている「掃除した日」。新しい順。"""
    days = []
    for entry in task.get("history") or []:
        day = _parse_date(entry.get("date") if isinstance(entry, dict) else entry)
        if day is not None:
            days.append(day)
    return days


def last_done(task: Dict[str, Any]) -> Optional[datetime.date]:
    """最後に掃除した日。登録した日ではなく、履歴の「掃除した日」の最新を返す。"""
    days = history_dates(task)
    return days[0] if days else None


def next_due(task: Dict[str, Any], today: datetime.date) -> datetime.date:
    """次にやる日。一度もやっていなければ今日が期限。"""
    done = last_done(task)
    if done is None:
        return today
    return done + datetime.timedelta(days=task["interval_days"])


def build_task_view(task: Dict[str, Any], today: datetime.date) -> Dict[str, Any]:
    """画面が必要とする「あと何日か」まで含めた1件分。"""
    due = next_due(task, today)
    days_until = (due - today).days
    if days_until < 0:
        status = "overdue"
    elif days_until == 0:
        status = "today"
    else:
        status = "upcoming"

    done = last_done(task)
    return {
        **task,
        "last_done": done.isoformat() if done else None,
        "next_due": due.isoformat(),
        "days_until": days_until,
        "status": status,
    }


def build_payload(
    tasks: List[Dict[str, Any]],
    today: Optional[datetime.date] = None,
) -> Dict[str, Any]:
    """`GET /api/cleaning` が返す形。

    並び順の正は保存された順のままにし、「次が近い順」への並べ替えは画面側で行う
    （設定画面では編集した順に見えてほしいため）。
    """
    today = today or get_today_jst()
    return {
        "today": today.isoformat(),
        "configured": len(tasks) > 0,
        "tasks": [build_task_view(task, today) for task in tasks],
    }


# --- 保存先 -------------------------------------------------------------------


def _load_file_tasks() -> List[Dict[str, Any]]:
    if not CONFIG_PATH.exists():
        return []
    try:
        with CONFIG_PATH.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return []
    if isinstance(data, dict):
        data = data.get("tasks")
    return normalize_tasks(data)


def _write_file_tasks(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CONFIG_PATH.open("w", encoding="utf-8") as handle:
        json.dump({"tasks": tasks}, handle, ensure_ascii=False, indent=2)
    return tasks


def _load_db_tasks(db: Session) -> List[Dict[str, Any]]:
    row = (
        db.query(database.AppSetting)
        .filter(database.AppSetting.setting_key == SETTING_KEY)
        .first()
    )
    if row is None:
        return []
    try:
        return normalize_tasks(json.loads(row.setting_value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return []


def _write_db_tasks(db: Session, tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    serialized = json.dumps(tasks, ensure_ascii=False)
    row = (
        db.query(database.AppSetting)
        .filter(database.AppSetting.setting_key == SETTING_KEY)
        .first()
    )
    if row is None:
        db.add(database.AppSetting(setting_key=SETTING_KEY, setting_value=serialized))
    else:
        row.setting_value = serialized
    db.commit()
    return tasks


def get_tasks(db: Optional[Session] = None) -> List[Dict[str, Any]]:
    if database.DB_MOCK or db is None:
        return _load_file_tasks()
    return _load_db_tasks(db)


def save_tasks(raw: Any, db: Optional[Session] = None) -> List[Dict[str, Any]]:
    """定義をまとめて置き換える（追加・編集・削除・並べ替えを1回で受ける）。

    実施履歴は画面から送られてこないので、同じ id の既存項目から引き継ぐ。
    画面の編集で履歴を落とさないため。
    """
    current = {task["id"]: task for task in get_tasks(db)}

    merged: List[Dict[str, Any]] = []
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        existing = current.get(_clean_text(entry.get("id"), 64))
        merged.append({**entry, "history": (existing or {}).get("history", [])})

    tasks = normalize_tasks(merged)
    if database.DB_MOCK or db is None:
        return _write_file_tasks(tasks)
    return _write_db_tasks(db, tasks)


def mark_done(
    task_id: str,
    db: Optional[Session] = None,
    *,
    done_on: Optional[datetime.date] = None,
    recorded_at: Optional[datetime.datetime] = None,
) -> Tuple[List[Dict[str, Any]], bool]:
    """掃除をやった記録を足す。戻り値は（保存後の一覧, 見つかったか）。

    `done_on` は掃除した日で、省略すると今日。当日に押し忘れた場合は過去の日を渡す。
    登録日時（`recorded_at`）はこれとは別に、いま押した時刻を持つ（#294）。

    同じ日に2回押しても履歴は増えず、**先に入っていた登録日時も変えない**
    （`_normalize_history` が同じ日の後ろのほうを落とすので、既存を先に並べる）。
    """
    tasks = get_tasks(db)
    entry = {
        "date": (done_on or get_today_jst()).isoformat(),
        "recorded_at": (recorded_at or get_now_jst()).isoformat(),
    }

    found = False
    for task in tasks:
        if task["id"] == task_id:
            task["history"] = _normalize_history([*task["history"], entry])
            found = True
            break

    if not found:
        return tasks, False

    if database.DB_MOCK or db is None:
        return _write_file_tasks(tasks), True
    return _write_db_tasks(db, tasks), True


def remove_done(
    task_id: str,
    done_on: datetime.date,
    db: Optional[Session] = None,
) -> Tuple[List[Dict[str, Any]], bool]:
    """掃除の記録を1件取り消す。戻り値は（保存後の一覧, 消したか）。

    日付を間違えて登録したときの直し方はこれ1つ（消してから正しい日で登録し直す）。
    履歴を直接書き換える口を作らないのは、登録日時が実態とずれないようにするため。
    """
    tasks = get_tasks(db)
    target = done_on.isoformat()

    removed = False
    for task in tasks:
        if task["id"] != task_id:
            continue
        kept = [entry for entry in task["history"] if entry.get("date") != target]
        removed = len(kept) != len(task["history"])
        task["history"] = kept
        break

    if not removed:
        return tasks, False

    if database.DB_MOCK or db is None:
        return _write_file_tasks(tasks), True
    return _write_db_tasks(db, tasks), True
