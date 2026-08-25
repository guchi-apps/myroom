"""ログイン成功を Signaly へ通知する。

Supabase Auth へ移行してから、OAuth のコールバックは Supabase 側でホストされており、
**このバックエンドに「ログインした瞬間」が通る場所がない**（`auth.py` は毎リクエストの
JWT を検証するだけで、初回ログインかどうかを区別できない）。そのため通知の起点は
フロントエンドの `/auth/callback` から明示的に叩く `POST /api/auth/login-notify` に置く
（guchi-apps/myroom#240）。

Supabase の Database Webhooks（Signaly の `/notify/app-login/{app_id}`）は使わない。
Supabase プロジェクトを複数アプリで共有しているため、`auth.users` に掛けた Webhook は
他アプリのログインでも発火し、`app_id` が実際のアプリと一致しない
（guchi-apps/signaly#192）。

通知先は**全アプリ共通の1チャンネル**で、どのアプリのログインかは `source` で見分ける。
そのためペイロードから `source` を落とさないこと（落とすと送信元が付かない）。
"""

import logging
import os
from datetime import datetime, timezone

from fastapi import Request

from .signaly_notify import post_notification

logger = logging.getLogger(__name__)

LOGIN_WEBHOOK_URL = os.getenv("LOGIN_WEBHOOK_URL", "").strip()
APP_NAME = "MyRoom"  # 通知タイトルと送信元に使うアプリ名。他アプリへ流用する場合はここだけ変更する


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def build_login_notification(email: str, request: Request) -> dict:
    """通知のペイロードを組み立てる。

    `Request` を読むのはここだけにする。実際の送信はレスポンスを返した後の
    バックグラウンドで行うため、そのときにはリクエストの情報を取れない。
    """
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    ua = (request.headers.get("user-agent") or "unknown")[:500]
    fields = [
        {"name": "メール", "value": email or "unknown", "inline": True},
        {"name": "接続元IP", "value": client_ip(request), "inline": True},
        {"name": "日時", "value": now, "inline": False},
        {"name": "User-Agent", "value": ua, "inline": False},
    ]
    return {
        "title": f"🔐 {APP_NAME} ログイン",
        "message": "",
        "level": "info",
        "color": "#57f287",
        "fields": fields,
        # 全アプリ共通のチャンネルへ集まるため、送信元を必ず入れる（無いと区別できない）
        "source": APP_NAME,
    }


def send_login_notification(payload: dict) -> None:
    if not LOGIN_WEBHOOK_URL:
        logger.debug("LOGIN_WEBHOOK_URL not set; skipping Signaly login notification")
        return
    post_notification(LOGIN_WEBHOOK_URL, payload)
