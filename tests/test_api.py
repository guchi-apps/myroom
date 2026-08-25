def test_health_get(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db_mock": True}


def test_health_head(client):
    response = client.head("/api/health")
    assert response.status_code == 200


def test_latest_requires_auth(client):
    response = client.get("/api/latest?device=1")
    assert response.status_code == 401


def test_latest_returns_mock_data(authed_client):
    response = authed_client.get("/api/latest?device=1")
    assert response.status_code == 200
    data = response.json()
    assert data["device_id"] == 1
    assert isinstance(data["temperature"], float)
    assert isinstance(data["illuminance"], float)
    assert data["outdoor_temperature"] == 25.0


def test_latest_rejects_invalid_device(authed_client):
    response = authed_client.get("/api/latest?device=0")
    assert response.status_code == 400


def test_sensor_accepts_co2_only(client):
    response = client.post(
        "/api/sensor?device=2",
        json={"datetime": "2026-05-30 12:00:00", "co2": 400},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "mock_ok"


def test_sensor_accepts_illuminance_only(client):
    response = client.post(
        "/api/sensor?device=1",
        json={"datetime": "2026-05-31 12:00:00", "illuminance": 123.4},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "mock_ok"


def test_sensor_accepts_temperature_dht11(client):
    response = client.post(
        "/api/sensor?device=1",
        json={
            "datetime": "2026-05-31 12:00:00",
            "temperature": 25.3,
            "temperature_dht11": 25.0,
            "humidity": 60,
            "pressure": 1013,
            "illuminance": 123.4,
        },
    )
    assert response.status_code == 200
    received = response.json()["received"]
    assert received["temperature_dht11"] == 25.0
    assert received["temperature"] == 25.3


def test_sensor_rejects_empty_payload(client):
    response = client.post(
        "/api/sensor?device=1",
        json={"datetime": "2026-05-30 12:00:00"},
    )
    assert response.status_code == 422


def test_outdoor_history_day_returns_open_meteo_records(authed_client):
    response = authed_client.get("/api/outdoor-history?range=day")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert data[0]["outdoor_temperature"] == 22.0
    assert data[0]["outdoor_humidity"] == 55.0
    assert data[0]["outdoor_pressure"] == 1013


def test_history_day_returns_records(authed_client):
    response = authed_client.get("/api/history?range=day&device=1")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "temperature" in data[0]


def test_history_year_returns_daily_aggregation(authed_client):
    response = authed_client.get("/api/history?range=year&device=1")
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    sample = data[0]
    assert "temperature_min" in sample
    assert "temperature_max" in sample


def test_aircon_history_day_returns_records(authed_client):
    response = authed_client.get("/api/aircon/history?range=day&ac_id=1")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "temperature" in data[0]
    assert "target_temperature" in data[0]


def test_aircon_history_year_returns_daily_aggregation(authed_client):
    response = authed_client.get("/api/aircon/history?range=year&ac_id=1")
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    sample = data[0]
    assert "temperature_min" in sample
    assert "temperature_max" in sample
    assert any("target_temperature" in row for row in data)


def test_aircon_history_year_excludes_auto_shift_from_target_average(authed_client):
    """自動運転の設定温度は室温からのシフト量なので、年グラフの平均から外す。"""
    response = authed_client.get("/api/aircon/history?range=year&ac_id=1")
    assert response.status_code == 200
    data = response.json()
    targets = [row["target_temperature"] for row in data if "target_temperature" in row]
    assert targets
    # モックの固定設定温度は 24.0〜27.0。シフト量（1.0）が平均に混ざると 24.0 を割る
    assert all(24.0 <= target <= 27.0 for target in targets)


def test_is_aircon_auto_target_splits_shift_from_fixed_temperature():
    from backend.main import _is_aircon_auto_target

    assert _is_aircon_auto_target(0) is True
    assert _is_aircon_auto_target(1.0) is True
    assert _is_aircon_auto_target(-3.0) is True
    assert _is_aircon_auto_target(16.0) is False
    assert _is_aircon_auto_target(26.0) is False
    assert _is_aircon_auto_target(None) is False


def test_daily_stats_returns_list(authed_client):
    response = authed_client.get("/api/daily-stats?device=1")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "temp_max" in data[0]


def test_devices_list(authed_client):
    response = authed_client.get("/api/devices")
    assert response.status_code == 200
    devices = response.json()["devices"]
    assert any(device["id"] == 1 for device in devices)


def test_update_device_name(authed_client):
    response = authed_client.put(
        "/api/devices/1",
        json={"name": "テスト部屋"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "テスト部屋"

    listed = authed_client.get("/api/devices").json()["devices"]
    assert next(item for item in listed if item["id"] == 1)["name"] == "テスト部屋"


def test_update_device_inherits_from(authed_client):
    response = authed_client.put(
        "/api/devices/2",
        json={"name": "新リビング", "inherits_from": 1},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "新リビング"
    assert data["inherits_from"] == 1

    listed = authed_client.get("/api/devices").json()["devices"]
    device2 = next(item for item in listed if item["id"] == 2)
    assert device2["inherits_from"] == 1


def test_update_device_rejects_self_inheritance(authed_client):
    response = authed_client.put(
        "/api/devices/1",
        json={"name": "リビング", "inherits_from": 1},
    )
    assert response.status_code == 400


def test_update_device_name_rejects_empty(authed_client):
    response = authed_client.put(
        "/api/devices/1",
        json={"name": "   "},
    )
    assert response.status_code == 400


def test_outdoor_location_get(authed_client):
    response = authed_client.get("/api/outdoor-location")
    assert response.status_code == 200
    data = response.json()
    assert "latitude" in data
    assert "longitude" in data
    assert "name" in data


def test_outdoor_location_update(authed_client):
    response = authed_client.put(
        "/api/outdoor-location",
        json={"latitude": 35.0, "longitude": 135.5, "name": "大阪"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "大阪"


def test_outdoor_location_rejects_invalid_latitude(authed_client):
    response = authed_client.put(
        "/api/outdoor-location",
        json={"latitude": 999, "longitude": 135.5, "name": "bad"},
    )
    assert response.status_code == 400


def test_outdoor_location_search(authed_client):
    response = authed_client.get("/api/outdoor-location/search?q=大阪")
    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) == 1
    assert results[0]["name"] == "大阪"


def test_aircon_latest_returns_mock_data(authed_client):
    response = authed_client.get("/api/aircon/latest")
    assert response.status_code == 200
    data = response.json()
    assert data["room_temperature"] is not None
    assert data["target_temperature"] is not None
    assert data["mode"] == "COOLING"


def test_aircon_post_accepts_status(client):
    response = client.post(
        "/api/aircon",
        json={
            "datetime": "2026-05-30 12:00:00",
            "ac_id": 1,
            "name": "リビング",
            "room_temperature": 24.5,
            "target_temperature": 26.0,
            "mode": "COOLING",
            "power": "ON",
            "online": True,
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "mock_ok"


def test_aircon_units_list(authed_client):
    response = authed_client.get("/api/aircon/units")
    assert response.status_code == 200
    units = response.json()["units"]
    assert any(unit["ac_id"] == 1 for unit in units)


def test_update_aircon_unit_name(authed_client):
    response = authed_client.put(
        "/api/aircon/units/1",
        json={"name": "寝室エアコン"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "寝室エアコン"

    latest = authed_client.get("/api/aircon/latest").json()
    assert latest["name"] == "寝室エアコン"


def test_update_aircon_unit_name_rejects_empty(authed_client):
    response = authed_client.put(
        "/api/aircon/units/1",
        json={"name": "   "},
    )
    assert response.status_code == 400


def test_records_list_returns_mock_data(authed_client):
    response = authed_client.get("/api/records?device=1")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data["records"], list)
    assert len(data["records"]) > 0
    assert data["records"][0]["device_id"] == 1
    assert "datetime" in data["records"][0]


def test_records_delete_mock_ok(authed_client):
    response = authed_client.delete(
        "/api/records",
        params={"device": 1, "datetime": "2026-05-30 12:00:00"},
    )
    assert response.status_code == 200
    assert response.json()["deleted"] is True


def test_records_bulk_delete_mock_ok(authed_client):
    response = authed_client.post(
        "/api/records/bulk-delete",
        json={
            "device": 1,
            "datetimes": ["2026-05-30 12:00:00", "2026-05-30 11:00:00"],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["deleted_count"] == 2


def test_records_bulk_delete_rejects_empty(authed_client):
    response = authed_client.post(
        "/api/records/bulk-delete",
        json={"device": 1, "datetimes": []},
    )
    assert response.status_code == 400


def test_records_rejects_invalid_device(authed_client):
    response = authed_client.get("/api/records?device=0")
    assert response.status_code == 400


def test_aircon_daily_stats_returns_mock_data(authed_client):
    response = authed_client.get("/api/aircon/daily-stats?ac_id=1")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "temp_min" in data[0]
    assert "temp_max" in data[0]
    assert "humid_min" not in data[0]


def test_ui_settings_get_and_update(authed_client):
    response = authed_client.get("/api/ui-settings")
    assert response.status_code == 200
    data = response.json()
    assert "display_order" in data
    assert "chart_colors" in data
    assert "hidden_devices" in data

    updated = authed_client.put(
        "/api/ui-settings",
        json={
            "display_order": ["device:2", "device:1", "outdoor", "aircon"],
            "hidden_devices": ["device:2"],
            "chart_colors": {"device:1": "#3498db", "device:2": "#e67e22"},
        },
    )
    assert updated.status_code == 200
    saved = updated.json()
    assert saved["display_order"][0] == "device:2"
    assert "device:2" in saved["hidden_devices"]

    fetched = authed_client.get("/api/ui-settings").json()
    assert fetched["display_order"][0] == "device:2"
    assert "device:2" in fetched["hidden_devices"]


# --- サーバー間参照用の内部API（AIDE 連携 / #161） ---


def test_internal_room_state_requires_configured_key(client, no_internal_api_key):
    """INTERNAL_API_KEY が未設定なら 503。401（値が違う）と切り分けられること。"""
    response = client.get(
        "/api/internal/room-state",
        headers={"Authorization": "Bearer anything"},
    )
    assert response.status_code == 503


def test_internal_room_state_rejects_missing_token(client, internal_api_key):
    response = client.get("/api/internal/room-state")
    assert response.status_code == 401


def test_internal_room_state_rejects_wrong_token(client, internal_api_key):
    response = client.get(
        "/api/internal/room-state",
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert response.status_code == 401


def test_internal_room_state_rejects_non_bearer_scheme(client, internal_api_key):
    response = client.get(
        "/api/internal/room-state",
        headers={"Authorization": f"Token {internal_api_key}"},
    )
    assert response.status_code == 401


def test_internal_room_state_does_not_accept_login_session(authed_client, internal_api_key):
    """ログインセッションでは通さない（サーバー間専用）。"""
    response = authed_client.get("/api/internal/room-state")
    assert response.status_code == 401


def test_internal_room_state_returns_snapshot(client, internal_api_key):
    response = client.get(
        "/api/internal/room-state",
        headers={"Authorization": f"Bearer {internal_api_key}"},
    )
    assert response.status_code == 200
    data = response.json()

    # 日時はオフセット付き。VPS が UTC のため、付いていないと受け側で9時間ずれる。
    assert data["fetchedAt"].endswith("+09:00")
    assert data["staleThresholdMinutes"] == 15

    sensor = data["sensors"][0]
    assert sensor["deviceId"] == 1
    assert sensor["name"]
    assert sensor["measuredAt"].endswith("+09:00")
    assert sensor["stale"] is False
    assert isinstance(sensor["ageMinutes"], float)
    assert isinstance(sensor["temperature"], float)
    # 履歴・日別統計は載せない
    assert "history" not in sensor

    assert data["outdoor"]["temperature"] == 25.0
    assert data["outdoor"]["observedAt"] == "2026-08-19T21:00:00+09:00"

    aircon = data["aircons"][0]
    assert aircon["acId"] == 1
    assert aircon["power"] == "ON"
    assert aircon["targetTemperature"] == 26.0
    assert aircon["measuredAt"].endswith("+09:00")
    assert aircon["online"] is True


def test_internal_room_state_uses_camel_case_only(client, internal_api_key):
    """AIDE 側は camelCase を前提に実装済み。snake_case が混ざっていないこと。"""
    response = client.get(
        "/api/internal/room-state",
        headers={"Authorization": f"Bearer {internal_api_key}"},
    )
    data = response.json()
    keys = set(data) | set(data["sensors"][0]) | set(data["outdoor"]) | set(data["aircons"][0])
    assert not [key for key in keys if "_" in key]


def test_bills_summary_requires_auth(client):
    response = client.get("/api/bills/summary")
    assert response.status_code == 401


def test_bills_summary_returns_mock_months(authed_client):
    response = authed_client.get("/api/bills/summary?months=12")
    assert response.status_code == 200
    data = response.json()

    assert len(data["months"]) == 12
    # 今月ぶんは検針が終わるまで確定しないので、最新は先月分になる
    latest = data["latest"]
    assert latest["billing_month"] == data["months"][-1]["billing_month"]
    assert latest["electricity"]["usage_unit"] == "kWh"
    assert latest["gas"]["usage_unit"] == "m3"
    assert (
        latest["total_yen"]
        == latest["electricity"]["amount_yen"] + latest["gas"]["amount_yen"]
    )


def test_post_bills_is_accepted_in_mock_mode(client):
    response = client.post(
        "/api/bills",
        json={
            "records": [
                {
                    "billing_month": "2026-08",
                    "kind": "electricity",
                    "contract_key": "c1",
                    "plan_name": "なっトクでんき",
                    "amount_yen": 15760,
                    "usage_value": 540,
                    "usage_unit": "kWh",
                }
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["received"] == 1


def test_post_bills_rejects_a_missing_amount(client):
    response = client.post(
        "/api/bills",
        json={"records": [{"billing_month": "2026-08", "kind": "electricity"}]},
    )
    assert response.status_code == 422


def test_post_bills_rejects_an_unknown_kind_even_in_mock_mode(client):
    # モックの開発サーバー相手に試したときに書式の誤りを見逃さない
    response = client.post(
        "/api/bills",
        json={"records": [{"billing_month": "2026-08", "kind": "water", "amount_yen": 100}]},
    )
    assert response.status_code == 422


def test_post_bills_rejects_a_malformed_billing_month(client):
    response = client.post(
        "/api/bills",
        json={
            "records": [
                {"billing_month": "2026年8月", "kind": "electricity", "amount_yen": 100}
            ]
        },
    )
    assert response.status_code == 422
