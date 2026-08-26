import datetime

from backend import cleaning, cleaning_notion

TODAY = datetime.date(2026, 8, 26)

SAMPLE_TASKS = [
    {
        "id": "kitchen-sink",
        "name": "キッチンのシンク",
        "interval_days": 3,
        "steps": ["排水口のゴミを捨てる", "スポンジで磨く"],
        "history": ["2026-08-23", "2026-08-20"],
    },
    {
        "id": "fan",
        "name": "換気扇まわり",
        "interval_days": 30,
        "steps": [],
        "history": ["2026-07-25"],
    },
    {
        "id": "fridge",
        "name": "冷蔵庫の中",
        "interval_days": 60,
        "steps": ["賞味期限を確認する"],
        "history": [],
    },
]


def test_next_due_counts_from_last_done():
    tasks = cleaning.normalize_tasks(SAMPLE_TASKS)
    assert cleaning.next_due(tasks[0], TODAY) == datetime.date(2026, 8, 26)
    assert cleaning.next_due(tasks[1], TODAY) == datetime.date(2026, 8, 24)


def test_next_due_is_today_when_never_done():
    """一度もやっていない掃除は今日が期限。予定が無い状態で埋もれさせない。"""
    tasks = cleaning.normalize_tasks(SAMPLE_TASKS)
    assert cleaning.next_due(tasks[2], TODAY) == TODAY


def test_build_payload_marks_status():
    payload = cleaning.build_payload(cleaning.normalize_tasks(SAMPLE_TASKS), TODAY)
    by_id = {task["id"]: task for task in payload["tasks"]}

    assert payload["configured"] is True
    assert by_id["kitchen-sink"]["status"] == "today"
    assert by_id["kitchen-sink"]["days_until"] == 0
    assert by_id["fan"]["status"] == "overdue"
    assert by_id["fan"]["days_until"] == -2
    assert by_id["fridge"]["last_done"] is None


def test_normalize_drops_nameless_and_clamps_interval():
    tasks = cleaning.normalize_tasks(
        [
            {"name": "  ", "interval_days": 3},
            {"name": "お風呂", "interval_days": 0},
            {"name": "ベランダ", "interval_days": 9999},
        ]
    )
    assert [task["name"] for task in tasks] == ["お風呂", "ベランダ"]
    assert tasks[0]["interval_days"] == cleaning.MIN_INTERVAL_DAYS
    assert tasks[1]["interval_days"] == cleaning.MAX_INTERVAL_DAYS


def test_normalize_gives_unique_ids_to_same_name():
    tasks = cleaning.normalize_tasks([{"name": "床"}, {"name": "床"}])
    assert tasks[0]["id"] != tasks[1]["id"]


def test_history_is_newest_first_without_duplicates_or_future():
    tasks = cleaning.normalize_tasks(
        [
            {
                "name": "トイレ",
                "history": ["2026-08-20", "2026-08-23", "2026-08-20", "2099-01-01", "x"],
            }
        ]
    )
    assert tasks[0]["history"] == ["2026-08-23", "2026-08-20"]


def test_save_tasks_keeps_history_of_existing_ids(data_dir):
    cleaning.save_tasks([{"id": "kitchen-sink", "name": "キッチン", "interval_days": 3}])
    cleaning.mark_done("kitchen-sink", done_on=datetime.date(2026, 8, 25))

    # 名前と間隔だけを編集して送り直しても、実施履歴は消えない
    saved = cleaning.save_tasks(
        [{"id": "kitchen-sink", "name": "キッチンのシンク", "interval_days": 5}]
    )
    assert saved[0]["name"] == "キッチンのシンク"
    assert saved[0]["history"] == ["2026-08-25"]


def test_mark_done_twice_in_a_day_does_not_duplicate(data_dir):
    cleaning.save_tasks([{"id": "toilet", "name": "トイレ", "interval_days": 7}])
    cleaning.mark_done("toilet", done_on=TODAY)
    tasks, found = cleaning.mark_done("toilet", done_on=TODAY)

    assert found is True
    assert tasks[0]["history"] == [TODAY.isoformat()]


def test_mark_done_reports_unknown_id(data_dir):
    tasks, found = cleaning.mark_done("nope")
    assert found is False
    assert tasks == []


# --- Notion への書き出し ------------------------------------------------------

RESOLVED = {
    "title": "タイトル",
    "date": "期限",
    "tag": "タグ",
    "memo": "メモ",
    "done": "完了",
}


def test_resolve_properties_picks_date_by_name():
    """Task データベースには日付が「期限」「予定日」の2つある。型だけでは決まらない。"""
    schema = {
        "properties": {
            "タイトル": {"type": "title"},
            "期限": {"type": "date"},
            "予定日": {"type": "date"},
            "タグ": {"type": "multi_select"},
            "メモ": {"type": "rich_text"},
            "完了": {"type": "checkbox"},
        }
    }
    resolved, errors = cleaning_notion.resolve_properties(schema)
    assert errors == []
    assert resolved["date"] == "期限"


