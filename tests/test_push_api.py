from backend import push_notify, push_subscriptions


def _configure_vapid(monkeypatch):
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "test-private-key")
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "test-public-key")
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:test@example.com")


def _set_subscriptions_path(monkeypatch, tmp_path):
    monkeypatch.setattr(
        push_subscriptions, "SUBSCRIPTIONS_PATH", tmp_path / "push_subscriptions.json"
    )


def test_vapid_public_key_requires_auth(client):
    assert client.get("/api/push/vapid-public-key").status_code == 401


def test_vapid_public_key_returns_503_when_unconfigured(authed_client, monkeypatch):
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    response = authed_client.get("/api/push/vapid-public-key")
    assert response.status_code == 503


def test_vapid_public_key_returns_key_when_configured(authed_client, monkeypatch):
    _configure_vapid(monkeypatch)
    response = authed_client.get("/api/push/vapid-public-key")
    assert response.status_code == 200
    body = response.json()
    assert body["publicKey"] == "test-public-key"
    assert body["configured"] is True


def test_subscribe_requires_auth(client):
    response = client.post(
        "/api/push/subscribe",
        json={"endpoint": "https://push.example/a", "keys": {"p256dh": "p1", "auth": "a1"}},
    )
    assert response.status_code == 401


def test_subscribe_stores_subscription(authed_client, monkeypatch, tmp_path):
    _configure_vapid(monkeypatch)
    _set_subscriptions_path(monkeypatch, tmp_path)

    response = authed_client.post(
        "/api/push/subscribe",
        json={"endpoint": "https://push.example/a", "keys": {"p256dh": "p1", "auth": "a1"}},
    )
    assert response.status_code == 200
    assert push_subscriptions.list_subscriptions()[0]["endpoint"] == "https://push.example/a"


def test_subscribe_rejects_when_not_configured(authed_client, monkeypatch, tmp_path):
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    _set_subscriptions_path(monkeypatch, tmp_path)

    response = authed_client.post(
        "/api/push/subscribe",
        json={"endpoint": "https://push.example/a", "keys": {"p256dh": "p1", "auth": "a1"}},
    )
    assert response.status_code == 503


def test_unsubscribe_removes_subscription(authed_client, monkeypatch, tmp_path):
    _set_subscriptions_path(monkeypatch, tmp_path)
    push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/a", "keys": {"p256dh": "p1", "auth": "a1"}}
    )

    response = authed_client.request(
        "DELETE", "/api/push/subscribe", json={"endpoint": "https://push.example/a"}
    )
    assert response.status_code == 200
    assert push_subscriptions.list_subscriptions() == []


def test_unsubscribe_missing_endpoint_returns_404(authed_client, monkeypatch, tmp_path):
    _set_subscriptions_path(monkeypatch, tmp_path)
    response = authed_client.request(
        "DELETE", "/api/push/subscribe", json={"endpoint": "https://push.example/missing"}
    )
    assert response.status_code == 404


def test_send_test_push_requires_configuration(authed_client, monkeypatch):
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    response = authed_client.post("/api/push/test")
    assert response.status_code == 503


def test_send_test_push_returns_counts(authed_client, monkeypatch, tmp_path):
    _configure_vapid(monkeypatch)
    _set_subscriptions_path(monkeypatch, tmp_path)
    monkeypatch.setattr(push_notify, "webpush", lambda **kwargs: None)

    push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/a", "keys": {"p256dh": "p1", "auth": "a1"}}
    )

    response = authed_client.post("/api/push/test")
    assert response.status_code == 200
    body = response.json()
    assert body["sent"] == 1
    assert body["total"] == 1
