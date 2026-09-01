#!/usr/bin/env python3
"""VAPID 鍵を生成し、1Password / .env へ登録する値を出力する。

Usage:
  ./venv/bin/python scripts/generate_vapid_keys.py
  ./venv/bin/python scripts/generate_vapid_keys.py --out ~/.cache/myroom-vapid

**秘密鍵は PEM ではなく URL-safe base64（32 バイトの生の値・43 文字）で出す。**
`backend/push_notify.py` は環境変数の値をそのまま `pywebpush.webpush(vapid_private_key=...)`
へ渡し、pywebpush は `py_vapid.Vapid01.from_string()` で読む。`from_string()` は改行を落として
base64 デコードするだけなので、`-----BEGIN PRIVATE KEY-----` を含む PEM を渡すと
`Could not deserialize key data` で落ちる。さらに `.github/workflows/deploy.yml` の
`sync_env_var` は値を `KEY=値` の 1 行として `.env` へ書くため、複数行の PEM は `.env` の
書式そのものを壊す（python-dotenv が 2 行目以降を別のキーとして読む）。

`--out` を付けると値を標準出力に出さず、指定ディレクトリへ 1 フィールド 1 ファイルで書き出す
（`vapid-private-key` / `vapid-public-key`、パーミッション 600）。手作業 Issue から
`provision-secret.sh --from-stdin` へ流し込むときはこちらを使う。
"""

from __future__ import annotations

import argparse
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01
from py_vapid.utils import b64urlencode

DEFAULT_SUBJECT = "mailto:you@example.com"


def generate_keys() -> tuple[str, str]:
    """(秘密鍵, 公開鍵) を URL-safe base64 の文字列で返す。"""
    vapid = Vapid01()
    vapid.generate_keys()
    private_raw = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
    public_raw = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return b64urlencode(private_raw), b64urlencode(public_raw)


def write_files(out_dir: Path, private_key: str, public_key: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    out_dir.chmod(0o700)
    for name, value in (("vapid-private-key", private_key), ("vapid-public-key", public_key)):
        path = out_dir / name
        path.write_text(value, encoding="utf-8")
        path.chmod(0o600)
        print(f"{path} （{len(value)}文字）")


def print_values(private_key: str, public_key: str) -> None:
    print("# 1Password アイテム MyRoom に保存するフィールド")
    print("# vapid-private-key:")
    print(private_key)
    print("# vapid-public-key:")
    print(public_key)
    print("# vapid-subject:")
    print(DEFAULT_SUBJECT)
    print()
    print("# 参考: サーバー .env 用（1Password 同期を使う場合は不要）")
    print(f"VAPID_PRIVATE_KEY={private_key}")
    print(f"VAPID_PUBLIC_KEY={public_key}")
    print(f"VAPID_SUBJECT={DEFAULT_SUBJECT}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        metavar="DIR",
        help="値を標準出力に出さず、このディレクトリへ 1 フィールド 1 ファイルで書き出す",
    )
    args = parser.parse_args()

    private_key, public_key = generate_keys()
    if args.out:
        write_files(Path(args.out).expanduser(), private_key, public_key)
    else:
        print_values(private_key, public_key)


if __name__ == "__main__":
    main()
