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


def test_build_payload_lists_the_next_collection_per_category(data_dir):
    write_config(data_dir)
    payload = garbage.build_payload(datetime.date(2026, 8, 11))

    # 設定に書いた順のまま返す。カードもこの順に並べる（日付順には並べ替えない）
    assert [entry["name"] for entry in payload["by_category"]] == ["普通ごみ", "資源ごみ"]

    burnable, recyclable = payload["by_category"]
    # 8/11（火）は普通ごみの収集日。今日も「次の収集」に含める
    assert burnable["next"] == {"date": "2026-08-11", "weekday": "火", "days_until": 0}
    # 8/12 は第2水曜
    assert recyclable["next"] == {"date": "2026-08-12", "weekday": "水", "days_until": 1}
    assert burnable["color"] == "#e67e22"


def test_next_collection_skips_days_cancelled_by_an_exception(data_dir):
    write_config(data_dir)
    # 8/13（木）から見ると次の普通ごみは 8/14（金）だが、例外で中止。臨時収集の 8/16（日）になる
    payload = garbage.build_payload(datetime.date(2026, 8, 13))
    assert payload["by_category"][0]["next"]["date"] == "2026-08-16"


def test_collection_time_falls_back_to_the_default_when_unusable(data_dir):
    # SAMPLE_CONFIG は collection_time を書いていない
    write_config(data_dir)
    assert garbage.load_config()["collection_time"] == "08:30"

    write_config(data_dir, {**SAMPLE_CONFIG, "collection_time": "9:15"})
    assert garbage.load_config()["collection_time"] == "09:15"

    for broken in ["25:00", "あさ", 830, None, True]:
        write_config(data_dir, {**SAMPLE_CONFIG, "collection_time": broken})
        assert garbage.load_config()["collection_time"] == "08:30", broken


def test_today_is_still_the_next_collection_before_the_collection_time(data_dir):
    write_config(data_dir)
    # 8/11（火）は普通ごみの収集日。8:30 の1分前
    payload = garbage.build_payload(now=datetime.datetime(2026, 8, 11, 8, 29))

    assert payload["collection_time"] == "08:30"
    assert payload["today_done"] is False
    assert payload["by_category"][0]["next"]["date"] == "2026-08-11"


def test_collection_time_moves_the_next_collection_to_the_following_days(data_dir):
    write_config(data_dir)
    # 8:30 ちょうどから「済んだ」扱いにする
    payload = garbage.build_payload(now=datetime.datetime(2026, 8, 11, 8, 30))

    assert payload["today_done"] is True
    # 今日の行は消さずに残す（済んだことが見た目で分かるようにするのはフロント側）
    assert [category["name"] for category in payload["today"]["categories"]] == ["普通ごみ"]

    burnable, recyclable = payload["by_category"]
    # 次の普通ごみは 8/14（金）だが例外で中止、臨時収集の 8/16（日）になる
    assert burnable["next"]["date"] == "2026-08-16"
    # 今日の収集が無かった品目は影響を受けない
    assert recyclable["next"]["date"] == "2026-08-12"


def test_today_is_not_done_when_there_is_no_collection_today(data_dir):
    write_config(data_dir)
    # 8/13（木）は収集なし。時刻を過ぎていても「済んだ」ことにはしない
    payload = garbage.build_payload(now=datetime.datetime(2026, 8, 13, 20, 0))
    assert payload["today_done"] is False
    assert payload["by_category"][0]["next"]["date"] == "2026-08-16"


def test_today_is_not_done_when_only_a_date_is_given(data_dir):
    """日付だけを渡す呼び出し（基準時刻を持たない）では、当日の収集はまだ扱いにする。"""
    write_config(data_dir)
    payload = garbage.build_payload(datetime.date(2026, 8, 11))
    assert payload["today_done"] is False
    assert payload["by_category"][0]["next"]["date"] == "2026-08-11"


def test_next_collection_is_none_when_the_category_has_no_rule(data_dir):
    write_config(
        data_dir,
        {
            "categories": [
                {
                    "id": "burnable",
                    "name": "普通ごみ",
                    "rules": [{"type": "weekly", "weekdays": ["tue"]}],
                },
                {"id": "bulky", "name": "大型可燃ごみ", "rules": []},
            ]
        },
    )
    payload = garbage.build_payload(datetime.date(2026, 8, 11))
    assert payload["by_category"][0]["next"]["date"] == "2026-08-11"
    assert payload["by_category"][1]["next"] is None


def test_missing_config_is_reported_as_unconfigured(data_dir):
    payload = garbage.build_payload(datetime.date(2026, 8, 11))
    assert payload["configured"] is False
    assert payload["today"]["categories"] == []
    assert payload["upcoming"] == []
    assert payload["by_category"] == []


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


