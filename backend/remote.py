"""Nature Remo に登録済みのリモコン操作（赤外線の signal）を送る。

**照明やエアコンの状態は一切持たない。** 赤外線は片方向で、機器が受け取ったかどうかは
返ってこないため、状態を持つと画面と部屋の実態が必ずずれる。物理リモコンと同じく
「押したら飛ぶだけ」に揃えることで、状態の同期・Cloud API のレート制限（30回/5分）・
バックエンドでのポーリングがまとめて不要になる（#106）。

どのボタンを出すかは data/remote.json に手で書く。センサーのように外から届く値ではないので
DB は使わず、data/garbage.json と同じくファイルのみを正とする。

**ただし画面に出す名前と、ダッシュボードに出すかどうかは上書きできる**（#260）。
上書きの中身は UI 設定（`backend/ui_settings.py` の `remote_buttons`）が持ち、
このモジュールは受け取って被せるだけ。remote.json 側は書き換えない——本番のファイルを
画面から書き換えると、リポジトリで管理している定義と食い違うため。
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).resolve().parent.parent / "data" / "remote.json"

ENV_TOKEN = "NATURE_REMO_TOKEN"

API_BASE = "https://api.nature.global"
#: 押してから返るまで。赤外線が飛ぶだけなので長く待つ意味はない
SEND_TIMEOUT_SECONDS = 10
#: scripts/list-remo-signals.py で一覧を取るときだけ使う
APPLIANCES_TIMEOUT_SECONDS = 15


class RemoteError(Exception):
    """利用者へそのまま見せる文言と、HTTP のステータスを持つ送信エラー。"""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _normalize_button(raw: Any, group_id: str, index: int) -> Optional[Dict[str, Any]]:
    """ボタン1つぶん。押し方は signal と light の2通りある。

    Nature Remo に「照明」として登録した機器は生の signal を持たず、専用の
    `POST /1/appliances/{id}/light` でしか押せない（`GET /1/appliances` の
    `signals` が空になる）。部屋の電気はこの登録になっていることが多いため、
    signal だけでは肝心の照明を出せない。
    """
    if not isinstance(raw, dict):
        return None

    label = str(raw.get("label") or "").strip()
    if not label:
        return None

    button_id = str(raw.get("id") or "").strip() or f"{group_id}-{index + 1}"

    signal_id = str(raw.get("signal_id") or "").strip()
    if signal_id:
        return {"id": button_id, "label": label, "kind": "signal", "signal_id": signal_id}

    appliance_id = str(raw.get("appliance_id") or "").strip()
    light_button = str(raw.get("button") or "").strip()
    if appliance_id and light_button:
        return {
            "id": button_id,
            "label": label,
            "kind": "light",
            "appliance_id": appliance_id,
            "button": light_button,
        }

    return None


def _normalize_group(raw: Any, index: int, used_button_ids: set) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    name = str(raw.get("name") or "").strip()
    if not name:
        return None

    group_id = str(raw.get("id") or "").strip() or f"group{index + 1}"

    buttons: List[Dict[str, Any]] = []
    for button_index, entry in enumerate(raw.get("buttons") or []):
        button = _normalize_button(entry, group_id, button_index)
        if button is None:
            continue
        # ボタンIDは送信APIのパスになる。重複していると押した先が定まらないため後勝ちにせず落とす
        if button["id"] in used_button_ids:
            logger.warning("Duplicate remote button id: %s", button["id"])
            continue
        used_button_ids.add(button["id"])
        buttons.append(button)

    if not buttons:
        return None

    return {"id": group_id, "name": name, "buttons": buttons}


def _normalize_config(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return {"groups": []}

    used_button_ids: set = set()
    groups = [
        group
        for group in (
            _normalize_group(entry, index, used_button_ids)
            for index, entry in enumerate(raw.get("groups") or [])
        )
        if group
    ]
    return {"groups": groups}


def load_config() -> Dict[str, Any]:
    """ボタン定義を読み込む。ファイルが無い・壊れている場合は未設定として扱う。"""
    if not CONFIG_PATH.exists():
        return {"groups": []}

    try:
        with CONFIG_PATH.open(encoding="utf-8") as f:
            return _normalize_config(json.load(f))
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        logger.warning("Failed to read %s; treating remote buttons as unconfigured", CONFIG_PATH)
        return {"groups": []}


def get_token() -> str:
    return os.getenv(ENV_TOKEN, "").strip()


def _override_for(overrides: Optional[Dict[str, Any]], button_id: str) -> Dict[str, Any]:
    """ボタン1つぶんの上書き。設定が無い・壊れている場合は空として扱う。"""
    if not isinstance(overrides, dict):
        return {}
    entry = overrides.get(button_id)
    return entry if isinstance(entry, dict) else {}


def resolve_label(button: Dict[str, Any], overrides: Optional[Dict[str, Any]] = None) -> str:
    """画面に出す名前。付けた名前が空なら remote.json の名前へ戻る。"""
    label = str(_override_for(overrides, button["id"]).get("label") or "").strip()
    return label or button["label"]


def build_payload(overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """ダッシュボードの「電気の操作」カード用のペイロード。

    signal ID は画面へ出さない。押すのはボタンIDで足り、外へ出す値は少ないほどよい。

    `hidden` のボタンもグループごと落とさずに返す。設定画面が「隠したボタン」も含めた
    一覧を出す必要があり、そのためだけに別のエンドポイントを増やしたくないため。
    ダッシュボードに出さない判断は受け取った側で行う。
    """
    config = load_config()
    return {
        "configured": bool(config["groups"]),
        "groups": [
            {
                "id": group["id"],
                "name": group["name"],
                "buttons": [
                    {
                        "id": button["id"],
                        "label": resolve_label(button, overrides),
                        # 設定画面で「もとの名前」を出すために添える
                        "default_label": button["label"],
                        "hidden": bool(_override_for(overrides, button["id"]).get("hidden")),
                    }
                    for button in group["buttons"]
                ],
            }
            for group in config["groups"]
        ],
    }


def find_button(button_id: str) -> Optional[Dict[str, Any]]:
    """ボタンIDから、送信に必要な signal ID とグループ名まで含めて引く。"""
    for group in load_config()["groups"]:
        for button in group["buttons"]:
            if button["id"] == button_id:
                return {**button, "group_id": group["id"], "group_name": group["name"]}
    return None


def _post(path: str, data: Optional[Dict[str, str]] = None) -> None:
    """Nature Remo Cloud API へ送信を依頼する。成功なら何も返さない。"""
    token = get_token()
    if not token:
        raise RemoteError(503, "Nature Remo のトークンが設定されていません")

    try:
        response = requests.post(
            f"{API_BASE}{path}",
            headers={"Authorization": f"Bearer {token}"},
            data=data,
            timeout=SEND_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.warning("Failed to reach Nature Remo: %s", exc)
        raise RemoteError(502, "Nature Remo につながりませんでした") from None

    if response.status_code in (200, 201, 204):
        return

    if response.status_code == 401:
        raise RemoteError(502, "Nature Remo のトークンが無効です")
    if response.status_code in (400, 404):
        raise RemoteError(502, "Nature Remo にこの操作が見つかりませんでした")
    if response.status_code == 429:
        raise RemoteError(429, "Nature Remo の送信回数の上限に達しました。しばらく待ってからお試しください")

    logger.warning(
        "Nature Remo returned %s for %s: %s",
        response.status_code,
        path,
        response.text[:200],
    )
    raise RemoteError(502, "Nature Remo が送信を受け付けませんでした")


def send_signal(signal_id: str) -> None:
    _post(f"/1/signals/{signal_id}/send")


def send_light_button(appliance_id: str, button: str) -> None:
    _post(f"/1/appliances/{appliance_id}/light", {"button": button})


def press(button_id: str, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """ボタンIDを押す。押した結果は「送信を依頼できたか」までしか分からない。

    隠したボタンでも押せる。隠すのは「ダッシュボードに出さない」という表示の話で、
    ボタンそのものを消したわけではないため。
    """
    button = find_button(button_id)
    if button is None:
        raise RemoteError(404, "そのボタンは登録されていません")

    if button["kind"] == "light":
        send_light_button(button["appliance_id"], button["button"])
    else:
        send_signal(button["signal_id"])

    return {
        "sent": True,
        "button_id": button["id"],
        # 「◯◯を送りました」に出るのはユーザーが付けた名前
        "label": resolve_label(button, overrides),
        "group_name": button["group_name"],
    }


def fetch_appliances() -> List[Dict[str, Any]]:
    """登録済みアプライアンスと signal を取る。data/remote.json を書くときだけ使う。

    ダッシュボードの表示では叩かない（押したときしか外部APIへ出ない、が #106 の設計）。
    """
    token = get_token()
    if not token:
        raise RemoteError(503, "Nature Remo のトークンが設定されていません")

    try:
        response = requests.get(
            f"{API_BASE}/1/appliances",
            headers={"Authorization": f"Bearer {token}"},
            timeout=APPLIANCES_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.warning("Failed to reach Nature Remo: %s", exc)
        raise RemoteError(502, "Nature Remo につながりませんでした") from None

    if response.status_code == 401:
        raise RemoteError(502, "Nature Remo のトークンが無効です")
    if response.status_code != 200:
        raise RemoteError(502, "Nature Remo がアプライアンス一覧を返しませんでした")

    data = response.json()
    return data if isinstance(data, list) else []
