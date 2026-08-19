"""サーバー間参照用の固定トークン認証。

画面向けのAPIは `auth.get_current_user`（Supabase のユーザーJWT）を必須にしているため、
ログイン画面を通れない別プロセス——同じVPS上で動く AIDE の MCP サーバー
（guchi-apps/aide#101）——からは読めない。そこで**読み取り専用の内部APIに限って**、
`Authorization: Bearer` の固定トークンで通る経路を用意する。

ops-dashboard の `OPS_API_TOKEN`（`requireSessionOrApiToken`）と同じ形。違いは、
こちらはログインセッションを併用せず**サーバー間専用**にしている点だけ。

`INTERNAL_API_KEY` が未設定なら常に 503 を返す。401（値が違う）と切り分けられるのは
呼ぶ側にとって重要で、AIDE 側は 503 を「相手側でAPIキーが未設定」、401 を
「トークンが一致しない」と表示し分けている。
"""

from __future__ import annotations

import hashlib
import hmac
import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import Header, HTTPException, status

load_dotenv()

ENV_VAR_NAME = "INTERNAL_API_KEY"


def get_internal_api_key() -> Optional[str]:
    """設定されたトークン。空文字は「未設定」として扱う。

    モジュール読み込み時ではなく都度読むのは、テストが `monkeypatch.setenv` で
    差し替えられるようにするため。
    """
    value = os.getenv(ENV_VAR_NAME)
    return value if value else None


def _token_matches(provided: str, expected: str) -> bool:
    """定数時間で比較する。長さの違いで早期に抜けないようダイジェスト同士を突き合わせる。"""
    provided_digest = hashlib.sha256(provided.encode("utf-8")).digest()
    expected_digest = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(provided_digest, expected_digest)


async def require_internal_token(
    authorization: Optional[str] = Header(default=None),
) -> None:
    """内部API用の依存。通れば None、通らなければ 503 / 401。"""
    expected = get_internal_api_key()
    if expected is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{ENV_VAR_NAME} is not configured",
        )

    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token or not _token_matches(token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal API token",
            headers={"WWW-Authenticate": "Bearer"},
        )
