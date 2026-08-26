"""Nature Remo に登録済みのリモコン操作（赤外線の signal）を送る。

**照明やエアコンの状態は一切持たない。** 赤外線は片方向で、機器が受け取ったかどうかは
返ってこないため、状態を持つと画面と部屋の実態が必ずずれる。物理リモコンと同じく
「押したら飛ぶだけ」に揃えることで、状態の同期・Cloud API のレート制限（30回/5分）・
バックエンドでのポーリングがまとめて不要になる（#106）。

どのボタンを出すかは **DB（`app_settings` の `remote_button_defs`）が正**（#262）。
画面（設定 →「ダッシュボードの表示」→「電気の操作」の編集）から、Nature Remo に
登録済みの操作を選んで登録する。data/remote.json は「まだ一度も保存していないとき」に
読む初期値としてだけ残っている——デプロイの rsync がリポジトリの空ファイルで本番を
上書きするため、ファイルを正にすると画面から書いても次のデプロイで消える。

**画面に出す名前と、ダッシュボードに出すかどうかは別レイヤで上書きする**（#260）。
上書きの中身は UI 設定（`backend/ui_settings.py` の `remote_buttons`）が持ち、
このモジュールは受け取って被せるだけ。定義側の名前（Nature Remo 側の名前）は残るので、
付けた名前を消せばいつでも戻せる。
"""

from __future__ import annotations

import datetime
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

from . import ui_settings

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).resolve().parent.parent / "data" / "remote.json"

ENV_TOKEN = "NATURE_REMO_TOKEN"

API_BASE = "https://api.nature.global"
#: 押してから返るまで。赤外線が飛ぶだけなので長く待つ意味はない
SEND_TIMEOUT_SECONDS = 10
#: 登録できる操作の一覧を取るときだけ使う（画面の「読み込み直す」と scripts/list-remo-signals.py）
APPLIANCES_TIMEOUT_SECONDS = 15

#: エアコンとして登録された機器の案内。個別の設定APIでしか動かせず、このカードでは押せない
AC_NOT_SUPPORTED_NOTE = (
    "エアコンとして登録された機器は、このカードでは押せません"
    "（Nature Remo アプリで「その他」として登録し直すと選べるようになります）"
)
#: 押せる操作が1つも無い機器の案内
NO_BUTTON_NOTE = "押せる操作が登録されていません"


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


def normalize_config(raw: Any) -> Dict[str, Any]:
    """外から来た定義を、保存してよい形にそろえる（押し方の無いボタンは落とす）。"""
    return _normalize_config(raw)


def load_file_config() -> Dict[str, Any]:
    """data/remote.json の定義。DB にまだ何も保存されていないときの初期値（#262）。

    ファイルが無い・壊れている場合は未設定として扱う。
    """
    if not CONFIG_PATH.exists():
        return {"groups": []}

    try:
        with CONFIG_PATH.open(encoding="utf-8") as f:
            return _normalize_config(json.load(f))
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        logger.warning("Failed to read %s; treating remote buttons as unconfigured", CONFIG_PATH)
        return {"groups": []}


def load_config(db: Optional[Any] = None) -> Dict[str, Any]:
    """ボタン定義を読み込む。DB が正で、まだ一度も保存していなければ remote.json を読む。

    **「全部消して保存した」と「まだ保存していない」は区別する。** 前者は
    `{"groups": []}` が保存されているので remote.json へは戻らない。戻すと、
    画面から消したボタンがデプロイのたびに復活する。
    """
    stored = ui_settings.get_settings(db).get(ui_settings.SETTING_REMOTE_BUTTON_DEFS)
    if isinstance(stored, dict):
        return _normalize_config(stored)
    return load_file_config()


def get_token() -> str:
    return os.getenv(ENV_TOKEN, "").strip()


def _override_for(
    overrides: Optional[Dict[str, Any]], button: Dict[str, Any]
) -> Dict[str, Any]:
    """ボタン1つぶんの上書き。設定が無い・壊れている場合は空として扱う。

    **別のボタンへずれた設定は捨てる。** ボタンIDは remote.json で `id` を省くと
    並び順から採番される（`light-1` など）。あとからボタンを挿し込むと以降のIDが
    1つずつずれ、保存済みの名前が黙って別のボタンに付く。保存時に控えた元の名前
    （`default_label`）が今の remote.json と食い違う設定は、ずれた印として無視する。
    """
    if not isinstance(overrides, dict):
        return {}
    entry = overrides.get(button["id"])
    if not isinstance(entry, dict):
        return {}

    saved_default = str(entry.get("default_label") or "").strip()
    if saved_default and saved_default != button["label"]:
        return {}
    return entry


