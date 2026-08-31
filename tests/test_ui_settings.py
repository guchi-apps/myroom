from backend import ui_settings


def test_ui_settings_save_and_load(data_dir):
    saved = ui_settings.save_settings(
        {
            ui_settings.SETTING_DISPLAY_ORDER: ["device:2", "device:1", "outdoor", "aircon"],
            ui_settings.SETTING_HIDDEN_DEVICES: ["device:2"],
            ui_settings.SETTING_CHART_COLORS: {"device:1": "#3498db"},
        }
    )
    assert saved["display_order"][0] == "device:2"
    assert "device:2" in saved["hidden_devices"]

    loaded = ui_settings.get_settings()
    assert loaded["display_order"][0] == "device:2"
    assert loaded["chart_colors"]["device:1"] == "#3498db"


def test_remote_buttons_default_is_empty(data_dir):
    assert ui_settings.get_settings()[ui_settings.SETTING_REMOTE_BUTTONS] == {}


def test_remote_buttons_save_and_load(data_dir):
    saved = ui_settings.save_settings(
        {
            ui_settings.SETTING_REMOTE_BUTTONS: {
                "light-on": {"label": "あかりをつける"},
                "tv-vol-up": {"hidden": True},
            }
        }
    )
    assert saved[ui_settings.SETTING_REMOTE_BUTTONS] == {
        "light-on": {"label": "あかりをつける"},
        "tv-vol-up": {"hidden": True},
    }
    assert ui_settings.get_settings()[ui_settings.SETTING_REMOTE_BUTTONS][
        "light-on"
    ] == {"label": "あかりをつける"}


def test_remote_buttons_drop_entries_that_match_the_default(data_dir):
    """名前が空でダッシュボードにも出すなら remote.json のままなので持たない。"""
    saved = ui_settings.save_settings(
        {
            ui_settings.SETTING_REMOTE_BUTTONS: {
                "light-on": {"label": "  ", "hidden": False},
                "light-off": {},
            }
        }
    )
    assert saved[ui_settings.SETTING_REMOTE_BUTTONS] == {}


def test_remote_buttons_reject_broken_entries(data_dir):
    saved = ui_settings.save_settings(
        {
            ui_settings.SETTING_REMOTE_BUTTONS: {
                "": {"label": "IDが空"},
                "ok": {"label": "残る"},
                "broken": "辞書ではない",
            }
        }
    )
    assert saved[ui_settings.SETTING_REMOTE_BUTTONS] == {"ok": {"label": "残る"}}


def test_remote_buttons_label_is_trimmed_to_the_max_length(data_dir):
    saved = ui_settings.save_settings(
        {ui_settings.SETTING_REMOTE_BUTTONS: {"light-on": {"label": "あ" * 40}}}
    )
    label = saved[ui_settings.SETTING_REMOTE_BUTTONS]["light-on"]["label"]
    assert len(label) == ui_settings.MAX_REMOTE_LABEL_LENGTH


def test_remote_buttons_keep_the_default_label_that_was_saved(data_dir):
    """IDのずれを見つける手掛かりなので、保存時の元の名前も残す。"""
    saved = ui_settings.save_settings(
        {
            ui_settings.SETTING_REMOTE_BUTTONS: {
                "light-on": {"label": "あかりをつける", "default_label": "点ける"}
            }
        }
    )
    assert saved[ui_settings.SETTING_REMOTE_BUTTONS]["light-on"] == {
        "label": "あかりをつける",
        "default_label": "点ける",
    }


def test_remote_buttons_default_label_alone_is_not_kept(data_dir):
    """名前も付けず表示もしているなら、控えだけ残しても意味が無い。"""
    saved = ui_settings.save_settings(
        {ui_settings.SETTING_REMOTE_BUTTONS: {"light-on": {"default_label": "点ける"}}}
    )
    assert saved[ui_settings.SETTING_REMOTE_BUTTONS] == {}


def test_saving_other_settings_keeps_remote_buttons(data_dir):
    ui_settings.save_settings(
        {ui_settings.SETTING_REMOTE_BUTTONS: {"light-on": {"label": "あかり"}}}
    )
    saved = ui_settings.save_settings({ui_settings.SETTING_HIDDEN_DEVICES: ["device:2"]})
    assert saved[ui_settings.SETTING_REMOTE_BUTTONS] == {"light-on": {"label": "あかり"}}


def test_life_card_order_default_is_empty(data_dir):
    """まだ並べ替えていない状態。既定の並びはフロント側の LIFE_CARDS が持つ（#283）"""
    assert ui_settings.get_settings()[ui_settings.SETTING_LIFE_CARD_ORDER] == []


def test_life_card_order_save_and_load(data_dir):
    saved = ui_settings.save_settings(
        {ui_settings.SETTING_LIFE_CARD_ORDER: ["cleaning", "garbage", "remote"]}
    )
    assert saved[ui_settings.SETTING_LIFE_CARD_ORDER] == ["cleaning", "garbage", "remote"]
    assert ui_settings.get_settings()[ui_settings.SETTING_LIFE_CARD_ORDER] == [
        "cleaning",
        "garbage",
        "remote",
    ]


