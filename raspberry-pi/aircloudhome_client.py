"""AirCloud Home (白くまくんアプリ) API client — sync requests implementation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

BASE_URL = "https://api-kuma.aircloudhome.com"
EXPIRY_BUFFER = timedelta(seconds=60)


class AirCloudHomeError(Exception):
    """Base error for AirCloud Home API failures."""


class AirCloudHomeAuthError(AirCloudHomeError):
    """Authentication or token refresh failed."""


@dataclass
class AirCloudDevice:
    id: int
    family_id: int
    name: str
    power: str
    mode: str
    room_temperature: Optional[float]
    target_temperature: Optional[float]
    fan_speed: str
    fan_swing: str
    humidity: Optional[int]
    online: bool
    model: Optional[str] = None

    @classmethod
    def from_api(cls, device: Dict[str, Any], family_id: int) -> "AirCloudDevice":
        return cls(
            id=int(device["id"]),
            family_id=family_id,
            name=str(device.get("name") or "AC {}".format(device["id"])),
            power=str(device.get("power") or "OFF"),
            mode=str(device.get("mode") or "UNKNOWN"),
            room_temperature=_as_float(device.get("roomTemperature")),
            target_temperature=_as_float(device.get("iduTemperature")),
            fan_speed=str(device.get("fanSpeed") or "AUTO"),
            fan_swing=str(device.get("fanSwing") or "OFF"),
            humidity=_as_int(device.get("humidity")),
            online=bool(device.get("online", False)),
            model=device.get("model"),
        )


def _as_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _expires_at(now: datetime, expires_ms: Any) -> Optional[datetime]:
    if expires_ms is None:
        return None
    try:
        return now + timedelta(seconds=float(expires_ms) / 1000.0)
    except (TypeError, ValueError):
        return None


class AirCloudHomeClient:
    def __init__(self, email: str, password: str, timeout: int = 15) -> None:
        self.email = email
        self.password = password
        self.timeout = timeout
        self._session = requests.Session()
        self._access_token: Optional[str] = None
        self._refresh_token: Optional[str] = None
        self._access_token_expires_at: Optional[datetime] = None
        self._refresh_token_expires_at: Optional[datetime] = None

    def close(self) -> None:
        self._session.close()

    def __enter__(self) -> "AirCloudHomeClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def get_devices(self) -> List[AirCloudDevice]:
        self._ensure_valid_token()
        devices: List[AirCloudDevice] = []
        for family in self._get_family_groups():
            family_id = family.get("familyId")
            if not family_id:
                continue
            for raw in self._get_idu_list(int(family_id)):
                devices.append(AirCloudDevice.from_api(raw, int(family_id)))
        return devices

    def get_raw_devices(self) -> List[Dict[str, Any]]:
        """未加工の idu-list レスポンスをそのまま返す（電気代など未対応フィールドの調査用）。"""
        self._ensure_valid_token()
        raw_devices: List[Dict[str, Any]] = []
        for family in self._get_family_groups():
            family_id = family.get("familyId")
            if not family_id:
                continue
            for raw in self._get_idu_list(int(family_id)):
                entry = dict(raw)
                entry["_familyId"] = family_id
                raw_devices.append(entry)
        return raw_devices

    def _ensure_valid_token(self) -> None:
        if self._is_access_token_valid():
            return
        if self._is_refresh_token_valid():
            self._refresh_token_request()
        else:
            self._sign_in()

    def _sign_in(self) -> None:
        response = self._request(
            "post",
            "{}/iam/auth/sign-in".format(BASE_URL),
            json={"email": self.email, "password": self.password},
        )
        self._store_tokens(response)

    def _refresh_token_request(self) -> None:
        if not self._refresh_token:
            raise AirCloudHomeAuthError("No refresh token available")
        response = self._request(
            "post",
            "{}/iam/auth/refresh-token".format(BASE_URL),
            headers={
                "Authorization": "Bearer {}".format(self._refresh_token),
                "isRefreshToken": "true",
            },
            retry_on_auth=False,
        )
        self._store_tokens(response)

    def _get_family_groups(self) -> List[Dict[str, Any]]:
        response = self._request(
            "get",
            "{}/iam/family-account/v2/groups".format(BASE_URL),
            headers={"Authorization": "Bearer {}".format(self._access_token)},
        )
        return response.get("result", [])

    def _get_idu_list(self, family_id: int) -> List[Dict[str, Any]]:
        response = self._request(
            "get",
            "{}/rac/ownership/groups/{}/idu-list".format(BASE_URL, family_id),
            headers={"Authorization": "Bearer {}".format(self._access_token)},
        )
        return response if isinstance(response, list) else []

    def _request(
        self,
        method: str,
        url: str,
        json: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        retry_on_auth: bool = True,
    ) -> Any:
        try:
            response = self._session.request(
                method=method,
                url=url,
                json=json,
                headers=headers,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise AirCloudHomeError("Request failed: {}".format(exc))

        if response.status_code in (401, 403):
            if retry_on_auth and headers and "Authorization" in headers:
                self._ensure_valid_token()
                retry_headers = dict(headers)
                retry_headers["Authorization"] = "Bearer {}".format(self._access_token)
                return self._request(
                    method,
                    url,
                    json=json,
                    headers=retry_headers,
                    retry_on_auth=False,
                )
            raise AirCloudHomeAuthError("Invalid AirCloud Home credentials")

        if response.status_code >= 400:
            raise AirCloudHomeError(
                "API error {}: {}".format(response.status_code, response.text[:300])
            )

        if not response.content:
            return {}
        return response.json()

    def _store_tokens(self, response: Dict[str, Any]) -> None:
        now = datetime.now(timezone.utc)

        token = response.get("token")
        if token:
            self._access_token = token
            self._access_token_expires_at = _expires_at(
                now, response.get("access_token_expires_in")
            )

        new_refresh = response.get("refreshToken")
        if new_refresh:
            self._refresh_token = new_refresh
            self._refresh_token_expires_at = _expires_at(
                now, response.get("refresh_token_expires_in")
            )

    def _is_access_token_valid(self) -> bool:
        if not self._access_token:
            return False
        if self._access_token_expires_at is None:
            return True
        return datetime.now(timezone.utc) < self._access_token_expires_at - EXPIRY_BUFFER

    def _is_refresh_token_valid(self) -> bool:
        if not self._refresh_token:
            return False
        if self._refresh_token_expires_at is None:
            return True
        return datetime.now(timezone.utc) < self._refresh_token_expires_at - EXPIRY_BUFFER
