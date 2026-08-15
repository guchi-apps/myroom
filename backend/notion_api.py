"""Notion API の最小限のクライアント。

公式 SDK（notion-client）は使わず、既存の requests で REST を直接叩く。
このリポジトリで Notion を使うのはゴミの日の書き出しだけで、必要な操作も
データソースの参照・検索とページの作成・更新・アーカイブの5つしかないため、
依存を1つ増やすより薄いラッパを持つほうが軽い。

API バージョン 2025-09-03 以降、プロパティ定義とクエリの対象はデータベース
（database）ではなくデータソース（data source）になった。1つのデータベースが
複数のデータソースを持ちうる構造で、読み書きに使う識別子は data_source_id。
database_id では引けないので、設定に持つのは必ず data_source_id にする。
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

API_BASE = "https://api.notion.com/v1"
NOTION_VERSION = "2025-09-03"
TIMEOUT_SECONDS = 10
#: Notion のクエリが1回で返せる上限
PAGE_SIZE = 100
#: 応答がページングされ続けたときの打ち切り。想定件数（数十件）から見て十分に余裕がある
MAX_PAGES = 50


class NotionError(RuntimeError):
    """Notion API の呼び出しに失敗した。呼び出し側が丸ごと握って同期を見送る。"""


def _headers(token: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def _error_message(response: requests.Response) -> str:
    """Notion が返したエラー本文。トークンは含まれないが、長すぎる本文は切り詰める。"""
    try:
        body = response.json()
    except ValueError:
        return response.text[:200]
    if isinstance(body, dict):
        return str(body.get("message") or body.get("code") or body)[:200]
    return str(body)[:200]


def _request(
    method: str,
    path: str,
    token: str,
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    try:
        response = requests.request(
            method,
            f"{API_BASE}{path}",
            headers=_headers(token),
            json=payload,
            timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise NotionError(f"Notion API への接続に失敗しました: {method} {path}") from exc

    if response.status_code >= 400:
        raise NotionError(
            f"Notion API が {response.status_code} を返しました: "
            f"{method} {path}: {_error_message(response)}"
        )

    try:
        return response.json()
    except ValueError as exc:
        raise NotionError(f"Notion API の応答を解釈できませんでした: {method} {path}") from exc


def retrieve_data_source(token: str, data_source_id: str) -> Dict[str, Any]:
    """データソースの定義（プロパティの名前と型）を取得する。"""
    return _request("GET", f"/data_sources/{data_source_id}", token)


def query_data_source(
    token: str,
    data_source_id: str,
    query_filter: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """データソースのページを検索する。has_more が続く限り読み切る。"""
    results: List[Dict[str, Any]] = []
    cursor: Optional[str] = None

    for _ in range(MAX_PAGES):
        payload: Dict[str, Any] = {"page_size": PAGE_SIZE}
        if query_filter:
            payload["filter"] = query_filter
        if cursor:
            payload["start_cursor"] = cursor

        data = _request("POST", f"/data_sources/{data_source_id}/query", token, payload)
        results.extend(data.get("results") or [])

        if not data.get("has_more"):
            return results
        cursor = data.get("next_cursor")
        if not cursor:
            return results

    logger.warning("Notion のクエリが %d ページを超えたため打ち切りました", MAX_PAGES)
    return results


def create_page(token: str, data_source_id: str, properties: Dict[str, Any]) -> Dict[str, Any]:
    return _request(
        "POST",
        "/pages",
        token,
        {
            "parent": {"type": "data_source_id", "data_source_id": data_source_id},
            "properties": properties,
        },
    )


def update_page(token: str, page_id: str, properties: Dict[str, Any]) -> Dict[str, Any]:
    return _request("PATCH", f"/pages/{page_id}", token, {"properties": properties})


def archive_page(token: str, page_id: str) -> Dict[str, Any]:
    """ページを Notion のゴミ箱へ移す。消し過ぎても Notion 側で戻せる。"""
    return _request("PATCH", f"/pages/{page_id}", token, {"archived": True})
