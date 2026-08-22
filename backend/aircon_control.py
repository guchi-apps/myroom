"""白くまくん（AirCloud Home）へエアコンの運転指示を送る。

**AirCloud Home を叩く場所は、これで3つ目になる。**

| 何を | 動かす場所 | 寿命 |
|---|---|---|
| 運転状態の取り込み（5分ごと） | ラズパイ（`guchi-apps/pi0w_260719`） | 1回動いて終わる |
| 日別の電気代（1時間ごと） | サブPC（`collectors/`） | 1回動いて終わる |
| **運転の操作（このモジュール）** | **VPS（常駐のAPIサーバー）** | **プロセスが生きている間ずっと** |

**寿命が違うので、`collectors/aircloudhome_client.py` をそのまま使い回さない。** 向こうは
1回動いて終わるスクリプトなので毎回サインインしてよいが、こちらはリクエストのたびに
サインインするとすぐレート制限（429）に当たる。トークンをプロセス内で持ち回し、
ロックで直列化する必要がある。

**資格情報（`AIRCON_EMAIL` / `AIRCON_PASSWORD`）が無ければ操作機能ごと無効になる。**
`is_configured()` が False を返し、画面は操作パネルを出さない。本番VPSの `.env` に
入れるまでは表示だけの状態が続く（#213）。
"""

from __future__ import annotations

import datetime
import logging
import os
import threading
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv

from . import database

load_dotenv()

logger = logging.getLogger(__name__)

#: 白くまくん（国内向け）のホスト。海外向けは `api-global-prod.aircloudhome.com` で別物。
BASE_URL = "https://api-kuma.aircloudhome.com"

#: アプリのUAでしか通らないエンドポイントがあるため、Home Assistant統合と同じ値を送る。
USER_AGENT = "okhttp/4.9.1"

#: 運転指示のHTTPメソッド。**POST は 405 を返す**（#213で実機確認）。
CONTROL_METHOD = "put"

#: アクセストークンの期限がこの秒数以内に迫ったら取り直す。
EXPIRY_BUFFER = datetime.timedelta(seconds=60)

#: 429 のときに `Retry-After` が無かった場合に画面へ出す待ち時間。
DEFAULT_RETRY_AFTER_SEC = 300

#: 1リクエストの制限時間。画面が固まらないよう短めに切る。
TIMEOUT_SEC = 15

#: 運転モード。`AIRCON_MODE_LABELS`（frontend/lib/types.ts）と対応する。
#: `DRY_COOL`（除湿冷房）は機種によっては返るが、こちらから指定はできないので操作の選択肢に入れない。
MODES = ("COOLING", "HEATING", "DRY", "FAN", "AUTO")

#: 風量。`LV1` が「静」で、数字が上がるほど強い。
FAN_SPEEDS = ("AUTO", "LV1", "LV2", "LV3", "LV4")

#: 風向。**実機が返すのは `VERTICAL`**（#213で確認）。`AUTO` は返ってこない。
#: 画面は「自動（振る）＝VERTICAL」と「固定＝OFF」の2択にしているが、機種によって
#: 他の値を返しうるので、受け取る側は広く許す。
FAN_SWINGS = ("OFF", "VERTICAL", "HORIZONTAL", "BOTH", "AUTO")

#: 画面の「自動（振る）」が送る値。
DEFAULT_FAN_SWING = "VERTICAL"

#: 運転指示のパス。**`general-control-command` ではなく末尾に `-status` が付く。**
#: `-status` の無いパスは PUT を受けるが 400 で弾かれる（#213で実機確認）。
CONTROL_PATH = "rac/basic-idu-control/general-control-command-status"

#: 運転指示に載せるフィールド。**この7つだけ。**
#:
#: `idu-list` の応答をそのまま送り返しても通らない。`humidity` は数値ではなく
#: **文字列**で送る。
CONTROL_BODY_FIELDS = (
    "power",
    "mode",
    "fanSpeed",
    "fanSwing",
    "humidity",
    "iduTemperature",
    "relativeTemperature",
)

#: `humidity` に送る値。
#:
#: **`idu-list` が返した値（50）をそのまま送り返すと `INVALID_HUMIDITY` で弾かれる**
#: （#213で実機確認）。湿度はMyRoomの操作対象ではないので、常にこの値を送る。
#: 参照実装（svmironov/aircloud_ha）も、湿度を扱わないときは同じ値を送っている。
CONTROL_HUMIDITY = "0"

