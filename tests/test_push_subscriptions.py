from backend import push_subscriptions


def _set_path(monkeypatch, tmp_path):
    monkeypatch.setattr(push_subscriptions, "SUBSCRIPTIONS_PATH", tmp_path / "push_subscriptions.json")


def test_upsert_and_list(monkeypatch, tmp_path):
    _set_path(monkeypatch, tmp_path)
    saved = push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/a", "keys": {"p256dh": "p1", "auth": "a1"}}
    )
    assert saved["endpoint"] == "https://push.example/a"

    subs = push_subscriptions.list_subscriptions()
    assert len(subs) == 1
    assert subs[0]["keys"] == {"p256dh": "p1", "auth": "a1"}


def test_upsert_updates_existing_endpoint(monkeypatch, tmp_path):
    _set_path(monkeypatch, tmp_path)
    push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/a", "keys": {"p256dh": "p1", "auth": "a1"}}
    )
    push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/a", "keys": {"p256dh": "p2", "auth": "a2"}}
    )
    subs = push_subscriptions.list_subscriptions()
    assert len(subs) == 1
    assert subs[0]["keys"] == {"p256dh": "p2", "auth": "a2"}


def test_upsert_rejects_invalid_subscription(monkeypatch, tmp_path):
    _set_path(monkeypatch, tmp_path)
    try:
        push_subscriptions.upsert_subscription({"endpoint": "https://push.example/a"})
        assert False, "should have raised"
    except ValueError:
        pass


def test_remove_subscription(monkeypatch, tmp_path):
    _set_path(monkeypatch, tmp_path)
    push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/a", "keys": {"p256dh": "p1", "auth": "a1"}}
    )
    assert push_subscriptions.remove_subscription("https://push.example/a") is True
    assert push_subscriptions.list_subscriptions() == []
    assert push_subscriptions.remove_subscription("https://push.example/a") is False


def test_remove_subscriptions_bulk(monkeypatch, tmp_path):
    _set_path(monkeypatch, tmp_path)
    push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/a", "keys": {"p256dh": "p1", "auth": "a1"}}
    )
    push_subscriptions.upsert_subscription(
        {"endpoint": "https://push.example/b", "keys": {"p256dh": "p2", "auth": "a2"}}
    )
    push_subscriptions.remove_subscriptions(["https://push.example/a", "https://push.example/missing"])
    subs = push_subscriptions.list_subscriptions()
    assert [item["endpoint"] for item in subs] == ["https://push.example/b"]
