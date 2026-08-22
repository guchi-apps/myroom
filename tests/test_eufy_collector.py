"""eufy 収集スクリプト（collectors/eufy_to_myroom.py）の、機器に繋がない部分のテスト。

`collectors/` はパッケージではないため、ファイルパスから直接読み込む。
`tinytuya` はサブPCの収集用 venv にしか入っていないので、**入っていなくても
import できること自体**もここで担保する。
"""

import datetime
import importlib.util
import pathlib

import pytest

MODULE_PATH = (
    pathlib.Path(__file__).resolve().parents[1] / "collectors" / "eufy_to_myroom.py"
)


def _load_module():
    spec = importlib.util.spec_from_file_location("eufy_to_myroom", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


eufy = _load_module()


class TestExtractEvent:
    def test_lowercases_and_normalizes_separators(self):
        # 読み替えそのものは MyRoom 側（backend/cleaner.py）が持つ。
        # ここでやるのは表記の均しだけ
        assert eufy.extract_event({"15": "Recharge"}, "15") == "recharge"
        assert eufy.extract_event({"15": "Wall Follow"}, "15") == "wall_follow"
        assert eufy.extract_event({"15": "goto-charge"}, "15") == "goto_charge"

    def test_boolean_devices_report_cleaning_or_docked(self):
        assert eufy.extract_event({"15": True}, "15") == "cleaning"
        assert eufy.extract_event({"15": False}, "15") == "docked"

    def test_missing_dp_tells_which_option_to_set(self):
        with pytest.raises(eufy.ReadError) as excinfo:
            eufy.extract_event({"104": 80}, "15")
        assert "EUFY_STATUS_DP" in str(excinfo.value)

    def test_empty_value_is_an_error(self):
        with pytest.raises(eufy.ReadError):
            eufy.extract_event({"15": "   "}, "15")


class TestExtractBattery:
    def test_reads_percentage(self):
        assert eufy.extract_battery({"104": 78}, "104") == 78
        assert eufy.extract_battery({"104": "78.4"}, "104") == 78

    def test_missing_or_broken_values_are_dropped(self):
        # 残量が取れなくても稼働履歴は残せるので、ここで落とさない
        assert eufy.extract_battery({}, "104") is None
        assert eufy.extract_battery({"104": None}, "104") is None
        assert eufy.extract_battery({"104": "unknown"}, "104") is None
        assert eufy.extract_battery({"104": 120}, "104") is None


class TestBuildPayload:
    def test_uses_the_myroom_datetime_format(self):
        payload = eufy.build_payload(
            {"15": "Charging", "104": 42},
            "15",
            "104",
            now=datetime.datetime(2026, 8, 22, 14, 32, 5),
        )
        assert payload == {
            "datetime": "2026-08-22 14:32:05",
            "event": "charging",
            "battery": 42,
        }


class TestLoadConfig:
    def test_requires_the_device_credentials(self, monkeypatch):
        for name in ("EUFY_DEVICE_ID", "EUFY_LOCAL_KEY", "EUFY_IP"):
            monkeypatch.delenv(name, raising=False)
        with pytest.raises(eufy.ConfigError):
            eufy.load_config()

    def test_scan_does_not_require_them(self, monkeypatch):
        for name in ("EUFY_DEVICE_ID", "EUFY_LOCAL_KEY", "EUFY_IP"):
            monkeypatch.delenv(name, raising=False)
        config = eufy.load_config(require_device=False)
        assert config["device_id"] == ""
        assert config["status_dp"] == eufy.DEFAULT_STATUS_DP

    def test_dp_numbers_can_be_overridden(self, monkeypatch):
        monkeypatch.setenv("EUFY_DEVICE_ID", "abc")
        monkeypatch.setenv("EUFY_LOCAL_KEY", "key")
        monkeypatch.setenv("EUFY_IP", "192.168.2.30")
        monkeypatch.setenv("EUFY_STATUS_DP", "101")
        monkeypatch.setenv("EUFY_BATTERY_DP", "102")
        config = eufy.load_config()
        assert config["status_dp"] == "101"
        assert config["battery_dp"] == "102"


def test_import_works_without_tinytuya():
    # サブPCの収集用 venv 以外では tinytuya が無い。それでも import できること
    assert eufy.main is not None