POWERS = ("ON", "OFF")

MIN_TEMPERATURE = 16.0
MAX_TEMPERATURE = 32.0
TEMPERATURE_STEP = 0.5

#: 自動運転のときの `iduTemperature` は設定温度ではなく室温からのシフト量で、この範囲に収まる。
#: `AIRCON_AUTO_TARGET_OFFSET_LIMIT`（backend/main.py）と同じ値。
AUTO_TARGET_OFFSET_LIMIT = 5.0


class AirconControlError(Exception):
    """操作に失敗した。画面にはこのメッセージをそのまま出す。"""


class AirconControlNotConfigured(AirconControlError):
    """資格情報が設定されていない。"""


class AirconControlAuthError(AirconControlError):
    """サインイン・トークン更新に失敗した。"""


class AirconControlRateLimited(AirconControlError):
    """レート制限（429）に当たった。"""

    def __init__(self, retry_after_sec: int) -> None:
        super().__init__("混み合っています。しばらく待ってからもう一度お試しください")
        self.retry_after_sec = retry_after_sec


class AirconUnitNotFound(AirconControlError):
    """指定した室外機が AirCloud Home 側に見つからない。"""


def is_configured() -> bool:
    """操作機能を出してよいか。資格情報が無ければ False。"""
    if database.DB_MOCK:
        return True
    return bool(os.getenv("AIRCON_EMAIL") and os.getenv("AIRCON_PASSWORD"))


# --- 送る値の検証 -----------------------------------------------------------


def normalize_temperature(value: Any) -> float:
    """設定温度を 0.5 刻みに丸める。**範囲の検証はここではしない。**

    自動運転のときの `iduTemperature` は設定温度そのものではなく室温からのシフト量
    （-5.0〜+5.0）なので、許される範囲が運転モードによって変わる。モードが確定するのは
    現在値と混ぜたあとなので、範囲は `validate_target_temperature()` で見る。
    """
    try:
        temperature = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("設定温度は数値で指定してください") from exc
    return round(temperature / TEMPERATURE_STEP) * TEMPERATURE_STEP


def validate_target_temperature(mode: str, value: Any) -> float:
    """運転モードに応じて設定温度の範囲を見る。

    自動運転はシフト量（-5.0〜+5.0）、それ以外は 16〜32℃。
    `AIRCON_AUTO_TARGET_OFFSET_LIMIT`（backend/main.py）と同じ考え方。
    """
    temperature = normalize_temperature(value)

    if str(mode).upper() == "AUTO":
        if abs(temperature) > AUTO_TARGET_OFFSET_LIMIT:
            raise ValueError(
                f"自動運転の温度シフトは-{AUTO_TARGET_OFFSET_LIMIT:.0f}〜"
                f"+{AUTO_TARGET_OFFSET_LIMIT:.0f}℃の範囲で指定してください"
            )
        return temperature

    if temperature < MIN_TEMPERATURE or temperature > MAX_TEMPERATURE:
        raise ValueError(
            f"設定温度は{MIN_TEMPERATURE:.0f}〜{MAX_TEMPERATURE:.0f}℃の範囲で指定してください"
        )
    return temperature


def normalize_choice(value: Any, allowed: tuple, label: str) -> str:
    text = str(value or "").strip().upper()
    if text not in allowed:
        raise ValueError(f"{label}に指定できない値です: {value}")
    return text


def normalize_command(command: Dict[str, Any]) -> Dict[str, Any]:
    """画面から届いた指示を、送ってよい形へ整える。

    **指定されなかった項目は触らない。** 部分更新として扱い、送信の直前に
    エアコンの現在値と混ぜて完全な指示にする（AirCloud Home は全項目を要求するため）。
    """
    normalized: Dict[str, Any] = {}

    if command.get("power") is not None:
        normalized["power"] = normalize_choice(command["power"], POWERS, "電源")
    if command.get("mode") is not None:
        normalized["mode"] = normalize_choice(command["mode"], MODES, "運転モード")
    if command.get("target_temperature") is not None:
        normalized["target_temperature"] = normalize_temperature(
            command["target_temperature"]
        )
    if command.get("fan_speed") is not None:
        normalized["fan_speed"] = normalize_choice(
            command["fan_speed"], FAN_SPEEDS, "風量"
        )
    if command.get("fan_swing") is not None:
        normalized["fan_swing"] = normalize_choice(
            command["fan_swing"], FAN_SWINGS, "風向"
        )

    if not normalized:
        raise ValueError("変更する項目がありません")
    return normalized


