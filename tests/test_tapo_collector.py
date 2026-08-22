"""Tapo 収集スクリプト（collectors/tapo_to_myroom.py）の、機器に繋がない部分のテスト。

`collectors/` はパッケージではないため、ファイルパスから直接読み込む。
`python-kasa` はサブPCの収集用 venv にしか入っていないので、**入っていなくても
import できること自体**もここで担保する。
"""

import datetime
import importlib.util
import pathlib

import pytest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "collectors" / "tapo_to_myroom.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("tapo_to_myroom", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tapo = _load_module()


class TestParseHosts:
    def test_ip_only_uses_device_alias(self):
        assert tapo.parse_hosts("192.168.1.21") == [("192.168.1.21", None)]

    def test_name_override(self):
        assert tapo.parse_hosts("192.168.1.21=冷蔵庫") == [("192.168.1.21", "冷蔵庫")]

    def test_multiple_entries_and_whitespace(self):
        raw = " 192.168.1.21=冷蔵庫 , 192.168.1.22=テレビ ,192.168.1.23 "
        assert tapo.parse_hosts(raw) == [
            ("192.168.1.21", "冷蔵庫"),
            ("192.168.1.22", "テレビ"),
            ("192.168.1.23", None),
        ]

    def test_trailing_comma_is_ignored(self):
        assert tapo.parse_hosts("192.168.1.21,") == [("192.168.1.21", None)]

    def test_empty_name_falls_back_to_alias(self):
        assert tapo.parse_hosts("192.168.1.21=") == [("192.168.1.21", None)]

    def test_empty_raises(self):
        with pytest.raises(tapo.ConfigError):
            tapo.parse_hosts("  ,  ")

    def test_missing_host_raises(self):
        with pytest.raises(tapo.ConfigError):
            tapo.parse_hosts("=冷蔵庫")


class TestBuildPayload:
    def test_source_is_namespaced(self):
        readings = [{"name": "冷蔵庫", "kwh_today": 0.86, "power_w": 38.2}]
        payload = tapo.build_payload(readings, datetime.date(2026, 8, 22))
        assert payload == {
            "records": [
                {
                    "date": "2026-08-22",
                    "source": "tapo:冷蔵庫",
                    "kwh": 0.86,
                    "power_w": 38.2,
                }
            ]
        }

    def test_reading_without_total_is_dropped(self):
        """瞬時値しか取れなかった機器は送らない。日別テーブルに入れる値が無いため。"""
        readings = [
            {"name": "冷蔵庫", "kwh_today": 0.86, "power_w": 38.2},
            {"name": "テレビ", "kwh_today": None, "power_w": 72.0},
        ]
        payload = tapo.build_payload(readings, datetime.date(2026, 8, 22))
        assert [r["source"] for r in payload["records"]] == ["tapo:冷蔵庫"]

    def test_zero_kwh_is_kept(self):
        """0 kWh は「使っていない」という記録なので、欠測とは区別して送る。"""
        readings = [{"name": "デスク", "kwh_today": 0.0, "power_w": 0.0}]
        payload = tapo.build_payload(readings, datetime.date(2026, 8, 22))
        assert payload["records"][0]["kwh"] == 0.0


class TestLoadConfig:
    def test_requires_credentials(self, monkeypatch):
        monkeypatch.delenv("TAPO_USERNAME", raising=False)
        monkeypatch.setenv("TAPO_PASSWORD", "x")
        monkeypatch.setenv("TAPO_HOSTS", "192.168.1.21")
        with pytest.raises(tapo.ConfigError):
            tapo.load_config()

    def test_api_url_is_overridable(self, monkeypatch):
        monkeypatch.setenv("TAPO_USERNAME", "user@example.com")
        monkeypatch.setenv("TAPO_PASSWORD", "x")
        monkeypatch.setenv("TAPO_HOSTS", "192.168.1.21=冷蔵庫")
        monkeypatch.setenv("MYROOM_ENERGY_API_URL", "http://localhost:8000/api/energy")
        config = tapo.load_config()
        assert config["api_url"] == "http://localhost:8000/api/energy"
        assert config["hosts"] == [("192.168.1.21", "冷蔵庫")]

    def test_api_url_defaults_to_production(self, monkeypatch):
        monkeypatch.setenv("TAPO_USERNAME", "user@example.com")
        monkeypatch.setenv("TAPO_PASSWORD", "x")
        monkeypatch.setenv("TAPO_HOSTS", "192.168.1.21")
        monkeypatch.delenv("MYROOM_ENERGY_API_URL", raising=False)
        assert tapo.load_config()["api_url"] == tapo.DEFAULT_API_URL


class TestEnvFiles:
    def test_reads_key_value_pairs_and_ignores_comments(self, tmp_path):
        path = tmp_path / ".env"
        path.write_text(
            "# コメント\n"
            "export TAPO_HOSTS=\"192.168.1.21=冷蔵庫\"\n"
            "\n"
            "TAPO_USERNAME = user@example.com \n"
            "壊れた行\n",
            encoding="utf-8",
        )
        assert tapo.load_env_file(str(path)) == {
            "TAPO_HOSTS": "192.168.1.21=冷蔵庫",
            "TAPO_USERNAME": "user@example.com",
        }

    def test_missing_file_is_not_an_error(self, tmp_path):
        assert tapo.load_env_file(str(tmp_path / "nope.env")) == {}

    def test_existing_environment_wins(self, tmp_path, monkeypatch):
        """systemd や op run で渡した値を .env が上書きしないこと。"""
        path = tmp_path / ".env"
        path.write_text("TAPO_USERNAME=from-file\n", encoding="utf-8")
        monkeypatch.setenv("TAPO_USERNAME", "from-env")
        tapo.apply_env_files([str(path)])
        import os

        assert os.environ["TAPO_USERNAME"] == "from-env"


class TestReadEnergy:
    def test_falls_back_to_legacy_attributes(self):
        """`python-kasa` が古く Module.Energy を持たない場合でも読めること。"""

        class LegacyRealtime:
            power = 41.5

        class LegacyDevice:
            emeter_realtime = LegacyRealtime()
            emeter_today = 1.23
            modules = {}

        assert tapo._read_energy(LegacyDevice()) == {"power_w": 41.5, "kwh_today": 1.23}

    def test_device_without_energy_support(self):
        class PlainDevice:
            modules = {}

        assert tapo._read_energy(PlainDevice()) == {"power_w": None, "kwh_today": None}
