import json

import pytest
import requests

from backend import remote, ui_settings

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
    # 定義の正は DB（DB_MOCK では data/ui_settings.json）へ移った（#262）。
    # 実行した機体の設定ファイルを読み書きしないよう、こちらも tmp_path へ寄せる
    monkeypatch.setattr("backend.ui_settings.CONFIG_PATH", tmp_path / "ui_settings.json")
    return tmp_path


def save_defs(config):
    """画面から保存したのと同じ状態にする（DB_MOCK ではファイルに落ちる）。"""
    ui_settings.save_settings({ui_settings.SETTING_REMOTE_BUTTON_DEFS: config})


def save_catalog(devices, fetched_at="2026-08-26T11:14:00Z"):
    ui_settings.save_settings(
        {ui_settings.SETTING_REMOTE_CATALOG: {"fetched_at": fetched_at, "devices": devices}}
    )


SAMPLE_APPLIANCES = [
    {
        "id": "app-light",
        "nickname": "リビングの照明",
        "type": "LIGHT",
        "signals": [],
        "light": {"buttons": [{"name": "on", "label": "点ける"}, {"name": "off", "label": "消す"}]},
    },
    {
        "id": "app-tv",
        "nickname": "テレビ",
        "type": "TV",
        "signals": [{"id": "sig-power", "name": "電源"}],
    },
    {"id": "app-ac", "nickname": "エアコン", "type": "AC", "signals": []},
]


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


def test_override_is_dropped_when_the_button_at_that_id_changed(remote_config):
    """ボタンを挿すとIDがずれるので、控えた元の名前と食い違う設定は捨てる。

    `id` を省いたボタンは並び順から採番される（tv-1・tv-2 …）。あとから先頭に
    1つ挿すと、それまで tv-1 だったボタンが tv-2 になり、tv-1 の設定が黙って
    別のボタンに付いてしまう。
    """
    write_config(remote_config)
    overrides = {"tv-1": {"label": "テレビ", "default_label": "電源"}}
    assert remote.build_payload(overrides)["groups"][1]["buttons"][0]["label"] == "テレビ"

    # 「電源」の前に「入力切替」を挿す。tv-1 は別のボタンになる
    shifted = dict(SAMPLE_CONFIG)
    shifted["groups"] = [
        SAMPLE_CONFIG["groups"][0],
        {
            "id": "tv",
            "name": "テレビ",
            "buttons": [
                {"label": "入力切替", "signal_id": "sig-0"},
                {"label": "電源", "signal_id": "sig-1"},
            ],
        },
    ]
    write_config(remote_config, shifted)

    labels = [
        button["label"] for button in remote.build_payload(overrides)["groups"][1]["buttons"]
    ]
    # ずれた設定は当たらない。remote.json の名前がそのまま出る
    assert labels == ["入力切替", "電源"]


def test_override_without_default_label_still_applies(remote_config):
    """`default_label` を持たない古い設定は、そのまま当てる（判断材料が無いため）。"""
    write_config(remote_config)
    payload = remote.build_payload({"light-on": {"label": "あかりをつける"}})
    assert payload["groups"][0]["buttons"][0]["label"] == "あかりをつける"


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


# --------------------------------------- 画面からの登録（#262）


def test_db_definitions_win_over_remote_json(remote_config):
    write_config(remote_config)
    save_defs({"groups": [{"id": "fan", "name": "扇風機", "buttons": [
        {"id": "fan-power", "label": "電源", "signal_id": "sig-fan"}
    ]}]})

    payload = remote.build_payload()
    assert [group["name"] for group in payload["groups"]] == ["扇風機"]


def test_remote_json_is_only_the_initial_value(remote_config):
    """まだ一度も保存していないあいだだけ remote.json を読む。"""
    write_config(remote_config)
    assert [group["name"] for group in remote.build_payload()["groups"]] == ["照明", "テレビ"]


def test_saving_an_empty_config_does_not_fall_back_to_the_file(remote_config):
    """全部消した状態と、まだ保存していない状態は別物。

    ここで remote.json へ戻すと、画面から消したボタンがデプロイのたびに復活する。
    """
    write_config(remote_config)
    save_defs({"groups": []})
    assert remote.build_payload() == {"configured": False, "groups": []}