#: 自動運転から他のモードへ切り替えたとき、温度の指定が無ければこの値から始める。
DEFAULT_TARGET_TEMPERATURE = 26.0


def merge_command(
    current: Dict[str, Any], command: Dict[str, Any]
) -> Dict[str, Any]:
    """部分更新を現在値と混ぜて、送ってよい完全な指示にする。

    **自動運転とそれ以外では `target_temperature` の意味が違う**（自動はシフト量、
    それ以外は設定温度）。モードだけを切り替えたときに前のモードの数値が残ると
    範囲外になるので、温度の指定が無い切り替えでは既定値に置き換える。
    """
    desired = {**current, **command}

    was_auto = str(current.get("mode") or "").upper() == "AUTO"
    is_auto = str(desired.get("mode") or "").upper() == "AUTO"
    if was_auto != is_auto and "target_temperature" not in command:
        desired["target_temperature"] = 0.0 if is_auto else DEFAULT_TARGET_TEMPERATURE

    if desired.get("target_temperature") is not None:
        desired["target_temperature"] = validate_target_temperature(
            desired.get("mode") or "", desired["target_temperature"]
        )
    return desired


# --- AirCloud Home のクライアント -------------------------------------------


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


def build_state(raw: Dict[str, Any]) -> Dict[str, Any]:
    """`idu-list` の1件を、画面とDBが使っているキー名へ寄せる。

    キー名は `AirconRecord`（`backend/database.py`）・`AirconData`（frontend/lib/types.ts）と
    同じにする。取り込み側（ラズパイ）が送ってくる形と揃えておかないと、操作の直後だけ
    別の形が画面に流れることになる。
    """
    return {
        "ac_id": _as_int(raw.get("id")),
        "name": str(raw.get("name") or ""),
        "power": str(raw.get("power") or "OFF").upper(),
        "mode": str(raw.get("mode") or "UNKNOWN").upper(),
        "room_temperature": _as_float(raw.get("roomTemperature")),
        "target_temperature": _as_float(raw.get("iduTemperature")),
        "humidity": _as_int(raw.get("humidity")),
        "fan_speed": str(raw.get("fanSpeed") or "AUTO").upper(),
        "fan_swing": str(raw.get("fanSwing") or "AUTO").upper(),
        "online": bool(raw.get("online", False)),
        "model": raw.get("model"),
    }


