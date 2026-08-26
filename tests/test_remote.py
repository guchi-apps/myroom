import json

import pytest
import requests

from backend import remote

SAMPLE_CONFIG = {
    "groups": [
        {
            "id": "light",
            "name": "照明",
            "buttons": [
                {"id": "light-on", "label": "点ける", "appliance_id": "app-1", "button": "on"},
                {"id": "light-off", "label": "消す", "appliance_id": "app-1", "button": "off"},
            ],
        },
        {
            "id": "tv",
            "name": "テレビ",
            "buttons": [
                {"label": "電源", "signal_id": "sig-1"},
            ],
        },
    ]
}


def write_config(data_dir, config=None):
    path = data_dir / "remote.json"
    path.write_text(
        json.dumps(config if config is not None else SAMPLE_CONFIG, ensure_ascii=False),
        encoding="utf-8",
    )
    return path


@pytest.fixture
def remote_config(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.remote.CONFIG_PATH", tmp_path / "remote.json")
    return tmp_path


class FakeResponse:
    def __init__(self, status_code=200, text="", payload=None):
        self.status_code = status_code
        self.text = text
        self._payload = payload

    def json(self):
        return self._payload


# ---------------------------------------------------------------- 設定の読み込み


def test_unconfigured_when_file_missing(remote_config):
    payload = remote.build_payload()
    assert payload == {"configured": False, "groups": []}


def test_unconfigured_when_file_is_broken(remote_config):
    (remote_config / "remote.json").write_text("{ではない", encoding="utf-8")
    assert remote.build_payload()["configured"] is False


def test_build_payload_keeps_order_and_hides_signal_ids(remote_config):
    write_config(remote_config)
    payload = remote.build_payload()

    assert payload["configured"] is True
    assert [group["name"] for group in payload["groups"]] == ["照明", "テレビ"]
    assert payload["groups"][0]["buttons"] == [
        {"id": "light-on", "label": "点ける", "default_label": "点ける", "hidden": False},
        {"id": "light-off", "label": "消す", "default_label": "消す", "hidden": False},
    ]
    # signal ID・appliance ID は画面へ出さない
    assert "signal_id" not in payload["groups"][1]["buttons"][0]
    assert "appliance_id" not in payload["groups"][0]["buttons"][0]


def test_button_id_defaults_to_group_and_index(remote_config):
    write_config(remote_config)
    assert remote.build_payload()["groups"][1]["buttons"][0]["id"] == "tv-1"


def test_incomplete_buttons_and_empty_groups_are_dropped(remote_config):
    write_config(
        remote_config,
        {
            "groups": [
                # label はあるが押し方が無い
                {"name": "壊れ", "buttons": [{"label": "押せない"}]},
                # 押し方はあるが label が無い
                {"name": "無名", "buttons": [{"signal_id": "sig-x"}]},
                # 名前が無いグループ
                {"buttons": [{"label": "電源", "signal_id": "sig-y"}]},
                {"name": "照明", "buttons": [{"label": "点ける", "signal_id": "sig-z"}]},
            ]
        },
    )
    payload = remote.build_payload()
    assert [group["name"] for group in payload["groups"]] == ["照明"]


def test_duplicate_button_ids_are_dropped(remote_config):
    write_config(
        remote_config,
        {
            "groups": [
                {
                    "name": "照明",
                    "buttons": [
                        {"id": "same", "label": "点ける", "signal_id": "sig-1"},
                        {"id": "same", "label": "消す", "signal_id": "sig-2"},
                    ],
                }
            ]
        },
    )
    buttons = remote.build_payload()["groups"][0]["buttons"]
    assert [button["label"] for button in buttons] == ["点ける"]
    # 先に書いた方が残る（後勝ちにすると押す先が入れ替わる）
    assert remote.find_button("same")["signal_id"] == "sig-1"


# -------------------------------------------- 画面で付けた名前・隠す指定（#260）


def test_overrides_replace_label_and_keep_default(remote_config):
    write_config(remote_config)
    payload = remote.build_payload({"light-on": {"label": "あかりをつける"}})

    button = payload["groups"][0]["buttons"][0]
    assert button["label"] == "あかりをつける"
    # もとの名前は設定画面で出すので残す
    assert button["default_label"] == "点ける"


def test_hidden_buttons_stay_in_payload_with_flag(remote_config):
    write_config(remote_config)
    payload = remote.build_payload({"light-off": {"hidden": True}})

    buttons = payload["groups"][0]["buttons"]
    # 設定画面が一覧に出すため、隠したボタンも消さない
    assert [button["id"] for button in buttons] == ["light-on", "light-off"]
    assert [button["hidden"] for button in buttons] == [False, True]


def test_blank_label_falls_back_to_remote_json(remote_config):
    write_config(remote_config)
    payload = remote.build_payload({"light-on": {"label": "   "}})
    assert payload["groups"][0]["buttons"][0]["label"] == "点ける"


def test_overrides_for_unknown_buttons_are_ignored(remote_config):
    write_config(remote_config)
    payload = remote.build_payload({"no-such-button": {"label": "幽霊"}})
    labels = [button["label"] for button in payload["groups"][0]["buttons"]]
    assert labels == ["点ける", "消す"]


def test_broken_overrides_do_not_break_payload(remote_config):
    write_config(remote_config)
    # 設定が壊れていてもカードは出す（remote.json だけで成り立つため）
    payload = remote.build_payload({"light-on": "文字列", "light-off": None})
    assert [button["label"] for button in payload["groups"][0]["buttons"]] == [
        "点ける",
        "消す",
    ]


def test_press_reports_the_name_shown_on_screen(remote_config, monkeypatch):
    write_config(remote_config)
    monkeypatch.setenv(remote.ENV_TOKEN, "test-token")
    monkeypatch.setattr(requests, "post", lambda *a, **k: FakeResponse(200))

    result = remote.press("light-on", {"light-on": {"label": "あかりをつける"}})
    assert result["label"] == "あかりをつける"


def test_hidden_button_can_still_be_pressed(remote_config, monkeypatch):
    """隠すのは表示の話。ボタンそのものを消したわけではない。"""
    write_config(remote_config)
    monkeypatch.setenv(remote.ENV_TOKEN, "test-token")
    monkeypatch.setattr(requests, "post", lambda *a, **k: FakeResponse(200))

    result = remote.press("light-on", {"light-on": {"hidden": True}})
    assert result["sent"] is True


# ------------------------------------------------------------------------ 送信


def test_press_sends_light_button(remote_config, monkeypatch):
    write_config(remote_config)
    monkeypatch.setenv(remote.ENV_TOKEN, "test-token")
    calls = []

    def fake_post(url, headers=None, data=None, timeout=None):
        calls.append((url, data))
        return FakeResponse(200)

    monkeypatch.setattr(requests, "post", fake_post)

    result = remote.press("light-on")

    assert result["sent"] is True
    assert result["group_name"] == "照明"
    assert calls == [(f"{remote.API_BASE}/1/appliances/app-1/light", {"button": "on"})]


def test_press_sends_signal(remote_config, monkeypatch):
    write_config(remote_config)
    monkeypatch.setenv(remote.ENV_TOKEN, "test-token")
    calls = []

    def fake_post(url, headers=None, data=None, timeout=None):
        calls.append((url, data))
        return FakeResponse(200)

    monkeypatch.setattr(requests, "post", fake_post)

    remote.press("tv-1")

    assert calls == [(f"{remote.API_BASE}/1/signals/sig-1/send", None)]


def test_press_unknown_button_is_404(remote_config, monkeypatch):
    write_config(remote_config)
    monkeypatch.setenv(remote.ENV_TOKEN, "test-token")

    with pytest.raises(remote.RemoteError) as exc:
        remote.press("does-not-exist")
    assert exc.value.status_code == 404


def test_press_without_token_is_503(remote_config, monkeypatch):
    write_config(remote_config)
    monkeypatch.delenv(remote.ENV_TOKEN, raising=False)

    with pytest.raises(remote.RemoteError) as exc:
        remote.press("tv-1")
    assert exc.value.status_code == 503


@pytest.mark.parametrize(
    "status_code,expected",
    [(401, 502), (404, 502), (429, 429), (500, 502)],
)
def test_press_maps_remo_errors(remote_config, monkeypatch, status_code, expected):
    write_config(remote_config)
    monkeypatch.setenv(remote.ENV_TOKEN, "test-token")
    monkeypatch.setattr(
        requests,
        "post",
        lambda *args, **kwargs: FakeResponse(status_code, text="error"),
    )

    with pytest.raises(remote.RemoteError) as exc:
        remote.press("tv-1")
    assert exc.value.status_code == expected


def test_press_maps_connection_error(remote_config, monkeypatch):
    write_config(remote_config)
    monkeypatch.setenv(remote.ENV_TOKEN, "test-token")

    def boom(*args, **kwargs):
        raise requests.ConnectionError("boom")

    monkeypatch.setattr(requests, "post", boom)

    with pytest.raises(remote.RemoteError) as exc:
        remote.press("tv-1")
    assert exc.value.status_code == 502
    assert "つながりませんでした" in exc.value.message


# -------------------------------------------------------------------- API 経由


def test_buttons_endpoint_requires_auth(client):
    assert client.get("/api/remote/buttons").status_code == 401


def test_send_endpoint_requires_auth(client):
    assert client.post("/api/remote/buttons/tv-1/send").status_code == 401


def test_buttons_endpoint_returns_payload(authed_client, data_dir, monkeypatch):
    monkeypatch.setattr("backend.remote.CONFIG_PATH", data_dir / "remote.json")
    write_config(data_dir)

    response = authed_client.get("/api/remote/buttons")

    assert response.status_code == 200
    assert response.json()["configured"] is True


def test_send_endpoint_returns_detail_on_failure(authed_client, data_dir, monkeypatch):
    monkeypatch.setattr("backend.remote.CONFIG_PATH", data_dir / "remote.json")
    write_config(data_dir)
    monkeypatch.delenv(remote.ENV_TOKEN, raising=False)

    response = authed_client.post("/api/remote/buttons/tv-1/send")

    assert response.status_code == 503
    assert "トークン" in response.json()["detail"]
