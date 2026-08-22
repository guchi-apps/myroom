"""エアコンの操作（#213）。

**実機（AirCloud Home）は叩かない。** モックモードの経路と、送る値を組み立てる純粋な
関数を確かめる。実際の通信の形はスタブしたセッションで見る。
"""

import pytest

from backend import aircon_control, database


@pytest.fixture(autouse=True)
def reset_mock_state():
    database.clear_mock_aircon_overrides()
    aircon_control.reset_client()
    yield
    database.clear_mock_aircon_overrides()
    aircon_control.reset_client()


# --- 送る値の検証 -----------------------------------------------------------


def test_normalize_command_keeps_only_specified_items():
    assert aircon_control.normalize_command({"power": "on"}) == {"power": "ON"}


def test_normalize_command_rejects_empty():
    with pytest.raises(ValueError):
        aircon_control.normalize_command({})


@pytest.mark.parametrize(
    "command",
    [
        {"power": "SLEEP"},
        {"mode": "DRY_COOL"},
        {"fan_speed": "LV9"},
        {"fan_swing": "DIAGONAL"},
    ],
)
def test_normalize_command_rejects_unknown_choices(command):
    with pytest.raises(ValueError):
        aircon_control.normalize_command(command)


def test_normalize_temperature_rounds_to_half_degrees():
    assert aircon_control.normalize_temperature(25.3) == 25.5
    assert aircon_control.normalize_temperature(25.2) == 25.0


def test_validate_target_temperature_range_depends_on_mode():
    assert aircon_control.validate_target_temperature("COOLING", 16) == 16.0
    assert aircon_control.validate_target_temperature("COOLING", 32) == 32.0
    with pytest.raises(ValueError):
        aircon_control.validate_target_temperature("COOLING", 33)

    # 自動運転の iduTemperature は設定温度ではなく室温からのシフト量
    assert aircon_control.validate_target_temperature("AUTO", 1.5) == 1.5
    assert aircon_control.validate_target_temperature("AUTO", -5) == -5.0
    with pytest.raises(ValueError):
        aircon_control.validate_target_temperature("AUTO", 26)


def test_merge_command_resets_temperature_when_switching_to_auto():
    current = {"mode": "COOLING", "target_temperature": 26.0, "power": "ON"}
    merged = aircon_control.merge_command(current, {"mode": "AUTO"})
    assert merged["target_temperature"] == 0.0


def test_merge_command_resets_temperature_when_leaving_auto():
    current = {"mode": "AUTO", "target_temperature": 1.5, "power": "ON"}
    merged = aircon_control.merge_command(current, {"mode": "HEATING"})
    assert merged["target_temperature"] == aircon_control.DEFAULT_TARGET_TEMPERATURE


def test_merge_command_keeps_explicit_temperature_on_mode_switch():
    current = {"mode": "AUTO", "target_temperature": 1.5, "power": "ON"}
    merged = aircon_control.merge_command(
        current, {"mode": "HEATING", "target_temperature": 22.0}
    )
    assert merged["target_temperature"] == 22.0


def test_merge_command_keeps_untouched_items():
    current = {
        "mode": "COOLING",
        "target_temperature": 26.0,
        "power": "ON",
        "fan_speed": "LV2",
    }
    merged = aircon_control.merge_command(current, {"power": "OFF"})
    assert merged["mode"] == "COOLING"
    assert merged["fan_speed"] == "LV2"
    assert merged["power"] == "OFF"


# --- リクエストボディ -------------------------------------------------------


def test_build_command_body_sends_only_the_seven_control_fields():
    """`idu-list` の応答をそのまま送り返すと 400 で弾かれる（#213で実機確認）。"""
    raw = {
        "id": 7,
        "vendorThingId": "abc",
        "power": "OFF",
        "mode": "HEATING",
        "iduTemperature": 22.0,
        "relativeTemperature": 0.0,
        "fanSpeed": "LV1",
        "fanSwing": "OFF",
        "roomTemperature": 19.4,
        "online": True,
        "updatedAt": 1787407908999,
        "_familyId": 3,
    }
    desired = {
        "power": "ON",
        "mode": "COOLING",
        "target_temperature": 26.0,
        "humidity": 50,
        "fan_speed": "AUTO",
        "fan_swing": "VERTICAL",
    }

    body = aircon_control.build_command_body(raw, desired)

    assert set(body) == set(aircon_control.CONTROL_BODY_FIELDS)
    assert body["power"] == "ON"
    assert body["mode"] == "COOLING"
    assert body["iduTemperature"] == 26.0
    assert body["fanSpeed"] == "AUTO"
    assert body["fanSwing"] == "VERTICAL"
    # 数値ではなく文字列。読み取った値（50）を返すと INVALID_HUMIDITY で弾かれる
    assert body["humidity"] == "0"