def test_collection_days_lists_every_collection_in_the_range(config):
    days = garbage.collection_days(
        config, datetime.date(2026, 8, 11), datetime.date(2026, 8, 25)
    )

    # 8/14（金）と 8/18（火）は例外で中止、8/16（日）は臨時収集
    assert [day["date"].isoformat() for day in days] == [
        "2026-08-11",
        "2026-08-12",
        "2026-08-16",
        "2026-08-21",
        "2026-08-25",
    ]
    assert [category["name"] for category in days[1]["categories"]] == ["資源ごみ"]
    assert days[2]["notes"] == ["振替収集"]
    assert days[0]["weekday"] == "火"


def test_collection_days_includes_both_ends_of_the_range(config):
    days = garbage.collection_days(
        config, datetime.date(2026, 8, 11), datetime.date(2026, 8, 12)
    )
    assert [day["date"].isoformat() for day in days] == ["2026-08-11", "2026-08-12"]


def test_notion_section_falls_back_to_defaults(data_dir):
    write_config(data_dir, {**SAMPLE_CONFIG, "notion": {"window_days": 0, "properties": {"date": "  "}}})
    notion = garbage.load_config()["notion"]

    assert notion["enabled"] is True
    assert notion["window_days"] == garbage.DEFAULT_NOTION_WINDOW_DAYS
    assert notion["category_value"] == garbage.DEFAULT_NOTION_CATEGORY_VALUE
    assert notion["properties"] == garbage.DEFAULT_NOTION_PROPERTIES


def test_notion_section_can_be_overridden(data_dir):
    write_config(
        data_dir,
        {
            **SAMPLE_CONFIG,
            "notion": {
                "enabled": False,
                "window_days": 30,
                "category_value": "ごみ収集",
                "properties": {"date": "Date"},
            },
        },
    )
    notion = garbage.load_config()["notion"]

    assert notion["enabled"] is False
    assert notion["window_days"] == 30
    assert notion["category_value"] == "ごみ収集"
    assert notion["properties"]["date"] == "Date"
    # 指定しなかった項目は既定のまま
    assert notion["properties"]["title"] == "タイトル"


def test_api_returns_schedule(authed_client, data_dir):
    write_config(data_dir)
    response = authed_client.get("/api/garbage")
    assert response.status_code == 200
    payload = response.json()
    assert payload["configured"] is True
    assert payload["area"] == "茨木市"
    assert set(payload["today"]) == {"date", "weekday", "days_until", "categories", "notes"}
    assert set(payload["by_category"][0]) == {"id", "name", "color", "note", "next"}


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
    entries = garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 20, 0))
    assert len(entries) == 1
    assert entries[0]["timing"] == "before"
    assert sent[0]["category_names"] == ["普通ごみ"]
    assert sent[0]["date_label"] == "8/11（火）"

    # 同じ収集日について二度目は送らない
    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 20, 30)) == []
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

    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 9, 0)) == []
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
    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 13, 20, 0)) == []
    assert sent == []


def test_notify_dispatches_a_push_event(data_dir, monkeypatch):
    """#293: Signalyと同じタイミングでPush通知も送る。"""
    write_config(data_dir)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    monkeypatch.setattr(garbage_notify.signaly_notify, "send_garbage_notification", lambda **kwargs: None)
    dispatched = []
    monkeypatch.setattr(
        garbage_notify.notify_events,
        "dispatch_push_event",
        lambda event: dispatched.append(event),
    )

    garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 20, 0))

    assert len(dispatched) == 1
    assert dispatched[0].kind == "garbage"
    assert "普通ごみ" in dispatched[0].title
    assert dispatched[0].dedupe_key == "garbage-2026-08-11"


def test_notify_skipped_when_disabled_via_settings(data_dir, monkeypatch):
    """#293: 通知設定画面でオフにしたら送らない。"""
    from backend import ui_settings

    write_config(data_dir)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    ui_settings.save_settings({ui_settings.SETTING_GARBAGE_NOTIFY_ENABLED: False})
    sent = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: sent.append(kwargs),
    )

    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 20, 0)) == []
    assert sent == []


def test_notify_time_setting_overrides_notify_hour(data_dir, monkeypatch):
    """#293: 画面で設定した通知時刻を data/garbage.json の notify_hour より優先する。"""
    from backend import ui_settings

    write_config(data_dir)  # notify_hour = 20（write_config の既定値）
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    ui_settings.save_settings({ui_settings.SETTING_GARBAGE_NOTIFY_TIME: "07:00"})
    sent = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: sent.append(kwargs),
    )

    # 20時（従来の notify_hour）ではもう送らない
    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 20, 0)) == []
    assert sent == []

    # 7時（設定した時刻）に送る
    entries = garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 7, 0))
    assert len(entries) == 1
    assert len(sent) == 1


