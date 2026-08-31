import datetime
import json

import pytest

from backend import garbage, garbage_notion, notion_api

SAMPLE_CONFIG = {
    "area": "茨木市",
    "notify_hour": 20,
    "categories": [
        {
            "id": "burnable",
            "name": "普通ごみ",
            "note": "生ごみ",
            "rules": [{"type": "weekly", "weekdays": ["tue", "fri"]}],
        },
        {
            "id": "recyclable",
            "name": "資源ごみ",
            "rules": [{"type": "monthly", "weekday": "水", "weeks": [2]}],
        },
    ],
    "notion": {"window_days": 7},
    "exceptions": [
        {"date": "2026-08-14", "cancel": True, "note": "お盆のため収集なし"},
        {"date": "2026-08-16", "add": ["burnable"], "note": "振替収集"},
    ],
}

#: Notion の retrieve_data_source が返すプロパティ定義（必要な型だけ持つ最小形）
SCHEMA = {
    "properties": {
        "タイトル": {"type": "title"},
        "日付": {"type": "date"},
        "種類": {"type": "select"},
        "メモ": {"type": "rich_text"},
    }
}

RESOLVED = {"title": "タイトル", "date": "日付", "category": "種類", "memo": "メモ"}


def write_config(data_dir, config=None):
    (data_dir / "garbage.json").write_text(
        json.dumps(config if config is not None else SAMPLE_CONFIG, ensure_ascii=False),
        encoding="utf-8",
    )


def expected_entry(date, title, memo="", start=None):
    """build_entries が返す1件ぶん。"""
    return {
        "date": date,
        "start": start or f"{date}T08:30:00+09:00",
        "title": title,
        "memo": memo,
    }


def existing_page(page_id, date, title, memo="", start=None):
    """parse_page が返す1件ぶん。"""
    return {**expected_entry(date, title, memo, start), "page_id": page_id}


def notion_page(page_id, date, title, memo=""):
    """Notion のクエリ結果1件ぶん。parse_page が読む形に合わせる。"""
    return {
        "id": page_id,
        "properties": {
            "タイトル": {"type": "title", "title": [{"plain_text": title}]},
            "日付": {"type": "date", "date": {"start": date}},
            "種類": {"type": "select", "select": {"name": "ゴミの日"}},
            "メモ": {"type": "rich_text", "rich_text": [{"plain_text": memo}] if memo else []},
        },
    }


class FakeNotion:
    """notion_api を差し替える偽クライアント。HTTP は一切飛ばさない。"""

    def __init__(self, schema=None, pages=None):
        self.schema = schema if schema is not None else SCHEMA
        self.pages = pages or []
        self.created = []
        self.updated = []
        self.archived = []
        self.filters = []

    def install(self, monkeypatch):
        monkeypatch.setattr(
            garbage_notion.notion_api, "retrieve_data_source", lambda token, ds: self.schema
        )
        monkeypatch.setattr(
            garbage_notion.notion_api,
            "query_data_source",
            lambda token, ds, query_filter=None: self._query(query_filter),
        )
        monkeypatch.setattr(
            garbage_notion.notion_api,
            "create_page",
            lambda token, ds, properties: self.created.append(properties),
        )
        monkeypatch.setattr(
            garbage_notion.notion_api,
            "update_page",
            lambda token, page_id, properties: self.updated.append((page_id, properties)),
        )
        monkeypatch.setattr(
            garbage_notion.notion_api,
            "archive_page",
            lambda token, page_id: self.archived.append(page_id),
        )
        return self

    def _query(self, query_filter):
        self.filters.append(query_filter)
        return self.pages


@pytest.fixture
def notion_env(monkeypatch):
    monkeypatch.setenv(garbage_notion.ENV_TOKEN, "secret-token")
    monkeypatch.setenv(garbage_notion.ENV_DATA_SOURCE_ID, "ds-1")


@pytest.fixture
def config(data_dir):
    write_config(data_dir)
    return garbage.load_config()


# --- 書き出す内容 -------------------------------------------------------------


