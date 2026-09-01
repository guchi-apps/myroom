import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from sqlalchemy.orm import Session

from . import database

load_dotenv()

DEFAULT_LAT = float(os.getenv("OUTDOOR_LAT", "34.82"))
DEFAULT_LON = float(os.getenv("OUTDOOR_LON", "135.56"))
DEFAULT_NAME = os.getenv("OUTDOOR_LOCATION_NAME", "茨木市")
DEFAULT_LOCATION_ID = "default"

CONFIG_PATH = Path(__file__).resolve().parent.parent / "data" / "outdoor_location.json"
SETTING_KEY = "outdoor_location"


def _default_state() -> Dict[str, Any]:
    return {
        "locations": [
            {
                "id": DEFAULT_LOCATION_ID,
                "latitude": DEFAULT_LAT,
                "longitude": DEFAULT_LON,
                "name": DEFAULT_NAME,
            }
        ],
        "primary_id": DEFAULT_LOCATION_ID,
    }


def _parse_entry(data: Any, fallback_id: str) -> Optional[Dict[str, Any]]:
    try:
        lat = float(data["latitude"])
        lon = float(data["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return None
    name = str(data.get("name") or DEFAULT_NAME)
    location_id = str(data.get("id") or fallback_id)
    return {"id": location_id, "latitude": lat, "longitude": lon, "name": name}


def _parse_state(data: Any) -> Dict[str, Any]:
    """保存されているJSONを読み込む。

    #308より前は`{"latitude", "longitude", "name"}`という単一オブジェクトの形で
    保存されていた。ここで新形式（`locations`配列＋`primary_id`）へ読み替えることで、
    移行スクリプトなしに既存データを引き継ぐ（#294と同じ考え方）。
    """
    if isinstance(data, dict) and isinstance(data.get("locations"), list):
        locations: List[Dict[str, Any]] = []
        for i, raw in enumerate(data["locations"]):
            entry = _parse_entry(raw, f"loc-{i}")
            if entry is not None:
                locations.append(entry)
        if not locations:
            return _default_state()

        seen_ids: set = set()
        for entry in locations:
            if entry["id"] in seen_ids:
                entry["id"] = f"{entry['id']}-{uuid.uuid4().hex[:4]}"
            seen_ids.add(entry["id"])

        primary_id = data.get("primary_id")
        if not any(loc["id"] == primary_id for loc in locations):
            primary_id = locations[0]["id"]
        return {"locations": locations, "primary_id": primary_id}

    if isinstance(data, dict):
        entry = _parse_entry(data, DEFAULT_LOCATION_ID)
        if entry is not None:
            return {"locations": [entry], "primary_id": entry["id"]}

    return _default_state()


def _load_file_state() -> Dict[str, Any]:
    if CONFIG_PATH.exists():
        try:
            with CONFIG_PATH.open(encoding="utf-8") as f:
                data = json.load(f)
            return _parse_state(data)
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    return _default_state()


def _write_file_state(state: Dict[str, Any]) -> Dict[str, Any]:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CONFIG_PATH.open("w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    return state


def _load_db_state(db: Session) -> Dict[str, Any]:
    row = (
        db.query(database.AppSetting)
        .filter(database.AppSetting.setting_key == SETTING_KEY)
        .first()
    )
    if row is None:
        state = _load_file_state()
        _save_db_state(db, state)
        return state
    try:
        return _parse_state(json.loads(row.setting_value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return _default_state()


def _save_db_state(db: Session, state: Dict[str, Any]) -> None:
    serialized = json.dumps(state, ensure_ascii=False)
    row = (
        db.query(database.AppSetting)
        .filter(database.AppSetting.setting_key == SETTING_KEY)
        .first()
    )
    if row is None:
        db.add(database.AppSetting(setting_key=SETTING_KEY, setting_value=serialized))
    else:
        row.setting_value = serialized
    db.commit()


def get_state(db: Optional[Session] = None) -> Dict[str, Any]:
    if database.DB_MOCK or db is None:
        return _load_file_state()
    return _load_db_state(db)


def _save_state(state: Dict[str, Any], db: Optional[Session] = None) -> Dict[str, Any]:
    if database.DB_MOCK or db is None:
        _write_file_state(state)
    else:
        _save_db_state(db, state)

    from . import weather

    weather.clear_outdoor_weather_cache()
    return state


def list_locations(db: Optional[Session] = None) -> List[Dict[str, Any]]:
    """登録済みの地点一覧。基準地点には`is_primary=True`が付く。"""
    state = get_state(db)
    return [
        {**loc, "is_primary": loc["id"] == state["primary_id"]}
        for loc in state["locations"]
    ]


def get_location_by_id(location_id: str, db: Optional[Session] = None) -> Optional[Dict[str, Any]]:
    state = get_state(db)
    for loc in state["locations"]:
        if loc["id"] == location_id:
            return dict(loc)
    return None


def get_primary_location(db: Optional[Session] = None) -> Dict[str, Any]:
    state = get_state(db)
    primary_id = state["primary_id"]
    for loc in state["locations"]:
        if loc["id"] == primary_id:
            return dict(loc)
    return dict(state["locations"][0])


def get_location(db: Optional[Session] = None) -> Dict[str, Any]:
    """後方互換用。単一地点だった頃と同じ形（緯度・経度・名前）で基準地点を返す。"""
    return get_primary_location(db)


def _validate(latitude: float, longitude: float, name: str) -> str:
    if not (-90 <= latitude <= 90):
        raise ValueError("latitude must be between -90 and 90")
    if not (-180 <= longitude <= 180):
        raise ValueError("longitude must be between -180 and 180")
    stripped = name.strip()
    if not stripped:
        raise ValueError("name is required")
    return stripped


def save_location(
    latitude: float,
    longitude: float,
    name: str,
    db: Optional[Session] = None,
) -> Dict[str, Any]:
    """後方互換用。基準地点の緯度・経度・名前を更新する。"""
    stripped_name = _validate(latitude, longitude, name)
    state = get_state(db)
    for loc in state["locations"]:
        if loc["id"] == state["primary_id"]:
            loc["latitude"] = round(latitude, 4)
            loc["longitude"] = round(longitude, 4)
            loc["name"] = stripped_name
            break
    _save_state(state, db)
    return get_primary_location(db)


def add_location(
    name: str,
    latitude: float,
    longitude: float,
    db: Optional[Session] = None,
) -> Dict[str, Any]:
    stripped_name = _validate(latitude, longitude, name)
    state = get_state(db)
    new_id = uuid.uuid4().hex[:8]
    entry = {
        "id": new_id,
        "latitude": round(latitude, 4),
        "longitude": round(longitude, 4),
        "name": stripped_name,
    }
    state["locations"].append(entry)
    _save_state(state, db)
    return {**entry, "is_primary": entry["id"] == state["primary_id"]}


def update_location(
    location_id: str,
    name: str,
    latitude: float,
    longitude: float,
    db: Optional[Session] = None,
) -> Dict[str, Any]:
    stripped_name = _validate(latitude, longitude, name)
    state = get_state(db)
    for loc in state["locations"]:
        if loc["id"] == location_id:
            loc["latitude"] = round(latitude, 4)
            loc["longitude"] = round(longitude, 4)
            loc["name"] = stripped_name
            _save_state(state, db)
            return {**loc, "is_primary": loc["id"] == state["primary_id"]}
    raise ValueError("location not found")


def delete_location(location_id: str, db: Optional[Session] = None) -> None:
    state = get_state(db)
    if location_id == state["primary_id"]:
        raise ValueError("cannot delete the primary location")
    remaining = [loc for loc in state["locations"] if loc["id"] != location_id]
    if len(remaining) == len(state["locations"]):
        raise ValueError("location not found")
    state["locations"] = remaining
    _save_state(state, db)


def set_primary_location(location_id: str, db: Optional[Session] = None) -> Dict[str, Any]:
    state = get_state(db)
    if not any(loc["id"] == location_id for loc in state["locations"]):
        raise ValueError("location not found")
    state["primary_id"] = location_id
    _save_state(state, db)
    return get_primary_location(db)