def resolve_label(button: Dict[str, Any], overrides: Optional[Dict[str, Any]] = None) -> str:
    """画面に出す名前。付けた名前が空なら remote.json の名前へ戻る。"""
    label = str(_override_for(overrides, button).get("label") or "").strip()
    return label or button["label"]


def build_payload(
    overrides: Optional[Dict[str, Any]] = None, db: Optional[Any] = None
) -> Dict[str, Any]:
    """ダッシュボードの「電気の操作」カード用のペイロード。

    signal ID は画面へ出さない。押すのはボタンIDで足り、外へ出す値は少ないほどよい。
    設定画面もこのペイロードだけで足りる（登録し直すときもボタンIDで指すため。#262）。

    `hidden` のボタンもグループごと落とさずに返す。設定画面が「隠したボタン」も含めた
    一覧を出す必要があり、そのためだけに別のエンドポイントを増やしたくないため。
    ダッシュボードに出さない判断は受け取った側で行う。
    """
    config = load_config(db)
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
                        "hidden": bool(_override_for(overrides, button).get("hidden")),
                    }
                    for button in group["buttons"]
                ],
            }
            for group in config["groups"]
        ],
    }


def find_button(button_id: str, db: Optional[Any] = None) -> Optional[Dict[str, Any]]:
    """ボタンIDから、送信に必要な signal ID とグループ名まで含めて引く。"""
    for group in load_config(db)["groups"]:
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