def test_build_entries_creates_one_entry_per_category_and_day(config):
    entries = garbage_notion.build_entries(config, datetime.date(2026, 8, 11))

    # 8/11(火)普通 / 8/12(第2水)資源 / 8/14(金)は中止 / 8/16(日)は臨時 / 8/18(火)普通
    assert [(entry["date"], entry["title"]) for entry in entries] == [
        ("2026-08-11", "普通ごみ"),
        ("2026-08-12", "資源ごみ"),
        ("2026-08-16", "普通ごみ"),
        ("2026-08-18", "普通ごみ"),
    ]
    # 品目の説明と例外の注記がメモへ入る
    assert entries[0]["memo"] == "生ごみ"
    assert entries[2]["memo"] == "生ごみ／振替収集"
    assert entries[1]["memo"] == ""
    # 日付プロパティへ書く値は collection_time（既定 08:30）を足したJST付きのISO
    assert entries[0]["start"] == "2026-08-11T08:30:00+09:00"


def test_build_entries_uses_the_configured_collection_time(data_dir):
    """収集時刻を変えたら、Notion へ書く時刻もそちらへ揃う。"""
    write_config(data_dir, {**SAMPLE_CONFIG, "collection_time": "9:15"})
    entries = garbage_notion.build_entries(garbage.load_config(), datetime.date(2026, 8, 11))

    assert entries[0]["start"] == "2026-08-11T09:15:00+09:00"


# --- プロパティの解決 ---------------------------------------------------------


def test_resolve_properties_matches_configured_names(config):
    resolved, errors = garbage_notion.resolve_properties(SCHEMA, config["notion"])
    assert errors == []
    assert resolved == RESOLVED


def test_resolve_properties_falls_back_to_a_unique_type(config):
    """プロパティ名は Notion 側で自由に付けられるので、型が1つに絞れるなら名前が違っても通す。"""
    schema = {
        "properties": {
            "Name": {"type": "title"},
            "Date": {"type": "date"},
            "種類": {"type": "select"},
        }
    }
    resolved, errors = garbage_notion.resolve_properties(schema, config["notion"])

    assert errors == []
    assert resolved == {"title": "Name", "date": "Date", "category": "種類"}
    assert "memo" not in resolved  # rich_text が無ければメモは書かない


def test_resolve_properties_reports_ambiguous_type(config):
    """同じ型が複数あって名前も当たらない場合は、取り違えずに中止する。"""
    schema = {
        "properties": {
            "タイトル": {"type": "title"},
            "開始": {"type": "date"},
            "終了": {"type": "date"},
            "種類": {"type": "select"},
        }
    }
    _, errors = garbage_notion.resolve_properties(schema, config["notion"])
    assert len(errors) == 1
    assert "日付" in errors[0]


def test_resolve_properties_requires_the_category_property(config):
    schema = {"properties": {"タイトル": {"type": "title"}, "日付": {"type": "date"}}}
    _, errors = garbage_notion.resolve_properties(schema, config["notion"])
    assert len(errors) == 1
    assert "種類" in errors[0]


def test_to_notion_properties_writes_the_collection_time(config):
    entry = {
        "date": "2026-08-11",
        "start": "2026-08-11T08:30:00+09:00",
        "title": "普通ごみ",
        "memo": "生ごみ",
    }
    properties = garbage_notion.to_notion_properties(entry, RESOLVED, "ゴミの日")

    assert properties["日付"] == {"date": {"start": "2026-08-11T08:30:00+09:00"}}
    assert properties["タイトル"]["title"][0]["text"]["content"] == "普通ごみ"
    assert properties["種類"] == {"select": {"name": "ゴミの日"}}
    assert properties["メモ"]["rich_text"][0]["text"]["content"] == "生ごみ"


# --- 差分 ---------------------------------------------------------------------


def test_plan_changes_creates_updates_and_archives():
    expected = [
        expected_entry("2026-08-11", "普通ごみ", "生ごみ"),
        expected_entry("2026-08-12", "資源ごみ", "振替収集"),
    ]
    existing = [
        # メモが変わった -> 更新
        existing_page("p2", "2026-08-12", "資源ごみ"),
        # 中止になって期待から消えた -> アーカイブ
        existing_page("p3", "2026-08-14", "普通ごみ"),
    ]
    changes = garbage_notion.plan_changes(expected, existing)

    assert [entry["date"] for entry in changes["create"]] == ["2026-08-11"]
    assert changes["update"] == [
        {**expected_entry("2026-08-12", "資源ごみ", "振替収集"), "page_id": "p2"}
    ]
    assert [page["page_id"] for page in changes["archive"]] == ["p3"]