def test_build_command_body_puts_the_shift_in_relative_temperature_when_auto():
    """自動運転では、画面が動かしているのはシフト量で、入れ先は `relativeTemperature`。

    `iduTemperature` は設定温度そのものなので、機器の値をそのまま返す（#213）。
    """
    raw = {
        "id": 7,
        "mode": "AUTO",
        "iduTemperature": 0.0,
        "relativeTemperature": 0.0,
        "power": "ON",
        "fanSpeed": "AUTO",
        "fanSwing": "VERTICAL",
    }
    desired = {
        "power": "ON",
        "mode": "AUTO",
        "target_temperature": 1.5,
        "humidity": 50,
        "fan_speed": "AUTO",
        "fan_swing": "VERTICAL",
    }

    body = aircon_control.build_command_body(raw, desired)

    assert body["relativeTemperature"] == 1.5
    assert body["iduTemperature"] == 0.0


def test_build_command_body_clears_the_shift_outside_auto():
    raw = {
        "id": 7,
        "mode": "AUTO",
        "iduTemperature": 0.0,
        "relativeTemperature": 1.5,
        "power": "ON",
        "fanSpeed": "AUTO",
        "fanSwing": "VERTICAL",
    }
    desired = {
        "power": "ON",
        "mode": "COOLING",
        "target_temperature": 24.0,
        "humidity": 50,
        "fan_speed": "AUTO",
        "fan_swing": "VERTICAL",
    }

    body = aircon_control.build_command_body(raw, desired)

    assert body["iduTemperature"] == 24.0
    assert body["relativeTemperature"] == 0.0


def test_build_command_body_always_sends_zero_humidity():
    """湿度は操作対象ではない。読み取った値を返すと `INVALID_HUMIDITY` になる（#213）。"""
    raw = {"id": 7, "mode": "COOLING", "iduTemperature": 26.0, "humidity": 50}
    desired = {
        "power": "ON",
        "mode": "COOLING",
        "target_temperature": 26.0,
        "humidity": 50,
        "fan_speed": "AUTO",
        "fan_swing": "VERTICAL",
    }
    assert aircon_control.build_command_body(raw, desired)["humidity"] == "0"

def test_build_state_maps_api_keys_to_app_keys():
    state = aircon_control.build_state(
        {
            "id": 7,
            "name": "リビング",
            "power": "on",
            "mode": "cooling",
            "roomTemperature": "28.4",
            "iduTemperature": "26",
            "humidity": "50",
            "fanSpeed": "lv2",
            "fanSwing": "auto",
            "online": True,
            "model": "RAS-KW4025D",
        }
    )
    assert state["ac_id"] == 7
    assert state["power"] == "ON"
    assert state["mode"] == "COOLING"
    assert state["room_temperature"] == 28.4
    assert state["target_temperature"] == 26.0
    assert state["fan_speed"] == "LV2"


# --- モックモードの経路 -----------------------------------------------------


def test_apply_command_updates_mock_state():
    aircon_control.apply_command(1, {"power": "OFF", "mode": "HEATING"})
    state = aircon_control.get_state(1)
    assert state["power"] == "OFF"
    assert state["mode"] == "HEATING"


def test_mock_state_is_per_unit():
    aircon_control.apply_command(1, {"power": "OFF"})
    assert aircon_control.get_state(2)["power"] == "ON"


# --- API --------------------------------------------------------------------


def test_control_requires_auth(client):
    response = client.post("/api/aircon/units/1/control", json={"power": "OFF"})
    assert response.status_code == 401


def test_state_requires_auth(client):
    response = client.get("/api/aircon/units/1/state")
    assert response.status_code == 401


def test_units_reports_control_enabled(authed_client):
    response = authed_client.get("/api/aircon/units")
    assert response.status_code == 200
    # モックでは資格情報なしでも操作を試せるようにしている
    assert response.json()["control_enabled"] is True


def test_state_returns_current_values(authed_client):
    response = authed_client.get("/api/aircon/units/1/state")
    assert response.status_code == 200
    data = response.json()
    assert data["ac_id"] == 1
    assert data["power"] == "ON"
    assert data["name"]