class AirCloudControlClient:
    """サインインとトークン更新を抱えたまま常駐するクライアント。

    **1インスタンスをプロセス全体で使い回す。** `get_client()` から取る。
    """

    def __init__(self, email: str, password: str) -> None:
        self._email = email
        self._password = password
        self._session = requests.Session()
        self._lock = threading.Lock()
        self._access_token: Optional[str] = None
        self._refresh_token: Optional[str] = None
        self._access_token_expires_at: Optional[datetime.datetime] = None
        self._refresh_token_expires_at: Optional[datetime.datetime] = None

    # --- 公開API ----------------------------------------------------------

    def list_states(self) -> List[Dict[str, Any]]:
        """全室外機の**いまの**運転状態。DBではなくAirCloud Homeから直接読む。"""
        with self._lock:
            return [build_state(raw) for raw in self._fetch_idu_list()]

    def get_state(self, ac_id: int) -> Dict[str, Any]:
        with self._lock:
            return build_state(self._find_raw_unit(ac_id))

    def send_command(self, ac_id: int, command: Dict[str, Any]) -> Dict[str, Any]:
        """部分更新を、いまの状態と混ぜて送る。返すのは送信後の想定状態。

        **AirCloud Home は全項目を含む指示しか受け付けない。** 温度だけ変えたつもりでも、
        モードや風量を落とすと機器側の既定値へ戻る。そのため送信の直前に必ず現在値を引く。
        """
        with self._lock:
            raw = self._find_raw_unit(ac_id)
            desired = merge_command(build_state(raw), command)
            self._post_command(raw, desired)
            return desired

    # --- 内部 -------------------------------------------------------------

    def _find_raw_unit(self, ac_id: int) -> Dict[str, Any]:
        for raw in self._fetch_idu_list():
            if _as_int(raw.get("id")) == ac_id:
                return raw
        raise AirconUnitNotFound(f"エアコン（ID:{ac_id}）が見つかりません")

    def _fetch_idu_list(self) -> List[Dict[str, Any]]:
        self._ensure_valid_token()
        units: List[Dict[str, Any]] = []
        for family_id in self._family_ids():
            response = self._request(
                "get",
                "{}/rac/ownership/groups/{}/idu-list".format(BASE_URL, family_id),
                headers=self._auth_headers(),
            )
            for raw in response or []:
                entry = dict(raw)
                entry["_familyId"] = family_id
                units.append(entry)

        return units

    def _family_ids(self) -> List[int]:
        response = self._request(
            "get",
            "{}/iam/family-account/v2/groups".format(BASE_URL),
            headers=self._auth_headers(),
        )
        family_ids: List[int] = []
        for family in (response or {}).get("result", []):
            family_id = _as_int(family.get("familyId"))
            if family_id is not None:
                family_ids.append(family_id)
        return family_ids

    def _post_command(self, raw: Dict[str, Any], desired: Dict[str, Any]) -> None:
        """運転指示を1回送る。

        **この関数だけが AirCloud Home の操作APIの形を知っている。** 公開仕様が無く、
        機種やアプリの更新で変わりうるため、変える必要が出たらここだけを直せばよいようにしてある。
        """
        idu_id = _as_int(raw.get("id"))
        if idu_id is None:
            raise AirconUnitNotFound("エアコンの識別子を取得できませんでした")

        family_id = raw.get("_familyId")
        if family_id is None:
            raise AirconUnitNotFound("エアコンの所属（familyId）を取得できませんでした")

        url = "{}/{}/{}".format(BASE_URL, CONTROL_PATH, idu_id)
        # **クエリは familyId。** vendorThingId / timeZone を渡しても通らず、
        # 理由の書かれていない 400 になる（#213で実機確認）
        self._request(
            CONTROL_METHOD,
            url,
            params={"familyId": family_id},
            json=build_command_body(raw, desired),
            headers=self._auth_headers(),
        )

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
            json={"email": self._email, "password": self._password},
            headers={"User-Agent": USER_AGENT},
            retry_on_auth=False,
        )
        self._store_tokens(response or {})

    def _refresh_token_request(self) -> None:
        if not self._refresh_token:
            raise AirconControlAuthError("ログイン情報を確認できませんでした")
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
        self._store_tokens(response or {})

    def _request(
        self,
        method: str,
        url: str,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        retry_on_auth: bool = True,
    ) -> Any:
        try:
            response = self._session.request(
                method=method,
                url=url,
                params=params,
                json=json,
                headers=headers,
                timeout=TIMEOUT_SEC,
            )
        except requests.RequestException as exc:
            logger.warning("AirCloud Home request failed: %s", exc)
            raise AirconControlError("エアコンにつながりませんでした") from exc

        if response.status_code == 429:
            raise AirconControlRateLimited(
                _retry_after_seconds(response.headers.get("Retry-After"))
            )

        if response.status_code in (401, 403):
            if retry_on_auth:
                # トークン切れとみなして取り直し、1度だけやり直す
                self._access_token = None
                self._ensure_valid_token()
                retry_headers = dict(headers or {})
                retry_headers["Authorization"] = "Bearer {}".format(self._access_token)
                return self._request(
                    method,
                    url,
                    params=params,
                    json=json,
                    headers=retry_headers,
                    retry_on_auth=False,
                )
            raise AirconControlAuthError("ログイン情報を確認できませんでした")

        if response.status_code >= 400:
            # 理由は応答本文の `stackTrace`（`INVALID_HUMIDITY` など）に入る。
            # ここを残さないと、400 の切り分けが実機での試行錯誤になる（#213）
            logger.warning(
                "AirCloud Home returned %s for %s: %s",
                response.status_code,
                url,
                (response.text or "")[:300],
            )
            raise AirconControlError("エアコンが指示を受け付けませんでした")

        if not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            return None

    def _store_tokens(self, response: Dict[str, Any]) -> None:
        now = datetime.datetime.now(datetime.timezone.utc)
        self._access_token = response.get("token") or response.get("accessToken")
        self._refresh_token = response.get("refreshToken")
        self._access_token_expires_at = _expires_at(now, response.get("expiresIn"))
        self._refresh_token_expires_at = _expires_at(
            now, response.get("refreshTokenExpiresIn")
        )
        if not self._access_token:
            raise AirconControlAuthError("ログイン情報を確認できませんでした")

    def _is_access_token_valid(self) -> bool:
        if not self._access_token:
            return False
        if self._access_token_expires_at is None:
            return True
        now = datetime.datetime.now(datetime.timezone.utc)
        return now + EXPIRY_BUFFER < self._access_token_expires_at

    def _is_refresh_token_valid(self) -> bool:
        if not self._refresh_token:
            return False
        if self._refresh_token_expires_at is None:
            return True
        now = datetime.datetime.now(datetime.timezone.utc)
        return now + EXPIRY_BUFFER < self._refresh_token_expires_at


