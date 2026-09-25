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
import threading
import unicodedata
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import atomic_json, database

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


def get_tasks(db: Optional[Session] = None) -> List[Dict[str, Any]]:
    if database.DB_MOCK or db is None:
        return _load_file_tasks()
    return _load_db_tasks(db)


#: DB経路でプロセス内の並行リクエストを1本ずつにするロック。行ロック（`FOR UPDATE`）が効かない
#: DB（テストのSQLite）でも、同じプロセスの中では読み→書きが重ならないようにする
_db_lock = threading.Lock()


def _lock_db_row(db: Session) -> database.AppSetting:
    """`cleaning_tasks` の行を書き込み用に確保する（`SELECT ... FOR UPDATE`）。

    行がまだ無い最初の1回だけ、空の行を作ってから取り直す。
    """
    query = (
        db.query(database.AppSetting)
        .filter(database.AppSetting.setting_key == SETTING_KEY)
        .with_for_update()
        .populate_existing()
    )
    row = query.first()
    if row is None:
        try:
            db.add(database.AppSetting(setting_key=SETTING_KEY, setting_value="[]"))
            db.commit()
        except IntegrityError:
            db.rollback()
        row = query.first()
    assert row is not None
    return row


def _update(
    db: Optional[Session],
    mutate: Callable[[List[Dict[str, Any]]], Any],
) -> Tuple[List[Dict[str, Any]], Any]:
    """読み込み・加工・書き戻しを**1つの排他区間**で行う。戻り値は（保存後の一覧, `mutate` の返り値）。

    `mutate` は一覧をその場で書き換え、**書き戻さなくてよいとき（見つからない等）は `False`** を
    返す（それ以外の返り値は書き戻す）。全タスクが1行のJSONに入っているので、別のタスクへの
    操作同士でも、読み込みから書き戻しの間に割り込まれると片方が消える（lost update）。
    Notion同期の完了の読み戻しと、画面からの操作が重なるのがこの形（#496）。
    `filament._update()` と同じ考え方。

    - DB_MOCK: `atomic_json.update_json`（プロセス内のロックと `.lock` ファイルの `flock`）
    - 本番: プロセス内のロックと、行ロック（`FOR UPDATE`）で読み込みから `commit` までを囲む
    """
    if database.DB_MOCK or db is None:
        outcome: List[Any] = [None]

        def apply_file(raw: Any) -> Any:
            if isinstance(raw, dict):
                raw = raw.get("tasks")
            tasks = normalize_tasks(raw)
            outcome[0] = mutate(tasks)
            return {"tasks": tasks} if outcome[0] is not False else {"tasks": normalize_tasks(raw)}

        result = atomic_json.update_json(CONFIG_PATH, None, apply_file)
        return result["tasks"], outcome[0]

    with _db_lock:
        try:
            row = _lock_db_row(db)
            try:
                tasks = normalize_tasks(json.loads(row.setting_value))
            except (TypeError, ValueError):
                tasks = []
            result_value = mutate(tasks)
            if result_value is not False:
                row.setting_value = json.dumps(tasks, ensure_ascii=False)
            db.commit()
            return tasks, result_value
        except BaseException:
            # 例外のまま抜けると行ロックが残り、次のリクエストがロック待ちで止まる
            db.rollback()
            raise


def save_tasks(raw: Any, db: Optional[Session] = None) -> List[Dict[str, Any]]:
    """定義をまとめて置き換える（追加・編集・削除・並べ替えを1回で受ける）。

    実施履歴は画面から送られてこないので、同じ id の既存項目から引き継ぐ。
    画面の編集で履歴を落とさないため。
    """

    def mutate(tasks: List[Dict[str, Any]]) -> None:
        current = {task["id"]: task for task in tasks}
        merged: List[Dict[str, Any]] = []
        for entry in raw if isinstance(raw, list) else []:
            if not isinstance(entry, dict):
                continue
            existing = current.get(_clean_text(entry.get("id"), 64))
            merged.append({**entry, "history": (existing or {}).get("history", [])})
        tasks[:] = normalize_tasks(merged)

    return _update(db, mutate)[0]


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
    entry = {
        "date": (done_on or get_today_jst()).isoformat(),
        "recorded_at": (recorded_at or get_now_jst()).isoformat(),
    }

    def mutate(tasks: List[Dict[str, Any]]) -> bool:
        for task in tasks:
            if task["id"] == task_id:
                task["history"] = _normalize_history([*task["history"], entry])
                return True
        return False

    tasks, found = _update(db, mutate)
    return tasks, found


def remove_done(
    task_id: str,
    done_on: datetime.date,
    db: Optional[Session] = None,
) -> Tuple[List[Dict[str, Any]], bool]:
    """掃除の記録を1件取り消す。戻り値は（保存後の一覧, 消したか）。

    日付を間違えて登録したときの直し方はこれ1つ（消してから正しい日で登録し直す）。
    履歴を直接書き換える口を作らないのは、登録日時が実態とずれないようにするため。
    """
    target = done_on.isoformat()

    def mutate(tasks: List[Dict[str, Any]]) -> bool:
        for task in tasks:
            if task["id"] != task_id:
                continue
            kept = [entry for entry in task["history"] if entry.get("date") != target]
            if len(kept) == len(task["history"]):
                return False
            task["history"] = kept
            return True
        return False

    tasks, removed = _update(db, mutate)
    return tasks, removed
