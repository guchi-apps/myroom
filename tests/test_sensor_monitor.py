import datetime
from types import SimpleNamespace

from backend import database, sensor_monitor, ui_settings


def _fake_status(device_id=1, name="リビング", stale=False):
    return {
        "device_id": device_id,
        "name": name,
        "last_seen": "2026-08-10 12:00:00",
        "age_minutes": 0.0,
        "stale": stale,
        "has_data": True,
    }


def _setup(monkeypatch, data_dir, *, statuses=None, reading=None):
    monkeypatch.setattr(sensor_monitor, "STATE_PATH", data_dir / "sensor_alert_state.json")
    monkeypatch.setattr(database, "DB_MOCK", False)
    monkeypatch.setattr(
        sensor_monitor, "collect_sensor_statuses", lambda db=None: statuses or [_fake_status()]
    )
    monkeypatch.setattr(sensor_monitor, "_latest_reading", lambda db, device_id: reading)
    # run_monitor には DB_MOCK=False の実DBセッション相当のダミーを渡すため、
    # ui_settings 側は DB を読みに行かずファイル設定（data_dir 配下）を見るようにする
    monkeypatch.setattr(
        sensor_monitor.ui_settings,
        "get_settings",
        lambda db=None: ui_settings._load_file_settings(),
    )
    monkeypatch.setattr(sensor_monitor.signaly_notify, "send_sensor_stale_notification", lambda **kw: None)
    monkeypatch.setattr(sensor_monitor.signaly_notify, "send_sensor_recovered_notification", lambda **kw: None)

    dispatched = []
    monkeypatch.setattr(
        sensor_monitor.notify_events, "dispatch_push_event", lambda event: dispatched.append(event)
    )
    return dispatched


def _enable_room_anomaly(**overrides):
    settings = {ui_settings.SETTING_ROOM_ANOMALY_NOTIFY_ENABLED: True}
    settings.update(overrides)
    ui_settings.save_settings(settings)


def test_direction_for_value():
    thresholds = {"min": 16.0, "max": 30.0}
    assert sensor_monitor._direction_for_value(31.0, thresholds) == "high"
    assert sensor_monitor._direction_for_value(10.0, thresholds) == "low"
    assert sensor_monitor._direction_for_value(22.0, thresholds) is None


def test_has_recovered_respects_hysteresis():
    thresholds = {"min": 16.0, "max": 30.0}
    # 上限のすぐ内側（0.5未満）ではまだ「異常」のまま
    assert sensor_monitor._has_recovered(29.8, thresholds, "high", 0.5) is False
    assert sensor_monitor._has_recovered(29.5, thresholds, "high", 0.5) is True
    assert sensor_monitor._has_recovered(16.2, thresholds, "low", 0.5) is False
    assert sensor_monitor._has_recovered(16.5, thresholds, "low", 0.5) is True


def test_disabled_by_default_does_not_evaluate(data_dir, monkeypatch):
    dispatched = _setup(
        monkeypatch, data_dir, reading=SimpleNamespace(temperature=35.0, humidity=50.0)
    )
    sensor_monitor.run_monitor(db=object(), notify=True)
    assert dispatched == []


def test_enters_high_and_dispatches_push(data_dir, monkeypatch):
    dispatched = _setup(
        monkeypatch, data_dir, reading=SimpleNamespace(temperature=35.0, humidity=50.0)
    )
    _enable_room_anomaly()

    sensor_monitor.run_monitor(db=object(), notify=True)

    kinds = [event.kind for event in dispatched]
    assert "room_anomaly_temperature_high" in kinds


def test_no_repeat_notification_within_reminder_interval(data_dir, monkeypatch):
    dispatched = _setup(
        monkeypatch, data_dir, reading=SimpleNamespace(temperature=35.0, humidity=50.0)
    )
    _enable_room_anomaly(room_anomaly_reminder_minutes=60)

    sensor_monitor.run_monitor(db=object(), notify=True)
    first_count = len(dispatched)

    # 同じ異常が続いたまま、すぐ再評価しても再通知しない
    sensor_monitor.run_monitor(db=object(), notify=True)
    assert len(dispatched) == first_count


def test_recovers_and_dispatches_recovery_push(data_dir, monkeypatch):
    dispatched = _setup(
        monkeypatch, data_dir, reading=SimpleNamespace(temperature=35.0, humidity=50.0)
    )
    _enable_room_anomaly()
    sensor_monitor.run_monitor(db=object(), notify=True)

    # 上限(30.0) - ヒステリシス(0.5) 以下まで戻る
    monkeypatch.setattr(
        sensor_monitor,
        "_latest_reading",
        lambda db, device_id: SimpleNamespace(temperature=29.0, humidity=50.0),
    )
    sensor_monitor.run_monitor(db=object(), notify=True)

    kinds = [event.kind for event in dispatched]
    assert "room_anomaly_temperature_recovered" in kinds


def test_stale_device_is_not_evaluated_for_anomaly(data_dir, monkeypatch):
    dispatched = _setup(
        monkeypatch,
        data_dir,
        statuses=[_fake_status(stale=True)],
        reading=SimpleNamespace(temperature=35.0, humidity=50.0),
    )
    _enable_room_anomaly()

    sensor_monitor.run_monitor(db=object(), notify=True)

    kinds = [event.kind for event in dispatched]
    assert not any(kind.startswith("room_anomaly_") for kind in kinds)
    # 鮮度の通知は従来どおり動く
    assert "sensor_stale" in kinds
