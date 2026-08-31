from backend import push_notify, push_subscriptions


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code


class FakeWebPushException(Exception):
    def __init__(self, status_code=None):
        super().__init__("push failed")
        self.response = FakeResponse(status_code) if status_code is not None else None


def _configure_vapid(monkeypatch):
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "test-private-key")
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "test-public-key")
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:test@example.com")


def _set_subscriptions_path(monkeypatch, tmp_path):
    monkeypatch.setattr(
        push_subscriptions, "SUBSCRIPTIONS_PATH", tmp_path / "push_subscriptions.json"
    )


def test_is_configured_requires_both_keys(monkeypatch):
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    assert push_notify.is_configured() is False

    _configure_vapid(monkeypatch)
    assert push_notify.is_configured() is True


def test_broadcast_skips_when_not_configured(monkeypatch, tmp_path):
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    _set_subscriptions_path(monkeypatch, tmp_path)
    push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/a", "keys": {"p256dh": "p1", "auth": "a1"}}
    )
    result = push_notify.broadcast({"title": "t", "body": "b", "tag": "x", "url": "/"})
    assert result == {"sent": 0, "total": 0}


def test_broadcast_sends_to_all_subscriptions(monkeypatch, tmp_path):
    _configure_vapid(monkeypatch)
    _set_subscriptions_path(monkeypatch, tmp_path)
    push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/a", "keys": {"p256dh": "p1", "auth": "a1"}}
    )
    push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/b", "keys": {"p256dh": "p2", "auth": "a2"}}
    )

    calls = []

    def fake_webpush(**kwargs):
        calls.append(kwargs["subscription_info"]["endpoint"])

    monkeypatch.setattr(push_notify, "webpush", fake_webpush)

    result = push_notify.broadcast({"title": "t", "body": "b", "tag": "x", "url": "/"})
    assert result == {"sent": 2, "total": 2}
    assert len(calls) == 2


def test_broadcast_removes_expired_subscriptions(monkeypatch, tmp_path):
    _configure_vapid(monkeypatch)
    _set_subscriptions_path(monkeypatch, tmp_path)
    push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/expired", "keys": {"p256dh": "p1", "auth": "a1"}}
    )
    push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/ok", "keys": {"p256dh": "p2", "auth": "a2"}}
    )

    def fake_webpush(**kwargs):
        if kwargs["subscription_info"]["endpoint"].endswith("expired"):
            raise FakeWebPushException(status_code=410)

    monkeypatch.setattr(push_notify, "webpush", fake_webpush)
    monkeypatch.setattr(push_notify, "WebPushException", FakeWebPushException)

    result = push_notify.broadcast({"title": "t", "body": "b", "tag": "x", "url": "/"})
    assert result == {"sent": 1, "total": 2}

    remaining = push_subscriptions.list_subscriptions()
    assert [item["endpoint"] for item in remaining] == ["https://push.example/ok"]
