import datetime
import threading
import time
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import requests
from sqlalchemy.orm import Session

from . import outdoor_config

_OUTDOOR_WEATHER_CACHE_TTL_SECONDS = 300
_OUTDOOR_HISTORY_CACHE_TTL_SECONDS = 300
_outdoor_weather_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_outdoor_history_cache: Dict[str, Tuple[float, Dict[str, List[Any]]]] = {}
_outdoor_history_inflight: Dict[str, threading.Event] = {}
_cache_lock = Lock()


def clear_outdoor_weather_cache() -> None:
    with _cache_lock:
        _outdoor_weather_cache.clear()
        _outdoor_history_cache.clear()


def get_coords(db: Optional[Session] = None) -> Tuple[float, float]:
    loc = outdoor_config.get_location(db)
    return loc["latitude"], loc["longitude"]


def _fetch_outdoor_weather(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    try:
        url = (
            "https://api.open-meteo.com/v1/forecast?"
            f"latitude={lat}&longitude={lon}"
            "&current=temperature_2m,relative_humidity_2m,surface_pressure"
            "&timezone=Asia%2FTokyo"
        )
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            current = data.get("current", {})
            return {
                "temperature": current.get("temperature_2m"),
                "humidity": current.get("relative_humidity_2m"),
                "pressure": current.get("surface_pressure"),
                # 観測時刻。`timezone=Asia/Tokyo` を渡しているのでJSTだがオフセットは付かない
                # （例: "2026-08-19T21:00"）。オフセットの付与は受け取り側で行う。
                "observed_at": current.get("time"),
            }
        print(f"Weather API error: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"Error fetching outdoor weather: {e}")
    return None


def get_outdoor_weather(db: Optional[Session] = None) -> Optional[Dict[str, Any]]:
    """
    Open-Meteo APIから設定地点の現在の気温、湿度、気圧を取得する。
    """
    lat, lon = get_coords(db)
    cache_key = f"{lat:.4f},{lon:.4f}"
    now = time.time()
    with _cache_lock:
        cached = _outdoor_weather_cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]

    data = _fetch_outdoor_weather(lat, lon)
    if data is not None:
        with _cache_lock:
            _outdoor_weather_cache[cache_key] = (now + _OUTDOOR_WEATHER_CACHE_TTL_SECONDS, data)
    return data


def _fetch_outdoor_history(
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
) -> Optional[Dict[str, List[Any]]]:
    try:
        start_dt = datetime.datetime.strptime(start_date, "%Y-%m-%d")
        days_ago = (datetime.datetime.now() - start_dt).days

        base_url = "api.open-meteo.com/v1/forecast"
        if days_ago > 90:
            base_url = "archive-api.open-meteo.com/v1/archive"

        url = (
            f"https://{base_url}?latitude={lat}&longitude={lon}"
            "&hourly=temperature_2m,relative_humidity_2m,surface_pressure"
            f"&start_date={start_date}&end_date={end_date}&timezone=Asia%2FTokyo"
        )

        response = requests.get(url, timeout=15)
        if response.status_code == 200:
            data = response.json()
            hourly = data.get("hourly", {})
            return {
                "time": hourly.get("time"),
                "temperature": hourly.get("temperature_2m"),
                "humidity": hourly.get("relative_humidity_2m"),
                "pressure": hourly.get("surface_pressure"),
            }
        print(f"Weather API error: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"Error fetching outdoor history: {e}")
    return None


def get_outdoor_history(
    start_date: str,
    end_date: str,
    db: Optional[Session] = None,
) -> Optional[Dict[str, List[Any]]]:
    """
    指定された期間の外気履歴を取得する (ISO 8601 format: YYYY-MM-DD)
    1年以上前のデータにも対応するため、期間に応じて Forecast API と Archive API を使い分ける。
    """
    lat, lon = get_coords(db)
    cache_key = f"{lat:.4f},{lon:.4f}|{start_date}|{end_date}"
    now = time.time()

    with _cache_lock:
        cached = _outdoor_history_cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]

        inflight = _outdoor_history_inflight.get(cache_key)
        if inflight is not None:
            is_owner = False
            wait_event = inflight
        else:
            wait_event = threading.Event()
            _outdoor_history_inflight[cache_key] = wait_event
            is_owner = True

    if not is_owner:
        wait_event.wait(timeout=20)
        with _cache_lock:
            cached = _outdoor_history_cache.get(cache_key)
            if cached:
                return cached[1]
        return None

    try:
        data = _fetch_outdoor_history(lat, lon, start_date, end_date)
        if data is not None:
            with _cache_lock:
                _outdoor_history_cache[cache_key] = (
                    now + _OUTDOOR_HISTORY_CACHE_TTL_SECONDS,
                    data,
                )
        return data
    finally:
        with _cache_lock:
            _outdoor_history_inflight.pop(cache_key, None)
        wait_event.set()


def search_locations(query: str, count: int = 8) -> List[Dict[str, Any]]:
    """Open-Meteo Geocoding API で地点を検索する。"""
    q = query.strip()
    if len(q) < 2:
        return []

    try:
        url = (
            "https://geocoding-api.open-meteo.com/v1/search?"
            f"name={quote(q)}&count={count}&language=ja&format=json"
        )
        response = requests.get(url, timeout=8)
        if response.status_code != 200:
            return []

        results = response.json().get("results") or []
        locations: List[Dict[str, Any]] = []
        for item in results:
            name = item.get("name")
            lat = item.get("latitude")
            lon = item.get("longitude")
            if name is None or lat is None or lon is None:
                continue
            admin1 = item.get("admin1")
            country = item.get("country")
            label_parts = [name]
            if admin1:
                label_parts.append(admin1)
            if country:
                label_parts.append(country)
            locations.append(
                {
                    "name": name,
                    "label": ", ".join(label_parts),
                    "latitude": lat,
                    "longitude": lon,
                }
            )
        return locations
    except Exception as e:
        print(f"Error searching locations: {e}")
        return []
