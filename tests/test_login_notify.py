import pytest

from backend import login_notify


@pytest.fixture
def captured_posts(monkeypatch):
    """Signaly へ実際に投げず、送ろうとした宛先とペイロードを記録する。"""
    posts = []

    def fake_post(webhook_url, payload):
        posts.append((webhook_url, payload))

    monkeypatch.setattr(login_notify, "post_notification", fake_post)
    monkeypatch.setattr(login_notify, "LOGIN_WEBHOOK_URL", "https://signaly.example/webhook/login")
    return posts


def test_login_notify_requires_auth(client):
    response = client.post("/api/auth/login-notify")
    assert response.status_code == 401


def test_login_notify_sends_signaly_notification(authed_client, captured_posts):
    response = authed_client.post(
        "/api/auth/login-notify",
        headers={"x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "TestAgent/1.0"},
    )
    assert response.status_code == 204

    assert len(captured_posts) == 1
    url, payload = captured_posts[0]
    assert url == "https://signaly.example/webhook/login"
    # 全アプリ共通のチャンネルへ集約しているため、送信元が無いとどのアプリか分からない
    assert payload["source"] == "MyRoom"
    assert payload["title"] == "🔐 MyRoom ログイン"

    values = {field["name"]: field["value"] for field in payload["fields"]}
    assert values["メール"] == "test@example.com"
    # x-forwarded-for は先頭（元の接続元）だけを使う
    assert values["接続元IP"] == "203.0.113.9"
    assert values["User-Agent"] == "TestAgent/1.0"


def test_login_notify_skips_when_webhook_url_is_unset(authed_client, captured_posts, monkeypatch):
    monkeypatch.setattr(login_notify, "LOGIN_WEBHOOK_URL", "")

    response = authed_client.post("/api/auth/login-notify")

    assert response.status_code == 204
    assert captured_posts == []
