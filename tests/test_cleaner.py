import datetime

from backend import cleaner, database


def _rows(items):
    """(時刻文字列, 状態, 残量) の並びから `_fetch_rows` 相当の行を作る。"""
    return [
        {
            "datetime": datetime.datetime.fromisoformat(when),
            "event": event,
            "battery": battery,
            "updated_at": datetime.datetime.fromisoformat(when),
        }
        for when, event, battery in items
    ]


def test_normalize_event_absorbs_tuya_wording():
    # Tuya の status DP は機種・ファームで表記が揺れる
    assert cleaner.normalize_event("Cleaning") == "cleaning"
    assert cleaner.normalize_event("auto") == "cleaning"
    assert cleaner.normalize_event("Recharge") == "returning"
    assert cleaner.normalize_event("Completed") == "docked"
    assert cleaner.normalize_event("standby") == "docked"
    # 知らない値はそのまま通す（名前が出ないより生の値が出るほうが原因を追える）
    assert cleaner.normalize_event("mopping") == "mopping"


def test_parse_battery_rejects_out_of_range():
    assert cleaner.parse_battery(78) == 78
    assert cleaner.parse_battery("78.4") == 78
    assert cleaner.parse_battery(None) is None
    assert cleaner.parse_battery(-1) is None
    assert cleaner.parse_battery(120) is None
    assert cleaner.parse_battery("unknown") is None


def test_runs_pair_cleaning_with_the_next_state():
    rows = _rows(
        [
            ("2026-08-20T09:05:00", "cleaning", 80),
            ("2026-08-20T09:46:00", "charging", 55),
            ("2026-08-22T14:32:00", "cleaning", 60),
            ("2026-08-22T15:04:00", "charging", 42),
        ]
    )
    runs = cleaner.build_runs(rows, datetime.datetime(2026, 8, 22, 16, 0))

    assert [run["duration_minutes"] for run in runs] == [41, 32]
    assert all(run["running"] is False for run in runs)


def test_last_cleaning_row_is_still_running():
    rows = _rows(
        [
            ("2026-08-22T14:32:00", "cleaning", 78),
        ]
    )
    now = datetime.datetime(2026, 8, 22, 14, 44)
    summary = cleaner.build_summary(rows, now)

    assert summary["current"]["event"] == "cleaning"
    assert summary["current"]["label"] == "掃除中"
    assert summary["last_run"]["running"] is True
    assert summary["last_run"]["duration_minutes"] == 12
    # 動いている最中のものは平均に混ぜない（時間がたつほど平均が伸びてしまう）
    assert summary["this_month"]["count"] == 1
    assert summary["this_month"]["average_minutes"] is None


def test_summary_counts_only_this_month():
    rows = _rows(
        [
            ("2026-07-30T09:05:00", "cleaning", 80),
            ("2026-07-30T09:45:00", "charging", 55),
            ("2026-08-02T14:00:00", "cleaning", 80),
            ("2026-08-02T14:20:00", "charging", 60),
            ("2026-08-22T14:32:00", "cleaning", 70),
            ("2026-08-22T15:12:00", "charging", 45),
        ]
    )
    summary = cleaner.build_summary(rows, datetime.datetime(2026, 8, 22, 16, 0))

    assert summary["this_month"]["count"] == 2
    assert summary["this_month"]["average_minutes"] == 30  # (20 + 40) / 2
    assert summary["last_run"]["started_at"] == "2026-08-22T14:32:00"
    assert summary["days_since_previous_run"] == 20
    # 新しい順に並ぶ
    assert [run["started_at"] for run in summary["recent_runs"]] == [
        "2026-08-22T14:32:00",
        "2026-08-02T14:00:00",
        "2026-07-30T09:05:00",
    ]


def test_summary_marks_stale_when_nothing_arrives():
    rows = _rows([("2026-08-22T14:32:00", "charging", 90)])
    fresh = cleaner.build_summary(rows, datetime.datetime(2026, 8, 22, 14, 50))
    stale = cleaner.build_summary(rows, datetime.datetime(2026, 8, 22, 18, 0))

    assert fresh["stale"] is False
    assert stale["stale"] is True


def test_summary_without_records_is_empty_but_valid():
    summary = cleaner.build_summary([], datetime.datetime(2026, 8, 22, 16, 0))

    assert summary["current"] is None
    assert summary["last_run"] is None
    assert summary["recent_runs"] == []
    assert summary["this_month"]["count"] == 0
    assert summary["stale"] is False


def test_mock_rows_end_with_a_recent_run():
    now = datetime.datetime(2026, 8, 22, 14, 35)
    summary = cleaner.build_summary(database.generate_mock_cleaner_rows(now), now)

    assert summary["stale"] is False
    assert summary["last_run"]["started_at"].startswith("2026-08-22")
    assert len(summary["recent_runs"]) == cleaner.DEFAULT_RECENT_RUNS
    assert summary["this_month"]["count"] > 0


def test_cleaner_summary_requires_auth(client):
    response = client.get("/api/cleaner/summary")
    assert response.status_code == 401


def test_cleaner_summary_returns_mock_data(authed_client):
    response = authed_client.get("/api/cleaner/summary")
    assert response.status_code == 200
    payload = response.json()
    assert payload["current"]["label"]
    assert payload["last_run"]["started_at"]
    assert payload["recent_runs"]


def test_cleaner_post_normalizes_the_event(client):
    response = client.post("/api/cleaner", json={"event": "Recharge", "battery": 42})
    assert response.status_code == 200
    assert response.json() == {
        "status": "mock_ok",
        "event": "returning",
        "changed": False,
    }


def test_cleaner_post_rejects_an_empty_event(client):
    response = client.post("/api/cleaner", json={"event": "  "})
    assert response.status_code == 422
