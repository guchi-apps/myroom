import datetime
import os

os.environ["DB_MOCK"] = "true"
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com")

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.device_config.CONFIG_PATH",
        tmp_path / "devices.json",
    )
    monkeypatch.setattr(
        "backend.aircon_config.CONFIG_PATH",
        tmp_path / "aircon.json",
    )
    monkeypatch.setattr(
        "backend.outdoor_config.CONFIG_PATH",
        tmp_path / "outdoor_location.json",
    )
    monkeypatch.setattr(
        "backend.ui_settings.CONFIG_PATH",
        tmp_path / "ui_settings.json",
    )
    return tmp_path


@pytest.fixture
def auth_headers():
    from backend.auth import create_access_token

    token = create_access_token(sub="test@example.com")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def mock_weather(monkeypatch):
    def outdoor_weather(db=None):
        return {"temperature": 25.0, "humidity": 60.0, "pressure": 1013.0}

    def outdoor_history(start, end, db=None):
        start_dt = datetime.datetime.strptime(start, "%Y-%m-%d")
        end_dt = datetime.datetime.strptime(end, "%Y-%m-%d")
        times = []
        temps = []
        humids = []
        pressures = []
        cursor = start_dt
        while cursor <= end_dt + datetime.timedelta(hours=23):
            times.append(cursor.strftime("%Y-%m-%dT%H:00"))
            temps.append(22.0)
            humids.append(55.0)
            pressures.append(1013.0)
            cursor += datetime.timedelta(hours=1)
        return {
            "time": times,
            "temperature": temps,
            "humidity": humids,
            "pressure": pressures,
        }

    def search_locations(query, count=8):
        if query.strip() == "大阪":
            return [
                {
                    "name": "大阪",
                    "label": "大阪, 大阪府, 日本",
                    "latitude": 34.6937,
                    "longitude": 135.5023,
                }
            ]
        return []

    monkeypatch.setattr("backend.weather.get_outdoor_weather", outdoor_weather)
    monkeypatch.setattr("backend.weather.get_outdoor_history", outdoor_history)
    monkeypatch.setattr("backend.weather.search_locations", search_locations)


@pytest.fixture
def client(data_dir, mock_weather):
    from backend.main import app

    with TestClient(app) as test_client:
        yield test_client
