#!/usr/bin/env python3
"""VAPID 鍵を生成し、1Password 登録用の値を出力する。

Usage:
  ./venv/bin/python scripts/generate_vapid_keys.py

Private key は PEM 形式。Public key はブラウザの applicationServerKey 用 URL-safe base64。
"""

from __future__ import annotations

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01
from py_vapid.utils import b64urlencode


def main() -> None:
    vapid = Vapid01()
    vapid.generate_keys()
    private_pem = vapid.private_pem().decode("utf-8")
    private_pem_escaped = private_pem.replace("\n", "\\n")
    raw_pub = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    public_key = b64urlencode(raw_pub)
    subject = "mailto:you@example.com"

    print("# 1Password アイテム MyRoom に保存するフィールド")
    print("# vapid-private-key （PEM をそのまま改行付きで貼り付け）:")
    print(private_pem)
    print("# vapid-public-key:")
    print(public_key)
    print("# vapid-subject:")
    print(subject)
    print()
    print("# 参考: サーバー .env 用（1Password 同期を使う場合は不要）")
    print(f'VAPID_PRIVATE_KEY="{private_pem_escaped}"')
    print(f"VAPID_PUBLIC_KEY={public_key}")
    print(f"VAPID_SUBJECT={subject}")


if __name__ == "__main__":
    main()
