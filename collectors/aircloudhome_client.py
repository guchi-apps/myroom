"""AirCloud Home（白くまくんアプリ）のクラウドAPIから、日別の電力使用量を取る。

**このクライアントは電気代の取得だけを持つ。** エアコンの運転状態（`/api/aircon` へ送るぶん）は
ラズパイ側（`guchi-apps/pi0w_260719` の `myroom-api/aircloudhome_client.py`）が引き続き担当する。
同じことを2箇所に置かないよう、`idu-list` は移植していない。

依存は `requests` だけにしてある。サブPCのシステムPythonに最初から入っており、venvを別に
用意しなくても systemd timer から動かせるため（`python-dotenv` は入っていないので使わない）。
"""

from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional

import requests

#: 白くまくん（国内向け）のホスト。海外向けは `api-global-prod.aircloudhome.com` で別物。
BASE_URL = "https://api-kuma.aircloudhome.com"

#: エネルギー取得APIはアプリのUAでしか通らない可能性があるため、Home Assistant統合と同じ値を送る。
USER_AGENT = "okhttp/4.9.1"

#: アクセストークンの期限がこの秒数以内に迫ったら取り直す。
EXPIRY_BUFFER = datetime.timedelta(seconds=60)

#: 429 のときに `Retry-After` が無かった場合の待ち時間（Home Assistant統合と同じ）。
DEFAULT_RETRY_AFTER_SEC = 1800


class AirCloudHomeError(Exception):
    """AirCloud Home API の呼び出しが失敗した。"""


class AirCloudHomeAuthError(AirCloudHomeError):
    """認証・トークン更新に失敗した。"""


class AirCloudHomeRateLimitError(AirCloudHomeError):
    """レート制限（429）に当たった。次回の実行まで待つ。"""

    def __init__(self, retry_after_sec: int) -> None:
        super().__init__(
            "Rate limited by AirCloud Home; retry after {}s".format(retry_after_sec)
        )
        self.retry_after_sec = retry_after_sec


def _expires_at(now: datetime.datetime, expires_ms: Any) -> Optional[datetime.datetime]:
    if expires_ms is None:
        return None
    try:
        return now + datetime.timedelta(seconds=float(expires_ms) / 1000.0)
    except (TypeError, ValueError):
        return None


def _retry_after_seconds(value: Optional[str]) -> int:
    if not value:
        return DEFAULT_RETRY_AFTER_SEC
    try:
        return max(int(float(value)), 1)
    except (TypeError, ValueError):
        return DEFAULT_RETRY_AFTER_SEC


class AirCloudHomeClient:
    def __init__(self, email: str, password: str, timeout: int = 30) -> None:
        self.email = email
        self.password = password
        self.timeout = timeout
        self._session = requests.Session()
        self._access_token: Optional[str] = None
        self._refresh_token: Optional[str] = None
        self._access_token_expires_at: Optional[datetime.datetime] = None
        self._refresh_token_expires_at: Optional[datetime.datetime] = None

    def close(self) -> None:
        self._session.close()

    def __enter__(self) -> "AirCloudHomeClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    # --- 公開API ------------------------------------------------------------

    def get_family_ids(self) -> List[int]:
        """アカウントに紐づく family（設置場所のまとまり）のIDを返す。"""
        self._ensure_valid_token()
        response = self._request(
            "get",
            "{}/iam/family-account/v2/groups".format(BASE_URL),
            headers=self._auth_headers(),
        )
        family_ids = []
        for family in response.get("result", []):
            family_id = family.get("familyId")
            if family_id:
                family_ids.append(int(family_id))
        return family_ids

    def get_energy_summary(
        self,
        family_id: int,
        date_from: datetime.date,
        date_to: datetime.date,
    ) -> Dict[str, Any]:
        """指定期間の使用量をまとめて返す。

        **`from`/`to` に同じ日を渡すと、その1日ぶんの合計になる。** 期間ぶんの合計しか返らず
        日別の内訳は入らないため、日別が要るなら日付ごとに呼ぶ（呼び出し側の責務）。
        """
        self._ensure_valid_token()
        return self._request(
            "post",
            "{}/rac/energy-consumptions/summary/v3?familyId={}".format(BASE_URL, family_id),
            json={"from": date_from.isoformat(), "to": date_to.isoformat()},
            headers=self._auth_headers(),
        )

    # --- 内部 ---------------------------------------------------------------

    def _auth_headers(self) -> Dict[str, str]:
        return {
            "Authorization": "Bearer {}".format(self._access_token),
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        }

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
            headers={"User-Agent": USER_AGENT},
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
                "User-Agent": USER_AGENT,
            },
            retry_on_auth=False,
        )
        self._store_tokens(response)

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

        if response.status_code == 429:
            raise AirCloudHomeRateLimitError(
                _retry_after_seconds(response.headers.get("Retry-After"))
            )

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
        now = datetime.datetime.now(datetime.timezone.utc)

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
        now = datetime.datetime.now(datetime.timezone.utc)
        return now < self._access_token_expires_at - EXPIRY_BUFFER

    def _is_refresh_token_valid(self) -> bool:
        if not self._refresh_token:
            return False
        if self._refresh_token_expires_at is None:
            return True
        now = datetime.datetime.now(datetime.timezone.utc)
        return now < self._refresh_token_expires_at - EXPIRY_BUFFER
