def test_health_get(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db_mock": True}


def test_health_head(client):
    response = client.head("/api/health")
    assert response.status_code == 200


def test_login_returns_access_token(client, monkeypatch):
    monkeypatch.setattr(
        "backend.main.verify_google_id_token", lambda credential: "allowed@example.com"
    )
    response = client.post("/api/auth/google", json={"credential": "dummy"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["token_type"] == "bearer"
    assert isinstance(data["access_token"], str)
    assert data["access_token"]


def test_login_rejects_unauthorized_account(client, monkeypatch):
    def _deny(credential):
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="このGoogleアカウントではログインできません")

    monkeypatch.setattr("backend.main.verify_google_id_token", _deny)
    response = client.post("/api/auth/google", json={"credential": "dummy"})
    assert response.status_code == 403


def test_latest_requires_auth(client):
    response = client.get("/api/latest?device=1")
    assert response.status_code == 401


def test_latest_returns_mock_data(client, auth_headers):
    response = client.get("/api/latest?device=1", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["device_id"] == 1
    assert isinstance(data["temperature"], float)
    assert isinstance(data["illuminance"], float)
    assert data["outdoor_temperature"] == 25.0


def test_latest_rejects_invalid_device(client, auth_headers):
    response = client.get("/api/latest?device=0", headers=auth_headers)
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


def test_outdoor_history_day_returns_open_meteo_records(client, auth_headers):
    response = client.get("/api/outdoor-history?range=day", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert data[0]["outdoor_temperature"] == 22.0
    assert data[0]["outdoor_humidity"] == 55.0
    assert data[0]["outdoor_pressure"] == 1013


def test_history_day_returns_records(client, auth_headers):
    response = client.get("/api/history?range=day&device=1", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "temperature" in data[0]


def test_history_year_returns_daily_aggregation(client, auth_headers):
    response = client.get("/api/history?range=year&device=1", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    sample = data[0]
    assert "temperature_min" in sample
    assert "temperature_max" in sample


def test_aircon_history_day_returns_records(client, auth_headers):
    response = client.get("/api/aircon/history?range=day&ac_id=1", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "temperature" in data[0]
    assert "target_temperature" in data[0]


def test_aircon_history_year_returns_daily_aggregation(client, auth_headers):
    response = client.get("/api/aircon/history?range=year&ac_id=1", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    sample = data[0]
    assert "temperature_min" in sample
    assert "temperature_max" in sample
    assert any("target_temperature" in row for row in data)


def test_daily_stats_returns_list(client, auth_headers):
    response = client.get("/api/daily-stats?device=1", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "temp_max" in data[0]


def test_devices_list(client, auth_headers):
    response = client.get("/api/devices", headers=auth_headers)
    assert response.status_code == 200
    devices = response.json()["devices"]
    assert any(device["id"] == 1 for device in devices)


def test_update_device_name(client, auth_headers):
    response = client.put(
        "/api/devices/1",
        json={"name": "テスト部屋"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "テスト部屋"

    listed = client.get("/api/devices", headers=auth_headers).json()["devices"]
    assert next(item for item in listed if item["id"] == 1)["name"] == "テスト部屋"


def test_update_device_inherits_from(client, auth_headers):
    response = client.put(
        "/api/devices/2",
        json={"name": "新リビング", "inherits_from": 1},
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "新リビング"
    assert data["inherits_from"] == 1

    listed = client.get("/api/devices", headers=auth_headers).json()["devices"]
    device2 = next(item for item in listed if item["id"] == 2)
    assert device2["inherits_from"] == 1


def test_update_device_rejects_self_inheritance(client, auth_headers):
    response = client.put(
        "/api/devices/1",
        json={"name": "リビング", "inherits_from": 1},
        headers=auth_headers,
    )
    assert response.status_code == 400


def test_update_device_name_rejects_empty(client, auth_headers):
    response = client.put(
        "/api/devices/1",
        json={"name": "   "},
        headers=auth_headers,
    )
    assert response.status_code == 400


def test_outdoor_location_get(client, auth_headers):
    response = client.get("/api/outdoor-location", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "latitude" in data
    assert "longitude" in data
    assert "name" in data


def test_outdoor_location_update(client, auth_headers):
    response = client.put(
        "/api/outdoor-location",
        json={"latitude": 35.0, "longitude": 135.5, "name": "大阪"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "大阪"


def test_outdoor_location_rejects_invalid_latitude(client, auth_headers):
    response = client.put(
        "/api/outdoor-location",
        json={"latitude": 999, "longitude": 135.5, "name": "bad"},
        headers=auth_headers,
    )
    assert response.status_code == 400


def test_outdoor_location_search(client, auth_headers):
    response = client.get("/api/outdoor-location/search?q=大阪", headers=auth_headers)
    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) == 1
    assert results[0]["name"] == "大阪"


def test_aircon_latest_returns_mock_data(client, auth_headers):
    response = client.get("/api/aircon/latest", headers=auth_headers)
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


def test_aircon_units_list(client, auth_headers):
    response = client.get("/api/aircon/units", headers=auth_headers)
    assert response.status_code == 200
    units = response.json()["units"]
    assert any(unit["ac_id"] == 1 for unit in units)


def test_update_aircon_unit_name(client, auth_headers):
    response = client.put(
        "/api/aircon/units/1",
        json={"name": "寝室エアコン"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "寝室エアコン"

    latest = client.get("/api/aircon/latest", headers=auth_headers).json()
    assert latest["name"] == "寝室エアコン"


def test_update_aircon_unit_name_rejects_empty(client, auth_headers):
    response = client.put(
        "/api/aircon/units/1",
        json={"name": "   "},
        headers=auth_headers,
    )
    assert response.status_code == 400


def test_records_list_returns_mock_data(client, auth_headers):
    response = client.get("/api/records?device=1", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data["records"], list)
    assert len(data["records"]) > 0
    assert data["records"][0]["device_id"] == 1
    assert "datetime" in data["records"][0]


def test_records_delete_mock_ok(client, auth_headers):
    response = client.delete(
        "/api/records",
        params={"device": 1, "datetime": "2026-05-30 12:00:00"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["deleted"] is True


def test_records_bulk_delete_mock_ok(client, auth_headers):
    response = client.post(
        "/api/records/bulk-delete",
        json={
            "device": 1,
            "datetimes": ["2026-05-30 12:00:00", "2026-05-30 11:00:00"],
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["deleted_count"] == 2


def test_records_bulk_delete_rejects_empty(client, auth_headers):
    response = client.post(
        "/api/records/bulk-delete",
        json={"device": 1, "datetimes": []},
        headers=auth_headers,
    )
    assert response.status_code == 400


def test_records_rejects_invalid_device(client, auth_headers):
    response = client.get("/api/records?device=0", headers=auth_headers)
    assert response.status_code == 400


def test_aircon_daily_stats_returns_mock_data(client, auth_headers):
    response = client.get("/api/aircon/daily-stats?ac_id=1", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "temp_min" in data[0]
    assert "temp_max" in data[0]
    assert "humid_min" not in data[0]


def test_ui_settings_get_and_update(client, auth_headers):
    response = client.get("/api/ui-settings", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "display_order" in data
    assert "chart_colors" in data
    assert "hidden_devices" in data

    updated = client.put(
        "/api/ui-settings",
        json={
            "display_order": ["device:2", "device:1", "outdoor", "aircon"],
            "hidden_devices": ["device:2"],
            "chart_colors": {"device:1": "#3498db", "device:2": "#e67e22"},
        },
        headers=auth_headers,
    )
    assert updated.status_code == 200
    saved = updated.json()
    assert saved["display_order"][0] == "device:2"
    assert "device:2" in saved["hidden_devices"]

    fetched = client.get("/api/ui-settings", headers=auth_headers).json()
    assert fetched["display_order"][0] == "device:2"
    assert "device:2" in fetched["hidden_devices"]