def test_life_card_order_drops_duplicates_and_broken_entries(data_dir):
    saved = ui_settings.save_settings(
        {ui_settings.SETTING_LIFE_CARD_ORDER: ["garbage", " garbage ", "", 3, None, "remote"]}
    )
    assert saved[ui_settings.SETTING_LIFE_CARD_ORDER] == ["garbage", "remote"]


def test_saving_other_settings_keeps_life_card_order(data_dir):
    """save_settings の merged に並べたキーだけが引き継がれるため、別の設定の保存で確かめる"""
    ui_settings.save_settings(
        {ui_settings.SETTING_LIFE_CARD_ORDER: ["cleaning", "remote"]}
    )
    saved = ui_settings.save_settings({ui_settings.SETTING_HIDDEN_DEVICES: ["device:2"]})
    assert saved[ui_settings.SETTING_LIFE_CARD_ORDER] == ["cleaning", "remote"]

    loaded = ui_settings.get_settings()
    assert loaded[ui_settings.SETTING_LIFE_CARD_ORDER] == ["cleaning", "remote"]


# --- 通知設定（#293） -----------------------------------------------------------


def test_notification_settings_defaults(data_dir):
    settings = ui_settings.get_settings()
    assert settings[ui_settings.SETTING_GARBAGE_NOTIFY_ENABLED] is True
    assert settings[ui_settings.SETTING_GARBAGE_NOTIFY_TIME] is None
    assert settings[ui_settings.SETTING_ROOM_ANOMALY_NOTIFY_ENABLED] is False
    assert settings[ui_settings.SETTING_ROOM_ANOMALY_THRESHOLDS] == {
        "temperature": {"min": 16.0, "max": 30.0},
        "humidity": {"min": 30.0, "max": 70.0},
    }
    assert settings[ui_settings.SETTING_ROOM_ANOMALY_REMINDER_MINUTES] == 60


def test_garbage_notify_time_is_normalized(data_dir):
    saved = ui_settings.save_settings({ui_settings.SETTING_GARBAGE_NOTIFY_TIME: "9:5"})
    assert saved[ui_settings.SETTING_GARBAGE_NOTIFY_TIME] == "09:05"

    saved = ui_settings.save_settings({ui_settings.SETTING_GARBAGE_NOTIFY_TIME: "not-a-time"})
    assert saved[ui_settings.SETTING_GARBAGE_NOTIFY_TIME] is None


def test_room_anomaly_thresholds_reject_min_greater_than_max(data_dir):
    saved = ui_settings.save_settings(
        {
            ui_settings.SETTING_ROOM_ANOMALY_THRESHOLDS: {
                "temperature": {"min": 30.0, "max": 16.0},
                "humidity": {"min": 40.0, "max": 60.0},
            }
        }
    )
    # 不正な指標だけ既定へ戻し、他方は保存された値を保つ
    assert saved[ui_settings.SETTING_ROOM_ANOMALY_THRESHOLDS]["temperature"] == {
        "min": 16.0,
        "max": 30.0,
    }
    assert saved[ui_settings.SETTING_ROOM_ANOMALY_THRESHOLDS]["humidity"] == {
        "min": 40.0,
        "max": 60.0,
    }


def test_room_anomaly_reminder_minutes_is_clamped(data_dir):
    saved = ui_settings.save_settings({ui_settings.SETTING_ROOM_ANOMALY_REMINDER_MINUTES: 0})
    assert saved[ui_settings.SETTING_ROOM_ANOMALY_REMINDER_MINUTES] == (
        ui_settings.MIN_ROOM_ANOMALY_REMINDER_MINUTES
    )

    saved = ui_settings.save_settings(
        {ui_settings.SETTING_ROOM_ANOMALY_REMINDER_MINUTES: 999999}
    )
    assert saved[ui_settings.SETTING_ROOM_ANOMALY_REMINDER_MINUTES] == (
        ui_settings.MAX_ROOM_ANOMALY_REMINDER_MINUTES
    )


def test_saving_other_settings_keeps_notification_settings(data_dir):
    """save_settings の merged に並べたキーだけが引き継がれるため、別の設定の保存で確かめる（#258と同種の抜け対策）"""
    ui_settings.save_settings(
        {
            ui_settings.SETTING_GARBAGE_NOTIFY_ENABLED: False,
            ui_settings.SETTING_GARBAGE_NOTIFY_TIME: "07:30",
            ui_settings.SETTING_ROOM_ANOMALY_NOTIFY_ENABLED: True,
            ui_settings.SETTING_ROOM_ANOMALY_REMINDER_MINUTES: 30,
        }
    )
    saved = ui_settings.save_settings({ui_settings.SETTING_HIDDEN_DEVICES: ["device:2"]})
    assert saved[ui_settings.SETTING_GARBAGE_NOTIFY_ENABLED] is False
    assert saved[ui_settings.SETTING_GARBAGE_NOTIFY_TIME] == "07:30"
    assert saved[ui_settings.SETTING_ROOM_ANOMALY_NOTIFY_ENABLED] is True
    assert saved[ui_settings.SETTING_ROOM_ANOMALY_REMINDER_MINUTES] == 30

    loaded = ui_settings.get_settings()
    assert loaded[ui_settings.SETTING_GARBAGE_NOTIFY_ENABLED] is False
    assert loaded[ui_settings.SETTING_GARBAGE_NOTIFY_TIME] == "07:30"