def test_plan_changes_leaves_unchanged_pages_alone():
    entry = expected_entry("2026-08-11", "普通ごみ", "生ごみ")
    changes = garbage_notion.plan_changes([entry], [{**entry, "page_id": "p1"}])
    assert changes == {"create": [], "update": [], "archive": []}


def test_plan_changes_ignores_notions_millisecond_form():
    """返ってくる値は書いた文字列と同一とは限らない。文字列で比べると毎回全件更新になる。"""
    entry = expected_entry("2026-08-11", "普通ごみ", "生ごみ")
    page = {**entry, "page_id": "p1", "start": "2026-08-11T08:30:00.000+09:00"}

    assert garbage_notion.plan_changes([entry], [page])["update"] == []


def test_plan_changes_updates_pages_written_before_the_time_was_added():
    """時刻を書くようになる前のページは、作り直さずに更新で直す。"""
    entry = expected_entry("2026-08-11", "普通ごみ", "生ごみ")
    page = {**entry, "page_id": "p1", "start": "2026-08-11"}

    changes = garbage_notion.plan_changes([entry], [page])

    assert changes["create"] == [] and changes["archive"] == []
    assert changes["update"] == [{**entry, "page_id": "p1"}]


def test_plan_changes_updates_when_the_collection_time_changes():
    entry = expected_entry("2026-08-11", "普通ごみ", "生ごみ")
    page = {**entry, "page_id": "p1", "start": "2026-08-11T08:30:00+09:00"}
    entry = {**entry, "start": "2026-08-11T09:15:00+09:00"}

    assert garbage_notion.plan_changes([entry], [page])["update"] == [
        {**entry, "page_id": "p1"}
    ]


def test_plan_changes_archives_duplicate_pages():
    """同期が途中で落ちて同じ日・同じ品目が2件できたら、余分な方を片付ける。"""
    entry = expected_entry("2026-08-11", "普通ごみ")
    changes = garbage_notion.plan_changes(
        [entry], [{**entry, "page_id": "p1"}, {**entry, "page_id": "p2"}]
    )
    assert changes["create"] == []
    assert [page["page_id"] for page in changes["archive"]] == ["p2"]


def test_parse_page_keeps_the_date_for_matching_and_the_start_as_written():
    parsed = garbage_notion.parse_page(
        notion_page("p1", "2026-08-11T08:00:00+09:00", "普通ごみ", "生ごみ"), RESOLVED
    )
    assert parsed == {
        "page_id": "p1",
        "date": "2026-08-11",
        "start": "2026-08-11T08:00:00+09:00",
        "title": "普通ごみ",
        "memo": "生ごみ",
    }


def test_parse_page_ignores_pages_without_a_date():
    page = notion_page("p1", "2026-08-11", "普通ごみ")
    page["properties"]["日付"] = {"type": "date", "date": None}
    assert garbage_notion.parse_page(page, RESOLVED) is None


# --- 同期 ---------------------------------------------------------------------


def test_sync_creates_missing_pages(data_dir, monkeypatch, notion_env):
    write_config(data_dir)
    fake = FakeNotion().install(monkeypatch)

    summary = garbage_notion.sync(datetime.date(2026, 8, 11))

    assert summary == {
        "expected": 4,
        "created": 4,
        "updated": 0,
        "archived": 0,
        "dry_run": False,
    }
    assert len(fake.created) == 4
    assert fake.created[0]["日付"] == {"date": {"start": "2026-08-11T08:30:00+09:00"}}
    assert fake.updated == []
    assert fake.archived == []


def test_sync_queries_only_the_window_and_its_own_pages(data_dir, monkeypatch, notion_env):
    write_config(data_dir)
    fake = FakeNotion().install(monkeypatch)

    garbage_notion.sync(datetime.date(2026, 8, 11))

    # window_days=7 -> 8/11 〜 8/18。過ぎた日は検索にも上がらないので片付けの対象にならない
    assert fake.filters[0] == {
        "and": [
            {"property": "日付", "date": {"on_or_after": "2026-08-11"}},
            {"property": "日付", "date": {"on_or_before": "2026-08-18"}},
            {"property": "種類", "select": {"equals": "ゴミの日"}},
        ]
    }