def press(
    button_id: str,
    overrides: Optional[Dict[str, Any]] = None,
    db: Optional[Any] = None,
) -> Dict[str, Any]:
    """ボタンIDを押す。押した結果は「送信を依頼できたか」までしか分からない。

    隠したボタンでも押せる。隠すのは「ダッシュボードに出さない」という表示の話で、
    ボタンそのものを消したわけではないため。
    """
    button = find_button(button_id, db)
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
    """登録済みアプライアンスと signal を取る。ボタンを登録するときだけ使う。

    ダッシュボードの表示では叩かない（押したときしか外部APIへ出ない、が #106 の設計）。
    設定画面でも、開いたときではなく「読み込み直す」を押したときだけ通る（#262）。
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


# ------------------------------------------------- 登録できる操作の一覧（#262）


def _candidate_id(prefix: str, *parts: str) -> str:
    """ボタンIDを Nature Remo 側の同一性から決める。

    **並び順から採番しない。** 採番すると、あとからボタンを足したときにIDがずれ、
    付けた名前が別のボタンに付く（#260 でその手当てを入れている）。機器と操作から
    決めれば、外して付け直しても同じIDに戻るので、付けた名前もそのまま残る。

    signal ID・appliance ID をそのまま入れないのは、ボタンIDがダッシュボードの
    ペイロードと送信APIのパスに出るため。ハッシュにしておけば、IDを画面へ返さない
    という方針（README）を崩さずに済む。
    """
    digest = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:10]
    return f"{prefix}-{digest}"


def build_catalog_devices(appliances: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """`GET /1/appliances` の応答から、画面に並べる「選べる操作」を機器ごとに組み立てる。

    押せない機器も落とさずに返す。一覧から消えていると、選べないのか取得に失敗したのかが
    利用者から見て区別できないため、理由（`note`）を添えて並べる。
    """
    devices: List[Dict[str, Any]] = []
    for index, appliance in enumerate(appliances):
        if not isinstance(appliance, dict):
            continue

        appliance_id = str(appliance.get("id") or "").strip()
        nickname = str(appliance.get("nickname") or "").strip() or f"機器{index + 1}"
        kind = str(appliance.get("type") or "").strip()

        buttons: List[Dict[str, Any]] = []

        # 「照明」として登録した機器。生の signal を持たず、専用のエンドポイントで押す
        for entry in (appliance.get("light") or {}).get("buttons") or []:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or "").strip()
            if not name or not appliance_id:
                continue
            buttons.append(
                {
                    "id": _candidate_id("l", appliance_id, name),
                    "label": str(entry.get("label") or "").strip() or name,
                    "kind": "light",
                    "appliance_id": appliance_id,
                    "button": name,
                }
            )

        # 「その他」として登録した赤外線
        for signal in appliance.get("signals") or []:
            if not isinstance(signal, dict):
                continue
            signal_id = str(signal.get("id") or "").strip()
            if not signal_id:
                continue
            buttons.append(
                {
                    "id": _candidate_id("s", signal_id),
                    "label": str(signal.get("name") or "").strip() or "ボタン",
                    "kind": "signal",
                    "signal_id": signal_id,
                }
            )

        note = ""
        if not buttons:
            note = AC_NOT_SUPPORTED_NOTE if kind == "AC" else NO_BUTTON_NOTE

        devices.append(
            {
                "id": _candidate_id("d", appliance_id or nickname),
                "name": nickname,
                "type": kind,
                "note": note,
                "buttons": buttons,
            }
        )
    return devices


def fetch_catalog() -> Dict[str, Any]:
    """Nature Remo へ問い合わせて一覧を作り直す。呼ぶのは画面の「読み込み直す」だけ。"""
    devices = build_catalog_devices(fetch_appliances())
    fetched_at = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    return {"fetched_at": fetched_at.replace("+00:00", "Z"), "devices": devices}


def load_catalog(db: Optional[Any] = None) -> Dict[str, Any]:
    """最後に取得した一覧。無ければ空（画面が「読み込む」を促す）。"""
    stored = ui_settings.get_settings(db).get(ui_settings.SETTING_REMOTE_CATALOG)
    if not isinstance(stored, dict):
        return {"fetched_at": "", "devices": []}

    devices = [
        {
            "id": str(device.get("id") or ""),
            "name": str(device.get("name") or ""),
            "type": str(device.get("type") or ""),
            "note": str(device.get("note") or ""),
            "buttons": [
                button
                for button in device.get("buttons") or []
                if isinstance(button, dict) and button.get("id")
            ],
        }
        for device in stored.get("devices") or []
        if isinstance(device, dict) and device.get("id")
    ]
    return {"fetched_at": str(stored.get("fetched_at") or ""), "devices": devices}


def catalog_payload(catalog: Dict[str, Any]) -> Dict[str, Any]:
    """画面へ返す形。**signal ID・appliance ID は落とす。**

    画面が登録に使うのはボタンIDだけで、送り先はサーバー側で引ける
    （`resolve_config()`）。README の「外へ出す値は少ないほど安全です」を、
    登録の導線を足したあとも保てる。
    """
    return {
        "fetched_at": catalog.get("fetched_at") or "",
        "devices": [
            {
                "id": device["id"],
                "name": device["name"],
                "type": device.get("type") or "",
                "note": device.get("note") or "",
                "buttons": [
                    {
                        "id": button["id"],
                        "label": str(button.get("label") or ""),
                        "kind": str(button.get("kind") or ""),
                    }
                    for button in device.get("buttons") or []
                ],
            }
            for device in catalog.get("devices") or []
        ],
    }


def _button_sources(db: Optional[Any] = None) -> Dict[str, Dict[str, Any]]:
    """ボタンIDから送り先を引く索引。今の定義を優先し、足りない分を候補一覧から補う。

    今の定義を先に置くのは、Nature Remo 側で名前を変えたあと一覧を取り直しても、
    登録済みボタンの「もとの名前」が勝手に入れ替わらないようにするため。
    """
    sources: Dict[str, Dict[str, Any]] = {}
    for group in load_config(db)["groups"]:
        for button in group["buttons"]:
            sources[button["id"]] = button
    for device in load_catalog(db)["devices"]:
        for button in device["buttons"]:
            sources.setdefault(str(button.get("id") or ""), button)
    return sources


def resolve_config(raw: Any, db: Optional[Any] = None) -> Dict[str, Any]:
    """画面から来た「どのボタンを、どのグループへ、どの順で」を定義に組み直す。

    画面へは signal ID・appliance ID を返していないため、ボタンはIDだけで送られてくる。
    送り先は今の定義と、最後に取得した候補一覧から引く。**どちらにも無いIDは落とす**
    （一覧を取り直す前の古い画面から保存されても、知らない機器へ送る定義は作らない）。
    """
    sources = _button_sources(db)
    groups = []
    for raw_group in (raw or {}).get("groups") or []:
        if not isinstance(raw_group, dict):
            continue
        buttons = []
        for raw_button in raw_group.get("buttons") or []:
            if not isinstance(raw_button, dict):
                continue
            source = sources.get(str(raw_button.get("id") or "").strip())
            if source is not None:
                buttons.append(dict(source))
        groups.append(
            {
                "id": raw_group.get("id"),
                "name": raw_group.get("name"),
                "buttons": buttons,
            }
        )
    return _normalize_config({"groups": groups})


def prune_overrides(overrides: Any, config: Dict[str, Any]) -> Dict[str, Any]:
    """登録から外したボタンの上書き設定を落とす。

    残しておくと、`app_settings` に押せないボタンIDのゴミが溜まり続ける。
    """
    if not isinstance(overrides, dict):
        return {}
    known = {
        button["id"] for group in config["groups"] for button in group["buttons"]
    }
    return {key: value for key, value in overrides.items() if key in known}