def test_resolve_properties_reports_missing_tag():
    schema = {"properties": {"タイトル": {"type": "title"}, "期限": {"type": "date"}}}
    resolved, errors = cleaning_notion.resolve_properties(schema)
    assert errors
    assert "tag" not in resolved


def test_build_entries_writes_only_the_next_one_per_task():
    tasks = cleaning.normalize_tasks(SAMPLE_TASKS)
    entries = cleaning_notion.build_entries(tasks, TODAY)

    assert len(entries) == len(tasks)
    assert entries[0]["title"] == "掃除: キッチンのシンク"
    assert entries[0]["date"] == "2026-08-26"
    assert entries[0]["memo"] == "3日ごと／排水口のゴミを捨てる／スポンジで磨く"


def test_plan_changes_creates_updates_and_archives():
    expected = [
        {"title": "掃除: トイレ", "date": "2026-08-29", "memo": "7日ごと"},
        {"title": "掃除: お風呂", "date": "2026-08-31", "memo": "7日ごと"},
    ]
    existing = [
        {"page_id": "p1", "title": "掃除: トイレ", "date": "2026-08-22", "memo": "7日ごと", "done": False, "tags": ["掃除", "生活"]},
        {"page_id": "p2", "title": "掃除: 玄関", "date": "2026-08-20", "memo": "", "done": False, "tags": ["掃除"]},
    ]
    changes = cleaning_notion.plan_changes(expected, existing)

    assert [item["title"] for item in changes["create"]] == ["掃除: お風呂"]
    assert changes["update"][0]["page_id"] == "p1"
    assert changes["update"][0]["date"] == "2026-08-29"
    assert [item["page_id"] for item in changes["archive"]] == ["p2"]


def test_plan_changes_leaves_unchanged_pages_alone():
    expected = [{"title": "掃除: トイレ", "date": "2026-08-29", "memo": "7日ごと"}]
    existing = [
        {"page_id": "p1", "title": "掃除: トイレ", "date": "2026-08-29", "memo": "7日ごと", "done": False, "tags": ["掃除"]}
    ]
    changes = cleaning_notion.plan_changes(expected, existing)
    assert changes == {"create": [], "update": [], "archive": []}


def test_to_notion_properties_keeps_other_tags():
    entry = {"title": "掃除: トイレ", "date": "2026-08-29", "memo": "7日ごと"}
    properties = cleaning_notion.to_notion_properties(entry, RESOLVED, ["生活", "掃除"])

    assert [tag["name"] for tag in properties["タグ"]["multi_select"]] == ["掃除", "生活"]
    assert properties["期限"]["date"]["start"] == "2026-08-29"
    # 予定を書き直すときは完了チェックを外す（前回の完了が残らないように）
    assert properties["完了"]["checkbox"] is False


def test_find_completed_matches_by_title():
    tasks = cleaning.normalize_tasks(SAMPLE_TASKS)
    existing = [
        {"page_id": "p1", "title": "掃除: 換気扇まわり", "date": "2026-08-24", "memo": "", "done": True, "tags": ["掃除"]},
        {"page_id": "p2", "title": "掃除: キッチンのシンク", "date": "2026-08-26", "memo": "", "done": False, "tags": ["掃除"]},
        {"page_id": "p3", "title": "買い物へ行く", "date": "2026-08-26", "memo": "", "done": True, "tags": ["掃除"]},
    ]
    assert cleaning_notion.find_completed(tasks, existing) == ["fan"]


def test_parse_page_reads_title_date_and_done():
    page = {
        "id": "page-1",
        "properties": {
            "タイトル": {"title": [{"plain_text": "掃除: トイレ"}]},
            "期限": {"date": {"start": "2026-08-29T00:00:00.000+09:00"}},
            "タグ": {"multi_select": [{"name": "掃除"}, {"name": "生活"}]},
            "メモ": {"rich_text": [{"plain_text": "7日ごと"}]},
            "完了": {"checkbox": True},
        },
    }
    parsed = cleaning_notion.parse_page(page, RESOLVED)

    assert parsed["title"] == "掃除: トイレ"
    assert parsed["date"] == "2026-08-29"
    assert parsed["done"] is True
    assert parsed["tags"] == ["掃除", "生活"]


def test_sync_does_nothing_without_env(data_dir):
    cleaning.save_tasks([{"id": "toilet", "name": "トイレ", "interval_days": 7}])
    assert cleaning_notion.sync(today=TODAY) is None


# --- API ----------------------------------------------------------------------