def test_sync_updates_and_archives(data_dir, monkeypatch, notion_env):
    write_config(data_dir)
    fake = FakeNotion(
        pages=[
            # そのまま
            notion_page("p1", "2026-08-11T08:30:00.000+09:00", "普通ごみ", "生ごみ"),
            # メモが古い -> 更新
            notion_page("p2", "2026-08-16T08:30:00.000+09:00", "普通ごみ", "生ごみ"),
            # 中止された -> アーカイブ
            notion_page("p3", "2026-08-14T08:30:00.000+09:00", "普通ごみ", "生ごみ"),
        ]
    ).install(monkeypatch)

    summary = garbage_notion.sync(datetime.date(2026, 8, 11))

    assert summary["created"] == 2  # 8/12 資源ごみ と 8/18 普通ごみ
    assert summary["updated"] == 1
    assert summary["archived"] == 1
    assert fake.updated[0][0] == "p2"
    assert fake.updated[0][1]["メモ"]["rich_text"][0]["text"]["content"] == "生ごみ／振替収集"
    assert fake.archived == ["p3"]


def test_sync_rewrites_pages_that_have_no_time_yet(data_dir, monkeypatch, notion_env):
    """時刻を書くようになる前のページは、アーカイブせず更新で時刻を足す。"""
    write_config(data_dir)
    fake = FakeNotion(
        pages=[notion_page("p1", "2026-08-11", "普通ごみ", "生ごみ")]
    ).install(monkeypatch)

    summary = garbage_notion.sync(datetime.date(2026, 8, 11))

    assert summary["updated"] == 1
    assert summary["archived"] == 0
    assert fake.updated[0][0] == "p1"
    assert fake.updated[0][1]["日付"] == {"date": {"start": "2026-08-11T08:30:00+09:00"}}


def test_sync_is_a_no_op_the_second_time(data_dir, monkeypatch, notion_env):
    """同期後の状態がそのまま渡ってきたら、書き込みは1件も出ない。"""
    write_config(data_dir)
    fake = FakeNotion().install(monkeypatch)
    garbage_notion.sync(datetime.date(2026, 8, 11))

    fake.pages = [
        notion_page(f"p{index}", properties["日付"]["date"]["start"], properties["タイトル"]["title"][0]["text"]["content"], properties["メモ"]["rich_text"][0]["text"]["content"] if properties["メモ"]["rich_text"] else "")
        for index, properties in enumerate(fake.created)
    ]
    fake.created.clear()

    summary = garbage_notion.sync(datetime.date(2026, 8, 11))
    assert summary["created"] == 0
    assert summary["updated"] == 0
    assert summary["archived"] == 0


def test_sync_does_nothing_without_credentials(data_dir, monkeypatch):
    write_config(data_dir)
    monkeypatch.delenv(garbage_notion.ENV_TOKEN, raising=False)
    monkeypatch.delenv(garbage_notion.ENV_DATA_SOURCE_ID, raising=False)
    called = []
    monkeypatch.setattr(
        garbage_notion.notion_api,
        "retrieve_data_source",
        lambda *args: called.append(True),
    )

    assert garbage_notion.sync(datetime.date(2026, 8, 11)) is None
    assert called == []


def test_sync_is_disabled_by_config(data_dir, monkeypatch, notion_env):
    write_config(data_dir, {**SAMPLE_CONFIG, "notion": {"enabled": False}})
    fake = FakeNotion().install(monkeypatch)

    assert garbage_notion.sync(datetime.date(2026, 8, 11)) is None
    assert fake.created == []


def test_sync_writes_nothing_when_a_property_is_missing(data_dir, monkeypatch, notion_env):
    """一部だけ書くと後片付けができなくなるので、解決できなければ1件も書かない。"""
    write_config(data_dir)
    fake = FakeNotion(
        schema={"properties": {"タイトル": {"type": "title"}, "日付": {"type": "date"}}}
    ).install(monkeypatch)

    assert garbage_notion.sync(datetime.date(2026, 8, 11)) is None
    assert fake.created == []