def test_build_catalog_devices_splits_light_and_signal():
    devices = remote.build_catalog_devices(SAMPLE_APPLIANCES)

    assert [device["name"] for device in devices] == ["リビングの照明", "テレビ", "エアコン"]
    assert [button["label"] for button in devices[0]["buttons"]] == ["点ける", "消す"]
    assert devices[0]["buttons"][0]["appliance_id"] == "app-light"
    assert devices[0]["buttons"][0]["button"] == "on"
    assert devices[1]["buttons"][0]["signal_id"] == "sig-power"


def test_build_catalog_devices_keeps_unsupported_devices_with_a_reason():
    """押せない機器も落とさない。消えていると取得漏れと区別が付かない。"""
    devices = remote.build_catalog_devices(SAMPLE_APPLIANCES)
    aircon = devices[2]
    assert aircon["buttons"] == []
    assert "エアコン" in aircon["note"]


def test_catalog_button_ids_are_stable_across_fetches():
    """外して付け直しても同じIDに戻る（付けた名前が引き継がれる）。"""
    first = remote.build_catalog_devices(SAMPLE_APPLIANCES)
    second = remote.build_catalog_devices(SAMPLE_APPLIANCES)
    assert [b["id"] for b in first[0]["buttons"]] == [b["id"] for b in second[0]["buttons"]]

    # 並び順から採番していないので、前にボタンを挿してもIDは動かない
    shifted = [
        {
            **SAMPLE_APPLIANCES[0],
            "light": {
                "buttons": [{"name": "night", "label": "常夜灯"}]
                + SAMPLE_APPLIANCES[0]["light"]["buttons"]
            },
        }
    ]
    assert (
        remote.build_catalog_devices(shifted)[0]["buttons"][1]["id"]
        == first[0]["buttons"][0]["id"]
    )


def test_catalog_payload_drops_remo_ids():
    catalog = {
        "fetched_at": "2026-08-26T11:14:00Z",
        "devices": remote.build_catalog_devices(SAMPLE_APPLIANCES),
    }
    payload = remote.catalog_payload(catalog)

    serialized = json.dumps(payload, ensure_ascii=False)
    assert "app-light" not in serialized
    assert "sig-power" not in serialized
    assert payload["devices"][0]["buttons"][0]["label"] == "点ける"
    assert payload["devices"][0]["buttons"][0]["kind"] == "light"


def test_resolve_config_fills_send_targets_from_the_catalog(remote_config):
    devices = remote.build_catalog_devices(SAMPLE_APPLIANCES)
    save_catalog(devices)
    on_id = devices[0]["buttons"][0]["id"]
    power_id = devices[1]["buttons"][0]["id"]

    config = remote.resolve_config(
        {"groups": [{"id": "g1", "name": "照明", "buttons": [{"id": on_id}, {"id": power_id}]}]}
    )

    buttons = config["groups"][0]["buttons"]
    assert [button["label"] for button in buttons] == ["点ける", "電源"]
    assert buttons[0]["appliance_id"] == "app-light"
    assert buttons[1]["signal_id"] == "sig-power"


def test_resolve_config_drops_unknown_button_ids(remote_config):
    save_catalog(remote.build_catalog_devices(SAMPLE_APPLIANCES))
    config = remote.resolve_config(
        {"groups": [{"name": "照明", "buttons": [{"id": "知らないID"}]}]}
    )
    # 押し方の分からないボタンは作らない。1つも残らないグループごと消える
    assert config == {"groups": []}


def test_resolve_config_keeps_already_registered_buttons_without_the_catalog(remote_config):
    """控えが空でも、登録済みのボタンは並べ替えて保存し直せる。"""
    write_config(remote_config)
    config = remote.resolve_config(
        {"groups": [{"id": "tv", "name": "テレビ", "buttons": [{"id": "tv-1"}]}]}
    )
    assert config["groups"][0]["buttons"][0]["signal_id"] == "sig-1"