def build_command_body(raw: Dict[str, Any], desired: Dict[str, Any]) -> Dict[str, Any]:
    """運転指示のリクエストボディ。

    **`CONTROL_BODY_FIELDS` の7項目だけを送る。** `idu-list` の応答をそのまま送り返しても
    400 で弾かれる（#213で実機確認）。指定しなかった項目は現在値を載せる——送らないと
    機器側の既定へ戻るため、部分的な指示にはできない。

    **自動運転かどうかで温度の入れ先が変わる。** `iduTemperature` は設定温度そのもので、
    室温からのシフト量は `relativeTemperature` に入る。MyRoom は画面もDBも
    `target_temperature` 1つで扱っている（自動運転のときだけシフト量が入る)ので、
    ここで振り分ける。
    """
    is_auto = str(desired.get("mode") or "").upper() == "AUTO"
    target = desired.get("target_temperature")

    if is_auto:
        # 自動運転で画面が動かしているのはシフト量。設定温度は機器の値をそのまま返す
        idu_temperature = _as_float(raw.get("iduTemperature")) or 0.0
        relative_temperature = target if target is not None else 0.0
    else:
        idu_temperature = target if target is not None else _as_float(
            raw.get("iduTemperature")
        )
        relative_temperature = 0.0

    return {
        "power": desired["power"],
        "mode": desired["mode"],
        "fanSpeed": desired["fan_speed"],
        "fanSwing": desired["fan_swing"],
        # 数値ではなく文字列。読み取った値を返すと INVALID_HUMIDITY になる
        "humidity": CONTROL_HUMIDITY,
        "iduTemperature": idu_temperature,
        "relativeTemperature": relative_temperature,
    }


_client: Optional[AirCloudControlClient] = None
_client_lock = threading.Lock()


def get_client() -> AirCloudControlClient:
    """プロセスで1つだけのクライアント。トークンを使い回すために共有する。"""
    global _client
    email = os.getenv("AIRCON_EMAIL", "")
    password = os.getenv("AIRCON_PASSWORD", "")
    if not email or not password:
        raise AirconControlNotConfigured(
            "エアコンのログイン情報が設定されていません"
        )

    with _client_lock:
        if _client is None or _client._email != email:
            _client = AirCloudControlClient(email, password)
        return _client


def reset_client() -> None:
    """テスト用。次の `get_client()` で作り直させる。"""
    global _client
    with _client_lock:
        _client = None


# --- モック（DB_MOCK=true） -------------------------------------------------


def _mock_state(ac_id: int) -> Dict[str, Any]:
    payload = database.generate_mock_aircon_latest(ac_id)
    return {
        "ac_id": ac_id,
        "name": payload.get("name"),
        "power": payload.get("power"),
        "mode": payload.get("mode"),
        "room_temperature": payload.get("room_temperature"),
        "target_temperature": payload.get("target_temperature"),
        "humidity": payload.get("humidity"),
        "fan_speed": payload.get("fan_speed"),
        "fan_swing": payload.get("fan_swing"),
        "online": payload.get("online"),
        "model": payload.get("model"),
    }


# --- 画面から使う入口 -------------------------------------------------------


def get_state(ac_id: int) -> Dict[str, Any]:
    """いまの運転状態。DBの最新記録ではなく、エアコンから直接読む。"""
    if database.DB_MOCK:
        return _mock_state(ac_id)
    return get_client().get_state(ac_id)


def apply_command(ac_id: int, command: Dict[str, Any]) -> Dict[str, Any]:
    """運転指示を送り、送信後の状態を返す。`command` は部分更新でよい。"""
    normalized = normalize_command(command)

    if database.DB_MOCK:
        desired = merge_command(_mock_state(ac_id), normalized)
        database.set_mock_aircon_override(
            ac_id,
            {
                key: desired[key]
                for key in (
                    "power",
                    "mode",
                    "target_temperature",
                    "fan_speed",
                    "fan_swing",
                )
            },
        )
        return _mock_state(ac_id)

    return get_client().send_command(ac_id, normalized)
