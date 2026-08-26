#!/usr/bin/env python3
"""Nature Remo に登録済みの機器を一覧し、data/remote.json へ貼り付けられる形で出す。

**通常はこのスクリプトを使う必要はありません**（#262）。設定 →「ダッシュボードの表示」
→「電気の操作」の編集から、登録済みの操作を画面で選べます。そちらの保存先は DB で、
デプロイで消えません。

このスクリプトが残っているのは、DB を用意する前や、初期値として `data/remote.json` を
書いておきたいときのためです（画面から一度も保存していないあいだだけ読まれます）。

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


def build_groups(devices: list) -> list:
    """候補一覧（`remote.build_catalog_devices()`）を remote.json の groups の形にする。

    ボタンIDは候補一覧のもの（機器と操作から決まるハッシュ）をそのまま使う。画面から
    登録したときと同じIDになるので、あとで画面へ移しても付けた名前が引き継がれる。
    グループIDだけは、手で読み書きする前提のファイルなのでニックネームのスラグにする。
    """
    groups = []
    for index, device in enumerate(devices):
        if not device["buttons"]:
            continue
        groups.append(
            {
                "id": _slug(device["name"], f"group{index + 1}"),
                "name": device["name"],
                "buttons": [
                    {key: value for key, value in button.items() if key != "kind"}
                    for button in device["buttons"]
                ],
            }
        )
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

    devices = remote.build_catalog_devices(appliances)

    print("── 登録済みの機器 ──", file=sys.stderr)
    for device in devices:
        print(
            f"  {device['name'] or '(名前なし)'}（type={device['type'] or '?'}）: "
            f"押せる操作 {len(device['buttons'])}",
            file=sys.stderr,
        )
        if device["note"]:
            print(f"    ※ {device['note']}", file=sys.stderr)

    groups = build_groups(devices)
    if not groups:
        print("押せるボタンが1つも見つかりませんでした。", file=sys.stderr)
        return 1

    print("", file=sys.stderr)
    print("── data/remote.json の groups に貼り付けてください（要らない行は削る）──", file=sys.stderr)
    print(json.dumps({"groups": groups}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