# --- 前日/当日・品目ごとのタイミング（#347） --------------------------------------


def test_notify_same_day_disabled_by_default(data_dir, monkeypatch):
    """新機能は既定でOFFなので、当日朝の時刻になっても何も送らない。"""
    write_config(data_dir)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    sent = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: sent.append(kwargs),
    )

    # 2026-08-11（火）7時 = 当日通知の既定時刻。普通ごみの収集日だが、当日通知は既定OFF
    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 11, 7, 0)) == []
    assert sent == []


def test_notify_same_day_sends_for_today(data_dir, monkeypatch):
    """#347: 当日通知を有効にし、品目を当日グループへ割り当てると当日朝に送られる。"""
    from backend import ui_settings

    write_config(data_dir)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    ui_settings.save_settings(
        {
            ui_settings.SETTING_GARBAGE_NOTIFY_SAME_DAY_ENABLED: True,
            ui_settings.SETTING_GARBAGE_NOTIFY_CATEGORY_TIMING: {"burnable": ["same_day"]},
        }
    )
    sent = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: sent.append(kwargs),
    )

    entries = garbage_notify.run_notify(datetime.datetime(2026, 8, 11, 7, 0))
    assert len(entries) == 1
    assert entries[0]["timing"] == "same_day"
    assert sent[0]["category_names"] == ["普通ごみ"]
    assert sent[0]["date_label"] == "8/11（火）"

    # 同じ収集日について二度目は送らない
    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 11, 7, 30)) == []
    assert len(sent) == 1


def test_notify_same_day_dedupe_independent_of_before(data_dir, monkeypatch):
    """前日分をすでに送っていても、当日分は独立して送れる（逆も）。"""
    from backend import ui_settings

    write_config(data_dir)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    ui_settings.save_settings(
        {
            ui_settings.SETTING_GARBAGE_NOTIFY_SAME_DAY_ENABLED: True,
            ui_settings.SETTING_GARBAGE_NOTIFY_CATEGORY_TIMING: {
                "burnable": ["before", "same_day"]
            },
        }
    )
    monkeypatch.setattr(
        garbage_notify.signaly_notify, "send_garbage_notification", lambda **kwargs: None
    )

    # 前日20時分（8/10 20時 -> 8/11収集）を送る
    before_entries = garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 20, 0))
    assert [e["timing"] for e in before_entries] == ["before"]

    # 続けて当日7時分（8/11 7時）も独立して送れる
    same_day_entries = garbage_notify.run_notify(datetime.datetime(2026, 8, 11, 7, 0))
    assert [e["timing"] for e in same_day_entries] == ["same_day"]


def test_notify_category_timing_splits_before_and_same_day(data_dir, monkeypatch):
    """#347: 品目ごとに前日・当日どちらに属するかを振り分ける（両方に属することもできる）。"""
    from backend import ui_settings

    config = dict(SAMPLE_CONFIG)
    config["categories"] = [
        {"id": "burnable", "name": "普通ごみ", "rules": [{"type": "weekly", "weekdays": ["tue"]}]},
        {"id": "bulky", "name": "大型可燃ごみ", "rules": [{"type": "weekly", "weekdays": ["tue"]}]},
    ]
    write_config(data_dir, config)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    ui_settings.save_settings(
        {
            ui_settings.SETTING_GARBAGE_NOTIFY_SAME_DAY_ENABLED: True,
            ui_settings.SETTING_GARBAGE_NOTIFY_CATEGORY_TIMING: {
                # 大型可燃ごみだけ前日・当日の両方に属する
                "bulky": ["before", "same_day"]
            },
        }
    )
    sent = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: sent.append(kwargs),
    )

    before_entries = garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 20, 0))
    assert len(before_entries) == 1
    assert [c["name"] for c in before_entries[0]["categories"]] == ["普通ごみ", "大型可燃ごみ"]

    same_day_entries = garbage_notify.run_notify(datetime.datetime(2026, 8, 11, 7, 0))
    assert len(same_day_entries) == 1
    assert [c["name"] for c in same_day_entries[0]["categories"]] == ["大型可燃ごみ"]


def test_notify_skips_group_when_no_categories_assigned(data_dir, monkeypatch):
    """当日通知を有効にしても、当日グループへ割り当てた品目が無ければ送らない。"""
    from backend import ui_settings

    write_config(data_dir)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    ui_settings.save_settings({ui_settings.SETTING_GARBAGE_NOTIFY_SAME_DAY_ENABLED: True})
    sent = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: sent.append(kwargs),
    )

    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 11, 7, 0)) == []
    assert sent == []


