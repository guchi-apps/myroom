#!/usr/bin/env python3
"""Nature Remo に登録済みの機器を一覧し、data/remote.json へ貼り付けられる形で出す。

ダッシュボードは押したときしか Nature Remo を叩かない（#106）。この一覧を取るのは
data/remote.json を書くときだけなので、常駐するバックエンドではなくこのスクリプトに置く。

使い方（リポジトリルートで実行する）:

    NATURE_REMO_TOKEN=xxxx python scripts/list-remo-signals.py

.env に NATURE_REMO_TOKEN を書いてあれば、環境変数の指定は要らない。
トークンは https://home.nature.global/ で発行する。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(REPO_ROOT / ".env")

from backend import remote  # noqa: E402


def _slug(text: str, fallback: str) -> str:
    """IDに使える文字だけ残す。日本語のニックネームは丸ごと落ちるので fallback へ。"""
    kept = "".join(char if char.isascii() and (char.isalnum() or char in "-_") else "-" for char in text)
    kept = "-".join(part for part in kept.split("-") if part).lower()
    return kept or fallback


def build_groups(appliances: list) -> list:
    """機器ごとに1グループを作る。要らないボタンは手で削る前提で全部出す。"""
    groups = []
    for index, appliance in enumerate(appliances):
        nickname = str(appliance.get("nickname") or "").strip() or f"機器{index + 1}"
        group_id = _slug(nickname, f"group{index + 1}")

        buttons = []

        # 「照明」として登録した機器。生の signal を持たず、専用のエンドポイントで押す
        light_buttons = (appliance.get("light") or {}).get("buttons") or []
        for button in light_buttons:
            name = str(button.get("name") or "").strip()
            if not name:
                continue
            buttons.append(
                {
                    "id": f"{group_id}-{_slug(name, str(len(buttons) + 1))}",
                    "label": str(button.get("label") or "").strip() or name,
                    "appliance_id": appliance.get("id"),
                    "button": name,
                }
            )

        # 「その他」として登録した赤外線
        for signal in appliance.get("signals") or []:
            name = str(signal.get("name") or "").strip()
            signal_id = signal.get("id")
            if not signal_id:
                continue
            buttons.append(
                {
                    "id": f"{group_id}-{_slug(name, str(len(buttons) + 1))}",
                    "label": name or "ボタン",
                    "signal_id": signal_id,
                }
            )

        if not buttons:
            continue

        groups.append({"id": group_id, "name": nickname, "buttons": buttons})
    return groups


def main() -> int:
    try:
        appliances = remote.fetch_appliances()
    except remote.RemoteError as exc:
        print(f"取得できませんでした: {exc.message}", file=sys.stderr)
        if exc.status_code == 503:
            print(
                "NATURE_REMO_TOKEN を .env に書くか、環境変数で渡してください。",
                file=sys.stderr,
            )
        return 1

    if not appliances:
        print("Nature Remo に機器が1つも登録されていません。", file=sys.stderr)
        return 1

    print("── 登録済みの機器 ──", file=sys.stderr)
    for appliance in appliances:
        nickname = appliance.get("nickname") or "(名前なし)"
        kind = appliance.get("type") or "?"
        light_count = len((appliance.get("light") or {}).get("buttons") or [])
        signal_count = len(appliance.get("signals") or [])
        print(f"  {nickname}（type={kind}）: 照明ボタン {light_count} / signal {signal_count}", file=sys.stderr)
        if kind == "AC" and light_count == 0 and signal_count == 0:
            print(
                "    ※ エアコンとして登録された機器は個別の設定APIでしか操作できず、このカードでは押せません。",
                file=sys.stderr,
            )
            print(
                "       ボタンとして出したい場合は Nature Remo アプリで「その他」として登録し直してください。",
                file=sys.stderr,
            )

    groups = build_groups(appliances)
    if not groups:
        print("押せるボタンが1つも見つかりませんでした。", file=sys.stderr)
        return 1

    print("", file=sys.stderr)
    print("── data/remote.json の groups に貼り付けてください（要らない行は削る）──", file=sys.stderr)
    print(json.dumps({"groups": groups}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