def test_dry_run_does_not_write(data_dir, monkeypatch, notion_env):
    write_config(data_dir)
    fake = FakeNotion().install(monkeypatch)

    summary = garbage_notion.sync(datetime.date(2026, 8, 11), dry_run=True)

    assert summary["created"] == 4
    assert summary["dry_run"] is True
    assert fake.created == []


# --- 実行の間引き -------------------------------------------------------------


def test_run_sync_runs_once_a_day(data_dir, monkeypatch, notion_env):
    write_config(data_dir)
    fake = FakeNotion().install(monkeypatch)

    assert garbage_notion.run_sync(datetime.datetime(2026, 8, 11, 3, 0)) is not None
    assert len(fake.created) == 4

    fake.pages = []
    assert garbage_notion.run_sync(datetime.datetime(2026, 8, 11, 9, 0)) is None
    assert len(fake.created) == 4  # 2回目は Notion を触っていない

    # 日が変われば走る
    assert garbage_notion.run_sync(datetime.datetime(2026, 8, 12, 3, 0)) is not None


def test_run_sync_reruns_when_the_config_changes(data_dir, monkeypatch, notion_env):
    """収集ルールを直したあと、翌日まで反映されないのを避ける。"""
    write_config(data_dir)
    fake = FakeNotion().install(monkeypatch)
    garbage_notion.run_sync(datetime.datetime(2026, 8, 11, 3, 0))
    fake.created.clear()

    write_config(data_dir, {**SAMPLE_CONFIG, "exceptions": []})
    assert garbage_notion.run_sync(datetime.datetime(2026, 8, 11, 9, 0)) is not None
    assert fake.created


def test_run_sync_keeps_no_state_when_disabled(data_dir, monkeypatch, notion_env):
    """設定が入り次第すぐ走らせたいので、見送ったときは状態を残さない。"""
    write_config(data_dir, {**SAMPLE_CONFIG, "notion": {"enabled": False}})
    FakeNotion().install(monkeypatch)

    assert garbage_notion.run_sync(datetime.datetime(2026, 8, 11, 3, 0)) is None
    assert not garbage_notion.STATE_PATH.exists()


def test_backend_runs_the_notion_sync_in_background(data_dir, mock_weather, monkeypatch):
    """本番はバックエンドのプロセスが同期を回すので、その配線を守る。"""
    from fastapi.testclient import TestClient

    from backend import database, main

    calls = []
    monkeypatch.setattr(database, "DB_MOCK", False)
    monkeypatch.setattr(main, "GARBAGE_NOTIFY_INTERVAL_SECONDS", 60)
    monkeypatch.setattr(main, "GARBAGE_NOTION_SYNC_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(main.garbage_notify, "run_notify", lambda: None)
    monkeypatch.setattr(main.garbage_notion, "run_sync", lambda: calls.append(True))

    import time

    with TestClient(main.app):
        deadline = time.monotonic() + 5
        while not calls and time.monotonic() < deadline:
            time.sleep(0.01)

    assert calls


# --- API 呼び出し -------------------------------------------------------------


def test_notion_api_wraps_transport_errors(monkeypatch):
    import requests

    def boom(*args, **kwargs):
        raise requests.RequestException("network down")

    monkeypatch.setattr(notion_api.requests, "request", boom)

    with pytest.raises(notion_api.NotionError):
        notion_api.retrieve_data_source("token", "ds-1")


def test_notion_api_pages_through_results(monkeypatch):
    responses = [
        {"results": [{"id": "p1"}], "has_more": True, "next_cursor": "c1"},
        {"results": [{"id": "p2"}], "has_more": False, "next_cursor": None},
    ]
    seen = []

    class Response:
        status_code = 200

        def __init__(self, body):
            self._body = body

        def json(self):
            return self._body

    def request(method, url, headers=None, json=None, timeout=None):
        seen.append(json.get("start_cursor"))
        return Response(responses[len(seen) - 1])

    monkeypatch.setattr(notion_api.requests, "request", request)

    results = notion_api.query_data_source("token", "ds-1")
    assert [page["id"] for page in results] == ["p1", "p2"]
    assert seen == [None, "c1"]