def test_notify_reads_old_state_file_format(data_dir, monkeypatch):
    """旧形式 {"last_notified_date": ...} を読んでも前日分の二重送信防止が効く（後方互換）。"""
    write_config(data_dir)
    state_path = data_dir / "garbage_notify_state.json"
    state_path.write_text(json.dumps({"last_notified_date": "2026-08-11"}), encoding="utf-8")
    monkeypatch.setattr(garbage_notify, "STATE_PATH", state_path)
    sent = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: sent.append(kwargs),
    )

    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 20, 0)) == []
    assert sent == []


def test_notify_dedupe_key_differs_between_before_and_same_day(data_dir, monkeypatch):
    """計画レビュー指摘1: 同じ収集日でも前日・当日でPush通知のdedupe_keyが衝突しない。

    衝突すると、後から届く通知のtagが同じになりブラウザ側で無音上書きされてしまう
    （renotifyを指定していないため）。
    """
    from backend import ui_settings

    write_config(data_dir)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    ui_settings.save_settings(
        {
            ui_settings.SETTING_GARBAGE_NOTIFY_SAME_DAY_ENABLED: True,
            ui_settings.SETTING_GARBAGE_NOTIFY_CATEGORY_TIMING: {
                "burnable": ["before", "same_day"]
            },
        }
    )
    monkeypatch.setattr(
        garbage_notify.signaly_notify, "send_garbage_notification", lambda **kwargs: None
    )
    dispatched = []
    monkeypatch.setattr(
        garbage_notify.notify_events,
        "dispatch_push_event",
        lambda event: dispatched.append(event),
    )

    garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 20, 0))  # 前日分
    garbage_notify.run_notify(datetime.datetime(2026, 8, 11, 7, 0))  # 当日分

    assert len(dispatched) == 2
    keys = [event.dedupe_key for event in dispatched]
    assert len(set(keys)) == 2, f"dedupe_keyが衝突している: {keys}"


def test_notify_signaly_title_matches_timing(data_dir, monkeypatch):
    """計画レビュー指摘2: Signalyの文面が当日通知でも「明日は」のまま固定にならない。"""
    from backend import ui_settings

    write_config(data_dir)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    ui_settings.save_settings(
        {
            ui_settings.SETTING_GARBAGE_NOTIFY_SAME_DAY_ENABLED: True,
            ui_settings.SETTING_GARBAGE_NOTIFY_CATEGORY_TIMING: {"burnable": ["same_day"]},
        }
    )
    calls = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: calls.append(kwargs),
    )

    garbage_notify.run_notify(datetime.datetime(2026, 8, 11, 7, 0))

    assert len(calls) == 1
    assert calls[0]["timing"] == "same_day"


def test_notify_same_day_respects_minute_of_configured_time(data_dir, monkeypatch):
    """計画レビュー指摘3: 当日通知は分まで見る。5分間隔のループでも設定した分ちょうどで送れる。"""
    from backend import ui_settings

    write_config(data_dir)
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    ui_settings.save_settings(
        {
            ui_settings.SETTING_GARBAGE_NOTIFY_SAME_DAY_ENABLED: True,
            ui_settings.SETTING_GARBAGE_NOTIFY_SAME_DAY_TIME: "07:15",
            ui_settings.SETTING_GARBAGE_NOTIFY_CATEGORY_TIMING: {"burnable": ["same_day"]},
        }
    )
    sent = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: sent.append(kwargs),
    )

    # 7時台でも、設定した分（15分）より前は送らない
    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 11, 7, 0)) == []
    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 11, 7, 10)) == []
    assert sent == []

    # 設定した分ちょうど（5分間隔のループが実際に踏む時刻）で送る
    entries = garbage_notify.run_notify(datetime.datetime(2026, 8, 11, 7, 15))
    assert len(entries) == 1
    assert len(sent) == 1

    # 同じ日はもう送らない
    assert garbage_notify.run_notify(datetime.datetime(2026, 8, 11, 7, 20)) == []
    assert len(sent) == 1


def test_notify_before_group_still_ignores_minutes(data_dir, monkeypatch):
    """前日通知は#293からの既存挙動どおり「時」だけを見る（当日通知とは判定方法が違う）。"""
    from backend import ui_settings

    write_config(data_dir)  # notify_hour = 20
    monkeypatch.setattr(garbage_notify, "STATE_PATH", data_dir / "garbage_notify_state.json")
    ui_settings.save_settings({ui_settings.SETTING_GARBAGE_NOTIFY_TIME: "20:30"})
    sent = []
    monkeypatch.setattr(
        garbage_notify.signaly_notify,
        "send_garbage_notification",
        lambda **kwargs: sent.append(kwargs),
    )

    # 20:00（分は20:30の指定より前）でも「時」が一致していれば送る
    entries = garbage_notify.run_notify(datetime.datetime(2026, 8, 10, 20, 0))
    assert len(entries) == 1
    assert len(sent) == 1