def test_cleaning_api_round_trip(authed_client):
    empty = authed_client.get("/api/cleaning").json()
    assert empty["configured"] is False
    assert empty["tasks"] == []

    saved = authed_client.put(
        "/api/cleaning/tasks",
        json={
            "tasks": [
                {"id": "toilet", "name": "トイレ", "interval_days": 7, "steps": ["便器を洗う"]},
                {"id": "bath", "name": "お風呂", "interval_days": 7, "steps": []},
            ]
        },
    ).json()
    assert [task["name"] for task in saved["tasks"]] == ["トイレ", "お風呂"]
    # 一度もやっていないので今日が期限
    assert saved["tasks"][0]["status"] == "today"

    done = authed_client.post(
        "/api/cleaning/tasks/toilet/done", json={"date": "2026-08-26"}
    ).json()
    by_id = {task["id"]: task for task in done["tasks"]}
    assert by_id["toilet"]["last_done"] == "2026-08-26"
    assert by_id["toilet"]["next_due"] == "2026-09-02"


def test_cleaning_done_rejects_unknown_task(authed_client):
    assert authed_client.post("/api/cleaning/tasks/nope/done").status_code == 404


def test_cleaning_done_rejects_broken_date(authed_client):
    authed_client.put(
        "/api/cleaning/tasks",
        json={"tasks": [{"id": "toilet", "name": "トイレ", "interval_days": 7, "steps": []}]},
    )
    response = authed_client.post("/api/cleaning/tasks/toilet/done", json={"date": "8/26"})
    assert response.status_code == 400


def test_cleaning_requires_auth(client):
    assert client.get("/api/cleaning").status_code in (401, 403)


def test_sync_creates_updates_archives_and_reads_back(data_dir, monkeypatch):
    """Notion 側を差し替えて、同期のひと通り（作成・更新・片付け・読み戻し）を通す。"""
    monkeypatch.setenv(cleaning_notion.ENV_TOKEN, "test-token")
    monkeypatch.setenv(cleaning_notion.ENV_DATA_SOURCE_ID, "test-data-source")

    cleaning.save_tasks(
        [
            {"id": "toilet", "name": "トイレ", "interval_days": 7, "steps": ["便器を洗う"]},
            {"id": "bath", "name": "お風呂", "interval_days": 7, "steps": []},
        ]
    )
    # トイレは8/19に実施済み → 期限は8/26（今日）
    cleaning.mark_done("toilet", done_on=datetime.date(2026, 8, 19))

    schema = {
        "properties": {
            "タイトル": {"type": "title"},
            "期限": {"type": "date"},
            "予定日": {"type": "date"},
            "タグ": {"type": "multi_select"},
            "メモ": {"type": "rich_text"},
            "完了": {"type": "checkbox"},
        }
    }

    def page(page_id, title, date, memo="", done=False):
        return {
            "id": page_id,
            "properties": {
                "タイトル": {"title": [{"plain_text": title}]},
                "期限": {"date": {"start": date}},
                "タグ": {"multi_select": [{"name": "掃除"}]},
                "メモ": {"rich_text": [{"plain_text": memo}]},
                "完了": {"checkbox": done},
            },
        }

    existing = [
        # 完了になっている → お風呂を実施済みとして読み戻す
        page("p-bath", "掃除: お風呂", "2026-08-26", "7日ごと", done=True),
        # 期限がずれている → 更新
        page("p-toilet", "掃除: トイレ", "2026-08-20", "7日ごと／便器を洗う"),
        # 掃除の一覧に無い → 片付け
        page("p-old", "掃除: 玄関", "2026-08-10"),
    ]

    created, updated, archived = [], [], []
    monkeypatch.setattr(cleaning_notion.notion_api, "retrieve_data_source", lambda *a: schema)
    monkeypatch.setattr(cleaning_notion.notion_api, "query_data_source", lambda *a, **k: existing)
    monkeypatch.setattr(
        cleaning_notion.notion_api,
        "create_page",
        lambda token, ds, props: created.append(props),
    )
    monkeypatch.setattr(
        cleaning_notion.notion_api,
        "update_page",
        lambda token, page_id, props: updated.append((page_id, props)),
    )
    monkeypatch.setattr(
        cleaning_notion.notion_api,
        "archive_page",
        lambda token, page_id: archived.append(page_id),
    )

    summary = cleaning_notion.sync(today=TODAY)

    assert summary["completed"] == 1
    # 完了を読み戻したので、お風呂は今日やった扱い → 次の期限は 9/2 へ動く
    by_id = {task["id"]: task for task in cleaning.get_tasks()}
    assert by_id["bath"]["history"] == [TODAY.isoformat()]

    assert [page_id for page_id, _ in updated] == ["p-bath", "p-toilet"]
    updated_by_id = dict(updated)
    assert updated_by_id["p-bath"]["期限"]["date"]["start"] == "2026-09-02"
    assert updated_by_id["p-bath"]["完了"]["checkbox"] is False
    assert updated_by_id["p-toilet"]["期限"]["date"]["start"] == "2026-08-26"

    assert archived == ["p-old"]
    assert created == []
