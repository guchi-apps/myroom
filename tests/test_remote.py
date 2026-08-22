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
        {"id": "light-on", "label": "点ける"},
        {"id": "light-off", "label": "消す"},
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