def test_resolve_config_reorders_and_regroups(remote_config):
    write_config(remote_config)
    config = remote.resolve_config(
        {
            "groups": [
                {"id": "tv", "name": "テレビ", "buttons": [{"id": "tv-1"}]},
                {
                    "id": "light",
                    "name": "あかり",
                    "buttons": [{"id": "light-off"}, {"id": "light-on"}],
                },
            ]
        }
    )
    assert [group["name"] for group in config["groups"]] == ["テレビ", "あかり"]
    assert [b["id"] for b in config["groups"][1]["buttons"]] == ["light-off", "light-on"]


def test_prune_overrides_drops_settings_for_removed_buttons(remote_config):
    write_config(remote_config)
    config = remote.load_config()
    pruned = remote.prune_overrides(
        {"light-on": {"label": "あかり"}, "消したボタン": {"label": "ゴミ"}}, config
    )
    assert pruned == {"light-on": {"label": "あかり"}}


def test_load_catalog_is_empty_before_the_first_fetch(remote_config):
    assert remote.load_catalog() == {"fetched_at": "", "devices": []}


def test_fetch_catalog_calls_nature_remo_once(remote_config, monkeypatch):
    monkeypatch.setenv(remote.ENV_TOKEN, "test-token")
    calls = []

    def fake_get(url, headers=None, timeout=None):
        calls.append(url)
        return FakeResponse(200, payload=SAMPLE_APPLIANCES)

    monkeypatch.setattr(requests, "get", fake_get)

    catalog = remote.fetch_catalog()

    assert calls == [f"{remote.API_BASE}/1/appliances"]
    assert catalog["fetched_at"].endswith("Z")
    assert len(catalog["devices"]) == 3


# ---------------------------------------------------- 登録のAPI（#262）


def test_catalog_endpoints_require_auth(client):
    assert client.get("/api/remote/catalog").status_code == 401
    assert client.post("/api/remote/catalog/refresh").status_code == 401
    assert client.put("/api/remote/config", json={"groups": []}).status_code == 401


def test_catalog_endpoint_does_not_call_nature_remo(authed_client, data_dir, monkeypatch):
    monkeypatch.setattr("backend.remote.CONFIG_PATH", data_dir / "remote.json")

    def boom(*args, **kwargs):
        raise AssertionError("一覧を出すだけで Nature Remo を叩いてはいけない")

    monkeypatch.setattr(requests, "get", boom)

    response = authed_client.get("/api/remote/catalog")
    assert response.status_code == 200
    assert response.json() == {"fetched_at": "", "devices": []}


def test_refresh_then_save_registers_buttons(authed_client, data_dir, monkeypatch):
    monkeypatch.setattr("backend.remote.CONFIG_PATH", data_dir / "remote.json")
    monkeypatch.setenv(remote.ENV_TOKEN, "test-token")
    monkeypatch.setattr(
        requests, "get", lambda *a, **k: FakeResponse(200, payload=SAMPLE_APPLIANCES)
    )

    catalog = authed_client.post("/api/remote/catalog/refresh").json()
    on_id = catalog["devices"][0]["buttons"][0]["id"]

    saved = authed_client.put(
        "/api/remote/config",
        json={
            "groups": [{"id": "light", "name": "照明", "buttons": [{"id": on_id}]}],
            "buttons": {on_id: {"label": "つける", "default_label": "点ける"}},
        },
    )

    assert saved.status_code == 200
    body = saved.json()
    assert body["configured"] is True
    assert body["groups"][0]["buttons"][0]["label"] == "つける"
    assert body["groups"][0]["buttons"][0]["default_label"] == "点ける"
    # 送り先は画面へ返さない
    assert "appliance_id" not in body["groups"][0]["buttons"][0]

    # 保存した内容は次の取得にも残る
    assert authed_client.get("/api/remote/buttons").json()["groups"][0]["name"] == "照明"


def test_refresh_reports_missing_token(authed_client, data_dir, monkeypatch):
    monkeypatch.setattr("backend.remote.CONFIG_PATH", data_dir / "remote.json")
    monkeypatch.delenv(remote.ENV_TOKEN, raising=False)

    response = authed_client.post("/api/remote/catalog/refresh")
    assert response.status_code == 503
    assert "トークン" in response.json()["detail"]