def test_control_applies_and_returns_new_state(authed_client):
    response = authed_client.post(
        "/api/aircon/units/1/control",
        json={"power": "OFF", "fan_speed": "LV3"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["power"] == "OFF"
    assert data["fan_speed"] == "LV3"

    # 送ったあとの状態が、次に開いたときにも見える
    assert authed_client.get("/api/aircon/units/1/state").json()["power"] == "OFF"


def test_control_reflects_in_latest(authed_client):
    authed_client.post("/api/aircon/units/1/control", json={"mode": "HEATING"})
    latest = authed_client.get("/api/aircon/latest?ac_id=1").json()
    assert latest["mode"] == "HEATING"


def test_control_rejects_out_of_range_temperature(authed_client):
    response = authed_client.post(
        "/api/aircon/units/1/control", json={"target_temperature": 40}
    )
    assert response.status_code == 422


def test_control_rejects_empty_command(authed_client):
    response = authed_client.post("/api/aircon/units/1/control", json={})
    assert response.status_code == 422


def test_control_rejects_invalid_ac_id(authed_client):
    response = authed_client.post(
        "/api/aircon/units/0/control", json={"power": "OFF"}
    )
    assert response.status_code == 400


# --- 実機モードのエラー -----------------------------------------------------


class _StubResponse:
    def __init__(self, status_code, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}
        self.content = b"{}" if payload is not None else b""

    def json(self):
        return self._payload


def _client_with_responses(responses):
    client = aircon_control.AirCloudControlClient("a@example.com", "pw")
    client._access_token = "token"
    client._access_token_expires_at = None

    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return responses.pop(0)

    client._session.request = request  # type: ignore[method-assign]
    return client, calls


def test_rate_limit_is_reported_with_retry_after():
    client, _ = _client_with_responses(
        [_StubResponse(429, headers={"Retry-After": "120"})]
    )
    with pytest.raises(aircon_control.AirconControlRateLimited) as exc:
        client.get_state(1)
    assert exc.value.retry_after_sec == 120


def test_unknown_unit_is_reported(monkeypatch):
    client, _ = _client_with_responses(
        [
            _StubResponse(200, {"result": [{"familyId": 3}]}),
            _StubResponse(200, [{"id": 9, "vendorThingId": "x"}]),
        ]
    )
    with pytest.raises(aircon_control.AirconUnitNotFound):
        client.get_state(1)


def test_send_command_sends_merged_state():
    client, calls = _client_with_responses(
        [
            _StubResponse(200, {"result": [{"familyId": 3}]}),
            _StubResponse(
                200,
                [
                    {
                        "id": 1,
                        "vendorThingId": "x",
                        "power": "OFF",
                        "mode": "COOLING",
                        "iduTemperature": 26.0,
                        "fanSpeed": "AUTO",
                        "fanSwing": "AUTO",
                    }
                ],
            ),
            _StubResponse(200, {}),
        ]
    )

    state = client.send_command(1, {"power": "ON"})

    assert state["power"] == "ON"
    method, url, kwargs = calls[-1]
    # POST は 405、`-status` の無いパスは 400 になる（#213で実機確認）
    assert method == aircon_control.CONTROL_METHOD == "put"
    assert url.endswith("/general-control-command-status/1")
    # クエリは familyId。vendorThingId / timeZone では通らない
    assert kwargs["params"] == {"familyId": 3}
    assert kwargs["json"]["power"] == "ON"
    # 指定していない項目は現在値のまま送る
    assert kwargs["json"]["mode"] == "COOLING"
    assert kwargs["json"]["iduTemperature"] == 26.0


def test_not_configured_is_reported(monkeypatch):
    monkeypatch.delenv("AIRCON_EMAIL", raising=False)
    monkeypatch.delenv("AIRCON_PASSWORD", raising=False)
    monkeypatch.setattr(aircon_control.database, "DB_MOCK", False)
    with pytest.raises(aircon_control.AirconControlNotConfigured):
        aircon_control.get_state(1)


def test_is_configured_follows_credentials(monkeypatch):
    monkeypatch.setattr(aircon_control.database, "DB_MOCK", False)
    monkeypatch.delenv("AIRCON_EMAIL", raising=False)
    assert aircon_control.is_configured() is False
    monkeypatch.setenv("AIRCON_EMAIL", "a@example.com")
    monkeypatch.setenv("AIRCON_PASSWORD", "pw")
    assert aircon_control.is_configured() is True
