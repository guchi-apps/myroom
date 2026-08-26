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


def test_saving_other_settings_keeps_remote_buttons(data_dir):
    ui_settings.save_settings(
        {ui_settings.SETTING_REMOTE_BUTTONS: {"light-on": {"label": "あかり"}}}
    )
    saved = ui_settings.save_settings({ui_settings.SETTING_HIDDEN_DEVICES: ["device:2"]})
    assert saved[ui_settings.SETTING_REMOTE_BUTTONS] == {"light-on": {"label": "あかり"}}
