import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from sqlalchemy.orm import Session

from . import database

CONFIG_PATH = Path(__file__).resolve().parent.parent / "data" / "ui_settings.json"

SETTING_DISPLAY_ORDER = "display_order"
SETTING_CHART_COLORS = "chart_colors"
SETTING_HIDDEN_DEVICES = "hidden_devices"
SETTING_STALE_ALERT_EXCLUDED = "stale_alert_excluded_devices"
SETTING_PRESSURE_OFFSETS = "pressure_offsets"

DEFAULT_DISPLAY_ORDER = ["device:1", "device:2", "outdoor", "aircon"]

DEFAULT_CHART_COLORS: Dict[str, str] = {
    "device:1": "#3498db",
    "device:2": "#e67e22",
    "device:3": "#1abc9c",
    "outdoor": "#adb5bd",
    "airconTarget": "#9b59b6",
}


def _default_settings() -> Dict[str, Any]:
    return {
        SETTING_DISPLAY_ORDER: list(DEFAULT_DISPLAY_ORDER),
        SETTING_CHART_COLORS: dict(DEFAULT_CHART_COLORS),
        SETTING_HIDDEN_DEVICES: [],
        SETTING_STALE_ALERT_EXCLUDED: [],
        SETTING_PRESSURE_OFFSETS: {},
    }


def _normalize_display_order(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return list(DEFAULT_DISPLAY_ORDER)

    normalized: List[str] = []
    seen: Set[str] = set()
    for entry in raw:
        if not isinstance(entry, str):
            continue
        key = entry.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(key)

    for key in DEFAULT_DISPLAY_ORDER:
        if key not in seen:
            normalized.append(key)

    return normalized


def _normalize_chart_colors(raw: Any) -> Dict[str, str]:
    defaults = dict(DEFAULT_CHART_COLORS)
    if not isinstance(raw, dict):
        return defaults

    for key, value in raw.items():
        if isinstance(key, str) and isinstance(value, str) and value.strip():
            defaults[key] = value.strip()
    return defaults


def _normalize_hidden_devices(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []

    hidden: List[str] = []
    seen: Set[str] = set()
    for entry in raw:
        if not isinstance(entry, str):
            continue
        key = entry.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        hidden.append(key)
    return hidden


def _normalize_stale_alert_excluded(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []

    excluded: List[str] = []
    seen: Set[str] = set()
    for entry in raw:
        if not isinstance(entry, str):
            continue
        key = entry.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        excluded.append(key)
    return excluded


def _normalize_pressure_offsets(raw: Any) -> Dict[str, float]:
    if not isinstance(raw, dict):
        return {}

    offsets: Dict[str, float] = {}
    for key, value in raw.items():
        try:
            device_id = str(int(key))
            offset = float(value)
        except (TypeError, ValueError):
            continue
        if offset != 0:
            offsets[device_id] = offset
    return offsets


def _normalize_settings(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    defaults = _default_settings()
    if not raw:
        return defaults

    return {
        SETTING_DISPLAY_ORDER: _normalize_display_order(
            raw.get(SETTING_DISPLAY_ORDER, defaults[SETTING_DISPLAY_ORDER])
        ),
        SETTING_CHART_COLORS: _normalize_chart_colors(
            raw.get(SETTING_CHART_COLORS, defaults[SETTING_CHART_COLORS])
        ),
        SETTING_HIDDEN_DEVICES: _normalize_hidden_devices(
            raw.get(SETTING_HIDDEN_DEVICES, defaults[SETTING_HIDDEN_DEVICES])
        ),
        SETTING_STALE_ALERT_EXCLUDED: _normalize_stale_alert_excluded(
            raw.get(SETTING_STALE_ALERT_EXCLUDED, defaults[SETTING_STALE_ALERT_EXCLUDED])
        ),
        SETTING_PRESSURE_OFFSETS: _normalize_pressure_offsets(
            raw.get(SETTING_PRESSURE_OFFSETS, defaults[SETTING_PRESSURE_OFFSETS])
        ),
    }


def _load_file_settings() -> Dict[str, Any]:
    if not CONFIG_PATH.exists():
        return _default_settings()

    try:
        with CONFIG_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return _normalize_settings(data)
    except (TypeError, ValueError, json.JSONDecodeError):
        pass
    return _default_settings()


def _write_file_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_settings(settings)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CONFIG_PATH.open("w", encoding="utf-8") as f:
        json.dump(normalized, f, ensure_ascii=False, indent=2)
    return normalized


def _load_db_settings(db: Session) -> Dict[str, Any]:
    rows = db.query(database.AppSetting).all()
    if not rows:
        migrated = _normalize_settings(_load_file_settings())
        for key, value in migrated.items():
            db.add(database.AppSetting(setting_key=key, setting_value=json.dumps(value)))
        db.commit()
        return migrated

    raw: Dict[str, Any] = {}
    for row in rows:
        try:
            raw[row.setting_key] = json.loads(row.setting_value)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
    return _normalize_settings(raw)


def _save_db_setting(db: Session, key: str, value: Any) -> None:
    serialized = json.dumps(value, ensure_ascii=False)
    row = db.query(database.AppSetting).filter(database.AppSetting.setting_key == key).first()
    if row is None:
        db.add(database.AppSetting(setting_key=key, setting_value=serialized))
    else:
        row.setting_value = serialized
    db.commit()


def get_settings(db: Optional[Session] = None) -> Dict[str, Any]:
    if database.DB_MOCK or db is None:
        return _load_file_settings()
    return _load_db_settings(db)


def save_settings(
    updates: Dict[str, Any],
    db: Optional[Session] = None,
) -> Dict[str, Any]:
    current = get_settings(db)
    merged = {
        SETTING_DISPLAY_ORDER: updates.get(SETTING_DISPLAY_ORDER, current[SETTING_DISPLAY_ORDER]),
        SETTING_CHART_COLORS: updates.get(SETTING_CHART_COLORS, current[SETTING_CHART_COLORS]),
        SETTING_HIDDEN_DEVICES: updates.get(
            SETTING_HIDDEN_DEVICES, current[SETTING_HIDDEN_DEVICES]
        ),
        SETTING_STALE_ALERT_EXCLUDED: updates.get(
            SETTING_STALE_ALERT_EXCLUDED, current.get(SETTING_STALE_ALERT_EXCLUDED, [])
        ),
        SETTING_PRESSURE_OFFSETS: updates.get(
            SETTING_PRESSURE_OFFSETS, current.get(SETTING_PRESSURE_OFFSETS, {})
        ),
    }
    normalized = _normalize_settings(merged)

    if database.DB_MOCK or db is None:
        return _write_file_settings(normalized)

    for key, value in normalized.items():
        _save_db_setting(db, key, value)
    return normalized
