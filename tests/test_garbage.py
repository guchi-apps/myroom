import datetime
import json
import time

import pytest

from backend import garbage, garbage_notify

SAMPLE_CONFIG = {
    "area": "茨木市",
    "notify_hour": 20,
    "categories": [
        {
            "id": "burnable",
            "name": "普通ごみ",
            "color": "#e67e22",
            "note": "生ごみ",
            "rules": [{"type": "weekly", "weekdays": ["tue", "fri"]}],
        },
        {
            "id": "recyclable",
            "name": "資源ごみ",
            "rules": [{"type": "monthly", "weekday": "水", "weeks": [2, -1]}],
        },
    ],
    "exceptions": [
        {"date": "2026-08-14", "cancel": True, "note": "お盆のため収集なし"},
        {"date": "2026-08-16", "add": ["burnable"], "note": "振替収集"},
        {"date": "2026-08-18", "cancel": ["burnable"]},
    ],
}


def write_config(data_dir, config=None):
    path = data_dir / "garbage.json"
    path.write_text(
        json.dumps(config if config is not None else SAMPLE_CONFIG, ensure_ascii=False),
        encoding="utf-8",
    )
    return path


@pytest.fixture
def config(data_dir):
    write_config(data_dir)
    return garbage.load_config()


def categories_on(config, iso_date):
    return [
        category["name"]
        for category in garbage.categories_on(config, datetime.date.fromisoformat(iso_date))
    ]


def test_weekly_rule_matches_configured_weekdays(config):
    # 2026-08-11 は火曜、2026-08-13 は木曜
    assert categories_on(config, "2026-08-11") == ["普通ごみ"]
    assert categories_on(config, "2026-08-13") == []


def test_monthly_rule_matches_nth_weekday(config):
    # 2026-08 の水曜は 5, 12, 19, 26 日。第2水曜は 12 日、最終水曜は 26 日
    assert "資源ごみ" not in categories_on(config, "2026-08-05")
    assert "資源ごみ" in categories_on(config, "2026-08-12")
    assert "資源ごみ" not in categories_on(config, "2026-08-19")
    assert "資源ごみ" in categories_on(config, "2026-08-26")


def test_exception_cancels_all_categories(config):
    # 2026-08-14 は金曜（普通ごみ）だが、例外で中止
    assert categories_on(config, "2026-08-14") == []


def test_exception_adds_extra_collection(config):
    # 2026-08-16 は日曜でルール上は収集なし
    assert categories_on(config, "2026-08-16") == ["普通ごみ"]


def test_exception_cancels_single_category(config):
    # 2026-08-18 は火曜（普通ごみ）だが、品目を指定して中止
    assert categories_on(config, "2026-08-18") == []


def test_build_payload_returns_today_tomorrow_and_upcoming(data_dir):
    write_config(data_dir)
    payload = garbage.build_payload(datetime.date(2026, 8, 11))

    assert payload["configured"] is True
    assert payload["area"] == "茨木市"
    assert payload["today"]["date"] == "2026-08-11"
    assert payload["today"]["weekday"] == "火"
    assert [c["name"] for c in payload["today"]["categories"]] == ["普通ごみ"]

    # 8/12 は第2水曜
    assert payload["tomorrow"]["date"] == "2026-08-12"
    assert [c["name"] for c in payload["tomorrow"]["categories"]] == ["資源ごみ"]

    # 明後日以降で収集がある日。8/14（金）と 8/18（火）は例外で中止、8/16（日）は臨時収集
    assert [entry["date"] for entry in payload["upcoming"]] == [
        "2026-08-16",
        "2026-08-21",
        "2026-08-25",
    ]
    assert payload["upcoming"][0]["days_until"] == 5
    assert payload["upcoming"][0]["notes"] == ["振替収集"]


def test_missing_config_is_reported_as_unconfigured(data_dir):
    payload = garbage.build_payload(datetime.date(2026, 8, 11))
    assert payload["configured"] is False
    assert payload["today"]["categories"] == []
    assert payload["upcoming"] == []


def test_broken_config_is_reported_as_unconfigured(data_dir):
    (data_dir / "garbage.json").write_text("{ not json", encoding="utf-8")
    assert garbage.load_config()["configured"] is False


def test_invalid_rules_are_ignored(data_dir):
    write_config(
        data_dir,
        {
            "categories": [
                {"id": "x", "name": "壊れたルール", "rules": [{"type": "weekly", "weekdays": ["xxx"]}]},
                {"id": "y", "name": "曜日なし", "rules": [{"type": "monthly", "weeks": [1]}]},
            ]
        },
    )
    config = garbage.load_config()
    assert config["configured"] is True
    assert all(category["rules"] == [] for category in config["categories"])
    assert categories_on(config, "2026-08-11") == []


def test_api_returns_schedule(authed_client, data_dir):
    write_config(data_dir)
    response = authed_client.get("/api/garbage")
    assert response.status_code == 200
    payload = response.json()
    assert payload["configured"] is True
    assert payload["area"] == "茨木市"
    assert set(payload["today"]) == {"date", "weekday", "days_until", "categories", "notes"}


def test_api_requires_auth(client):
    assert client.get("/api/garbage").status_code == 401


def test_notify_sends_for_tomorrow(data_dir, monkeypatch):
    write_config(data_dir)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    sent = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: sent.append(kwargs),
    )

    # 2026-08-10（月）20時 -> 翌 8/11（火）は普通ごみ
    entry = garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 20, 0))
    assert entry is not None
    assert sent[0]["category_names"] == ["普通ごみ"]
    assert sent[0]["date_label"] == "8/11（火）"

    # 同じ収集日について二度目は送らない
    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 20, 30)) is None
    assert len(sent) == 1


def test_notify_skips_outside_notify_hour(data_dir, monkeypatch):
    write_config(data_dir)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    sent = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: sent.append(kwargs),
    )

    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 9, 0)) is None
    assert sent == []


def test_backend_runs_the_notifier_in_background(data_dir, mock_weather, monkeypatch):
    """本番は systemd タイマーではなくバックエンドのプロセスが通知を回すので、その配線を守る。"""
    from fastapi.testclient import TestClient

    from backend import database, main

    calls = []
    monkeypatch.setattr(database, "DB_MOCK", False)
    monkeypatch.setattr(main, "GARBAGE_NOTIFY_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(main.garbage_notify, "run_notify", lambda: calls.append(True))

    with TestClient(main.app):
        deadline = time.monotonic() + 5
        while not calls and time.monotonic() < deadline:
            time.sleep(0.01)

    assert calls


def test_notify_skips_when_no_collection_tomorrow(data_dir, monkeypatch):
    write_config(data_dir)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    sent = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: sent.append(kwargs),
    )

    # 2026-08-13（木）の翌日 8/14（金）は例外で中止
    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 13, 20, 0)) is None
    assert sent == []
