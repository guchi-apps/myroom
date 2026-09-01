from backend import device_config, outdoor_config


def test_device_config_save_and_list(data_dir):
    saved = device_config.save_device_name(1, "リビング")
    assert saved == {"id": 1, "name": "リビング", "inherits_from": None}

    devices = device_config.list_devices(discovered_ids=[2])
    assert devices == [
        {"id": 1, "name": "リビング", "inherits_from": None},
        {"id": 2, "name": "寝室", "inherits_from": None},
    ]

    devices_with_new = device_config.list_devices(discovered_ids=[3])
    assert devices_with_new == [
        {"id": 1, "name": "リビング", "inherits_from": None},
        {"id": 2, "name": "寝室", "inherits_from": None},
        {"id": 3, "name": "デバイス 3", "inherits_from": None},
    ]


def test_device_config_ensure_registers_new_device(data_dir):
    created = device_config.ensure_device(4, "書斎")
    assert created == {"id": 4, "name": "書斎", "inherits_from": None}

    devices = device_config.list_devices(discovered_ids=[4])
    assert any(device["id"] == 4 and device["name"] == "書斎" for device in devices)

    # 既存デバイスは上書きしない
    again = device_config.ensure_device(4, "別名")
    assert again["name"] == "書斎"


def test_device_config_rejects_invalid_name(data_dir):
    try:
        device_config.save_device_name(1, "  ")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "name is required" in str(exc)


def test_aircon_config_save_and_list(data_dir):
    from backend import aircon_config

    saved = aircon_config.save_unit_name(1, "リビングエアコン")
    assert saved == {"ac_id": 1, "name": "リビングエアコン"}

    units = aircon_config.list_units(discovered_ac_ids=[2])
    assert units == [
        {"ac_id": 1, "name": "リビングエアコン"},
        {"ac_id": 2, "name": "エアコン 2"},
    ]


def test_aircon_config_rejects_invalid_name(data_dir):
    from backend import aircon_config

    try:
        aircon_config.save_unit_name(1, "  ")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "name is required" in str(exc)


def test_outdoor_config_save_and_get(data_dir):
    saved = outdoor_config.save_location(34.6937, 135.5023, "大阪")
    assert saved["name"] == "大阪"

    loaded = outdoor_config.get_location()
    assert loaded["latitude"] == 34.6937
    assert loaded["longitude"] == 135.5023
    assert loaded["name"] == "大阪"


def test_outdoor_config_rejects_invalid_latitude(data_dir):
    try:
        outdoor_config.save_location(100.0, 135.0, "bad")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "latitude" in str(exc)


def test_outdoor_config_reads_old_single_object_format(data_dir):
    """#308より前の保存形式（単一オブジェクト）を配列＋基準IDへ読み替える。"""
    data_dir.mkdir(parents=True, exist_ok=True)
    outdoor_config.CONFIG_PATH.write_text(
        '{"latitude": 34.6937, "longitude": 135.5023, "name": "大阪"}',
        encoding="utf-8",
    )

    locations = outdoor_config.list_locations()
    assert len(locations) == 1
    assert locations[0]["name"] == "大阪"
    assert locations[0]["is_primary"] is True

    primary = outdoor_config.get_location()
    assert primary["name"] == "大阪"


def test_outdoor_config_add_update_delete_and_primary(data_dir):
    added = outdoor_config.add_location("実家", 35.6895, 139.6917)
    assert added["is_primary"] is False

    locations = outdoor_config.list_locations()
    assert len(locations) == 2

    updated = outdoor_config.update_location(added["id"], "実家（改名）", 35.7, 139.7)
    assert updated["name"] == "実家（改名）"

    # 基準地点は削除できない
    primary_id = next(loc["id"] for loc in outdoor_config.list_locations() if loc["is_primary"])
    try:
        outdoor_config.delete_location(primary_id)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "primary" in str(exc)

    switched = outdoor_config.set_primary_location(added["id"])
    assert switched["id"] == added["id"]

    # 基準地点が入れ替わったので、元の基準地点は削除できる
    outdoor_config.delete_location(primary_id)
    assert len(outdoor_config.list_locations()) == 1


def test_outdoor_config_delete_missing_raises(data_dir):
    try:
        outdoor_config.delete_location("does-not-exist")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "not found" in str(exc)
