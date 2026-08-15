"""ゴミの収集日を Notion のデータベースへ書き出す。

data/garbage.json から計算した収集日を、Notion 側の「ゴミの日」データベースへ同期する。
dayspan など Notion を読むアプリのカレンダーに出すことが目的で、収集日の正は
あくまで data/garbage.json のまま。Notion 側は書き換えられても次の同期で戻る。

ページの粒度は「収集日 × 品目」で1件。照合キーは（日付, タイトル）で、同じ日に
同じ品目は1件しか無いため一意になる。状態ファイルにページIDを持たず、毎回
Notion 側を引いて差分を取るので、状態を失っても二重登録にならない。

**myroom が書いたページかどうかは select プロパティ「種類」の値で判断する。**
これが無いと人が手で作ったページと区別できず、範囲外になったページを片付けられない。
そのため「種類」は必須とし、見つからない場合は1件も書かずに中止する。

本番ではバックエンド（backend/main.py の lifespan）が1時間ごとに run_sync() を呼び、
run_sync() 側が「今日はもう同期したか」「data/garbage.json が変わっていないか」を見る。
手動で試すときは `python -m backend.garbage_notion --dry-run` を実行する。
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv

from . import garbage, notion_api

load_dotenv()

logger = logging.getLogger(__name__)

#: Notion のインテグレーショントークン。未設定なら書き出しを行わない
ENV_TOKEN = "GARBAGE_NOTION_TOKEN"
#: 書き出し先のデータソースID（database_id ではない。notion_api の説明を参照）
ENV_DATA_SOURCE_ID = "GARBAGE_NOTION_DATA_SOURCE_ID"

STATE_PATH = Path(__file__).resolve().parent.parent / "data" / "garbage_notion_state.json"

#: 品目の説明と exceptions の注記をメモ欄へ並べるときの区切り
MEMO_SEPARATOR = "／"

#: フィールド名 → Notion のプロパティ型。title と date と select は必須
REQUIRED_FIELD_TYPES: Tuple[Tuple[str, str], ...] = (
    ("title", "title"),
    ("date", "date"),
    ("category", "select"),
)


# --- 設定・状態 ---------------------------------------------------------------


def _load_state() -> Dict[str, Any]:
    if not STATE_PATH.exists():
        return {}
    try:
        with STATE_PATH.open(encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return data
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        logger.warning("Failed to read garbage notion state; resetting")
    return {}


def _write_state(state: Dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with STATE_PATH.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False, indent=2)


def config_fingerprint() -> str:
    """data/garbage.json の内容のハッシュ。

    収集ルールや exceptions を手で直したあと翌日まで反映されないのを避けるため、
    日付だけでなく設定の中身が変わったことも同期のきっかけにする。
    """
    try:
        return hashlib.sha256(garbage.CONFIG_PATH.read_bytes()).hexdigest()
    except OSError:
        return ""


# --- 書き出す内容 -------------------------------------------------------------


def _build_memo(category: Dict[str, Any], notes: List[str]) -> str:
    parts = [part for part in [category.get("note") or "", *notes] if part]
    return MEMO_SEPARATOR.join(parts)


def build_entries(config: Dict[str, Any], today: datetime.date) -> List[Dict[str, str]]:
    """今日から window_days 日先までの、Notion に在るべきページの一覧。"""
    end = today + datetime.timedelta(days=config["notion"]["window_days"])
    entries: List[Dict[str, str]] = []
    for day in garbage.collection_days(config, today, end):
        for category in day["categories"]:
            entries.append(
                {
                    "date": day["date"].isoformat(),
                    "title": category["name"],
                    "memo": _build_memo(category, day["notes"]),
                }
            )
    return entries


# --- Notion のプロパティ ------------------------------------------------------


def _find_property(
    properties: Dict[str, Any],
    wanted_name: str,
    wanted_type: str,
) -> Optional[str]:
    """設定した名前で当て、外れたら型が1つに絞れるときだけ自動で決める。

    プロパティ名は Notion 側で自由に付けられるため固定名を前提にできない。
    一方 title 型は必ず1つしか無く、日付やメモも通常は1つなので、名前が違っても
    型から一意に決まることが多い。複数あって絞れない場合は None を返して中止する。
    """
    prop = properties.get(wanted_name)
    if isinstance(prop, dict) and prop.get("type") == wanted_type:
        return wanted_name

    candidates = [
        name
        for name, definition in properties.items()
        if isinstance(definition, dict) and definition.get("type") == wanted_type
    ]
    return candidates[0] if len(candidates) == 1 else None


def resolve_properties(
    schema: Any,
    notion_config: Dict[str, Any],
) -> Tuple[Dict[str, str], List[str]]:
    """データソースの定義から、書き込みに使うプロパティ名を決める。

    戻り値は（フィールド名 → プロパティ名, エラーの一覧）。エラーが1つでもあれば
    呼び出し側は同期を中止する（一部だけ書くと後片付けができなくなるため）。
    """
    properties = schema.get("properties") if isinstance(schema, dict) else None
    if not isinstance(properties, dict):
        return {}, ["データソースのプロパティ定義を読み取れませんでした"]

    names = notion_config["properties"]
    resolved: Dict[str, str] = {}
    errors: List[str] = []

    for field, wanted_type in REQUIRED_FIELD_TYPES:
        name = _find_property(properties, names[field], wanted_type)
        if name is None:
            errors.append(f"{wanted_type} 型のプロパティ「{names[field]}」が特定できません")
        else:
            resolved[field] = name

    # メモは無くても収集日は表せるので任意扱い
    memo = _find_property(properties, names["memo"], "rich_text")
    if memo:
        resolved["memo"] = memo

    return resolved, errors


def to_notion_properties(
    entry: Dict[str, str],
    resolved: Dict[str, str],
    category_value: str,
) -> Dict[str, Any]:
    properties: Dict[str, Any] = {
        resolved["title"]: {"title": [{"text": {"content": entry["title"]}}]},
        resolved["date"]: {"date": {"start": entry["date"]}},
        resolved["category"]: {"select": {"name": category_value}},
    }
    if "memo" in resolved:
        memo = entry["memo"]
        properties[resolved["memo"]] = {
            "rich_text": [{"text": {"content": memo}}] if memo else []
        }
    return properties


def _plain_text(items: Any) -> str:
    if not isinstance(items, list):
        return ""
    return "".join(
        str(item.get("plain_text") or "")
        for item in items
        if isinstance(item, dict)
    )


def parse_page(page: Any, resolved: Dict[str, str]) -> Optional[Dict[str, str]]:
    """Notion のページを、照合に使う形へ落とす。日付かタイトルが無いページは無視する。"""
    if not isinstance(page, dict):
        return None
    properties = page.get("properties")
    page_id = page.get("id")
    if not isinstance(properties, dict) or not page_id:
        return None

    def value(field: str) -> Any:
        name = resolved.get(field)
        return properties.get(name) if name else None

    date_value = value("date") or {}
    date = (date_value.get("date") or {}).get("start") if isinstance(date_value, dict) else None
    title = _plain_text((value("title") or {}).get("title"))
    if not date or not title:
        return None

    memo_property = value("memo") if "memo" in resolved else None
    memo = _plain_text((memo_property or {}).get("rich_text"))

    return {
        # 時刻付きで入っていても日付だけで照合する（myroom は日付のみで書く）
        "page_id": str(page_id),
        "date": str(date)[:10],
        "title": title,
        "memo": memo,
    }


def _build_filter(
    resolved: Dict[str, str],
    category_value: str,
    start: datetime.date,
    end: datetime.date,
) -> Dict[str, Any]:
    """同期の対象期間かつ myroom が書いたページだけを引く。

    期間を絞ることで、過ぎた収集日のページは検索にも上がらず、片付けの対象にもならない。
    """
    return {
        "and": [
            {"property": resolved["date"], "date": {"on_or_after": start.isoformat()}},
            {"property": resolved["date"], "date": {"on_or_before": end.isoformat()}},
            {"property": resolved["category"], "select": {"equals": category_value}},
        ]
    }


# --- 差分 ---------------------------------------------------------------------


def plan_changes(
    expected: List[Dict[str, str]],
    existing: List[Dict[str, str]],
) -> Dict[str, List[Dict[str, Any]]]:
    """在るべき一覧と Notion 側の現状から、作成・更新・アーカイブを決める。"""
    expected_by_key = {(entry["date"], entry["title"]): entry for entry in expected}

    existing_by_key: Dict[Tuple[str, str], Dict[str, str]] = {}
    duplicates: List[Dict[str, str]] = []
    for page in existing:
        key = (page["date"], page["title"])
        if key in existing_by_key:
            # 同じ日・同じ品目が2件あるのは過去の同期が中断した名残。余分な方を片付ける
            duplicates.append(page)
            continue
        existing_by_key[key] = page

    create = [entry for key, entry in expected_by_key.items() if key not in existing_by_key]
    update = [
        {**expected_by_key[key], "page_id": page["page_id"]}
        for key, page in existing_by_key.items()
        if key in expected_by_key and page["memo"] != expected_by_key[key]["memo"]
    ]
    archive = [
        page for key, page in existing_by_key.items() if key not in expected_by_key
    ] + duplicates

    def sort_key(item: Dict[str, Any]) -> Tuple[str, str]:
        return item["date"], item["title"]

    return {
        "create": sorted(create, key=sort_key),
        "update": sorted(update, key=sort_key),
        "archive": sorted(archive, key=sort_key),
    }


# --- 同期 ---------------------------------------------------------------------


def sync(
    today: Optional[datetime.date] = None,
    *,
    dry_run: bool = False,
) -> Optional[Dict[str, Any]]:
    """収集日を Notion へ同期する。連携が無効・未設定なら None を返す。"""
    token = os.getenv(ENV_TOKEN, "").strip()
    data_source_id = os.getenv(ENV_DATA_SOURCE_ID, "").strip()
    if not token or not data_source_id:
        logger.info("%s / %s が未設定のため Notion への書き出しを行いません", ENV_TOKEN, ENV_DATA_SOURCE_ID)
        return None

    config = garbage.load_config()
    if not config["configured"]:
        logger.info("Garbage schedule is not configured; skipping")
        return None

    notion_config = config["notion"]
    if not notion_config["enabled"]:
        logger.info("data/garbage.json の notion.enabled が false のため書き出しを行いません")
        return None

    today = today or garbage.get_today_jst()
    end = today + datetime.timedelta(days=notion_config["window_days"])

    schema = notion_api.retrieve_data_source(token, data_source_id)
    resolved, errors = resolve_properties(schema, notion_config)
    if errors:
        logger.warning(
            "Notion のプロパティを特定できないため同期を中止します: %s", "／".join(errors)
        )
        return None

    expected = build_entries(config, today)
    pages = notion_api.query_data_source(
        token,
        data_source_id,
        query_filter=_build_filter(resolved, notion_config["category_value"], today, end),
    )
    existing = [
        parsed for parsed in (parse_page(page, resolved) for page in pages) if parsed
    ]
    changes = plan_changes(expected, existing)

    summary = {
        "expected": len(expected),
        "created": len(changes["create"]),
        "updated": len(changes["update"]),
        "archived": len(changes["archive"]),
        "dry_run": dry_run,
    }
    if dry_run:
        return summary

    category_value = notion_config["category_value"]
    for entry in changes["create"]:
        notion_api.create_page(
            token, data_source_id, to_notion_properties(entry, resolved, category_value)
        )
    for entry in changes["update"]:
        notion_api.update_page(
            token, entry["page_id"], to_notion_properties(entry, resolved, category_value)
        )
    for page in changes["archive"]:
        notion_api.archive_page(token, page["page_id"])

    return summary


def run_sync(
    now: Optional[datetime.datetime] = None,
    *,
    force: bool = False,
) -> Optional[Dict[str, Any]]:
    """1日1回、または data/garbage.json が変わったときだけ同期する。

    バックエンドのループはこちらを呼ぶ。同期しなかった場合は None を返す。
    """
    now = now or datetime.datetime.now(garbage.JST).replace(tzinfo=None)
    today = now.date()
    fingerprint = config_fingerprint()

    state = _load_state()
    if (
        not force
        and state.get("last_synced_date") == today.isoformat()
        and state.get("config_fingerprint") == fingerprint
    ):
        logger.debug("Already synced for %s; skipping", today.isoformat())
        return None

    summary = sync(today)
    if summary is None:
        # 未設定・無効のときは状態を残さない（設定が入り次第すぐ走らせるため）
        return None

    _write_state(
        {"last_synced_date": today.isoformat(), "config_fingerprint": fingerprint}
    )
    return summary


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="ゴミの収集日を Notion へ同期する")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Notion へ書き込まず、作成・更新・アーカイブの件数だけ表示する",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    try:
        summary = sync(dry_run=True) if args.dry_run else run_sync(force=True)
    except notion_api.NotionError as exc:
        logger.error("%s", exc)
        return 1

    if summary is None:
        logger.info("Notion への書き出しは行いませんでした")
        return 0

    logger.info(
        "Notion sync %s: expected=%d created=%d updated=%d archived=%d",
        "(dry-run)" if summary["dry_run"] else "done",
        summary["expected"],
        summary["created"],
        summary["updated"],
        summary["archived"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
