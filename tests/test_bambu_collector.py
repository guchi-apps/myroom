"""Bambu 収集スクリプト（collectors/bambu_to_myroom.py）の、プリンターに繋がない部分のテスト。

`collectors/` はパッケージではないため、ファイルパスから直接読み込む。
`paho-mqtt` は収集用 venv にしか入っていないので、**入っていなくても import できること
自体**もここで担保する。
"""

import importlib.util
import json
import logging
import pathlib
import ssl

import pytest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "collectors" / "bambu_to_myroom.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("bambu_to_myroom", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bambu = _load_module()


def _message(**print_fields):
    return json.dumps({"print": {"command": "push_status", **print_fields}}).encode()


def _full_report(**overrides):
    """全状態（20項目以上）。項目名は実機のもの。"""
    report = {key: 0 for key in bambu.KNOWN_PRINT_KEYS if key != "command"}
    report.update(
        {"gcode_state": "IDLE", "hms": [], "ams": {"ams": [], "tray_now": "255"}, "subtask_name": ""}
    )
    report.update(overrides)
    return report


class TestMergeReport:
    def test_scalars_are_overwritten_and_others_kept(self):
        merged = bambu.merge_report({"a": 1, "b": 2}, {"b": 3, "c": 4})

        assert merged == {"a": 1, "b": 3, "c": 4}

    def test_does_not_mutate_arguments(self):
        current = {"a": {"x": 1}}
        bambu.merge_report(current, {"a": {"y": 2}})

        assert current == {"a": {"x": 1}}

    def test_nested_dicts_are_merged(self):
        merged = bambu.merge_report(
            {"ams": {"tray_now": "0", "version": 3}}, {"ams": {"tray_now": "1"}}
        )

        assert merged == {"ams": {"tray_now": "1", "version": 3}}

    def test_id_lists_merge_by_id_without_dropping_other_trays(self):
        current = {
            "ams": {
                "ams": [
                    {
                        "id": "0",
                        "humidity": "4",
                        "tray": [
                            {"id": "0", "tray_type": "PLA", "remain": 80},
                            {"id": "1", "tray_type": "PETG", "remain": 50},
                        ],
                    }
                ]
            }
        }
        update = {"ams": {"ams": [{"id": "0", "tray": [{"id": "1", "remain": 49}]}]}}

        merged = bambu.merge_report(current, update)

        unit = merged["ams"]["ams"][0]
        assert unit["humidity"] == "4"
        assert unit["tray"] == [
            {"id": "0", "tray_type": "PLA", "remain": 80},
            {"id": "1", "tray_type": "PETG", "remain": 49},
        ]

    def test_new_id_is_appended(self):
        merged = bambu.merge_report(
            {"ams": {"ams": [{"id": "0"}]}}, {"ams": {"ams": [{"id": "1"}]}}
        )

        assert [unit["id"] for unit in merged["ams"]["ams"]] == ["0", "1"]

    def test_plain_lists_are_replaced(self):
        """`hms` は差分ではなく現在の一覧。解消されたエラーが残り続けてはいけない。"""
        merged = bambu.merge_report(
            {"hms": [{"attr": 1, "code": 2}]}, {"hms": []}
        )

        assert merged["hms"] == []


class TestSignificantView:
    def test_ignores_wifi_signal_and_sequence(self):
        a = bambu.significant_view({"gcode_state": "IDLE", "wifi_signal": "-50dBm", "sequence_id": "1"})
        b = bambu.significant_view({"gcode_state": "IDLE", "wifi_signal": "-60dBm", "sequence_id": "9"})

        assert a == b

    def test_rounds_temperatures(self):
        a = bambu.significant_view({"nozzle_temper": 200.2})
        b = bambu.significant_view({"nozzle_temper": 200.4})
        c = bambu.significant_view({"nozzle_temper": 202.0})

        assert a == b
        assert a != c

    def test_state_and_progress_changes_count(self):
        base = {"gcode_state": "RUNNING", "mc_percent": 10}

        assert bambu.significant_view(base) != bambu.significant_view({**base, "mc_percent": 11})
        assert bambu.significant_view(base) != bambu.significant_view({**base, "gcode_state": "PAUSE"})


class TestBackoff:
    def test_grows_and_caps(self):
        delays = [bambu.backoff_delay(n, rng=lambda: 0.5) for n in range(10)]

        assert delays[0] == pytest.approx(bambu.BACKOFF_BASE)
        assert delays == sorted(delays)
        assert max(delays) == pytest.approx(bambu.BACKOFF_MAX)

    def test_jitter_stays_within_twenty_percent(self):
        low = bambu.backoff_delay(3, rng=lambda: 0.0)
        high = bambu.backoff_delay(3, rng=lambda: 1.0)
        base = bambu.BACKOFF_BASE * 2**3

        assert low == pytest.approx(base * 0.8)
        assert high == pytest.approx(base * 1.2)

    def test_negative_attempt_is_treated_as_zero(self):
        assert bambu.backoff_delay(-3, rng=lambda: 0.5) == pytest.approx(bambu.BACKOFF_BASE)


class TestMaskingFormatter:
    def _format(self, secrets, message, *args, exc_info=None):
        formatter = bambu.MaskingFormatter(secrets, "%(message)s")
        record = logging.LogRecord("t", logging.INFO, __file__, 1, message, args, exc_info)
        return formatter.format(record)

    def test_masks_serial_and_access_code_in_message(self):
        out = self._format(["01P00A123456789", "12345678"], "topic device/01P00A123456789/report code=%s", "12345678")

        assert "01P00A123456789" not in out
        assert "12345678" not in out
        assert "***" in out

    def test_masks_values_in_tracebacks(self):
        try:
            raise RuntimeError("bad code 12345678")
        except RuntimeError:
            import sys

            out = self._format(["12345678"], "failed", exc_info=sys.exc_info())

        assert "12345678" not in out
        assert "RuntimeError" in out

    def test_short_values_are_not_masked(self):
        """空や極端に短い値を伏せると、無関係な文字列まで潰れる。"""
        assert self._format(["", "ab"], "about") == "about"


class TestBambuMonitor:
    def test_requires_full_report_before_connected(self):
        monitor = bambu.BambuMonitor()
        monitor.new_session()

        monitor.handle_message(_message(bed_temper=20.0, wifi_signal="-40dBm"))
        assert monitor.snapshot(True)["connected"] is False

        monitor.handle_message(_message(**_full_report()))
        payload = monitor.snapshot(True)
        assert payload["connected"] is True
        assert payload["report"]["gcode_state"] == "IDLE"

    def test_reconnect_waits_for_a_new_full_report(self):
        monitor = bambu.BambuMonitor()
        monitor.handle_message(_message(**_full_report()))
        assert monitor.snapshot(True)["connected"] is True

        monitor.new_session()

        assert monitor.snapshot(True)["connected"] is False

    def test_disconnected_payload_omits_report(self):
        monitor = bambu.BambuMonitor()
        monitor.handle_message(_message(**_full_report()))

        payload = monitor.snapshot(False)

        assert payload["connected"] is False
        assert "report" not in payload

    def test_diffs_are_merged_into_full_state(self):
        monitor = bambu.BambuMonitor()
        monitor.handle_message(_message(**_full_report(mc_percent=10)))
        monitor.handle_message(_message(mc_percent=11))

        report = monitor.snapshot(True)["report"]

        assert report["mc_percent"] == 11
        assert report["gcode_state"] == "IDLE"

    def test_has_change_only_for_significant_changes(self):
        monitor = bambu.BambuMonitor()
        monitor.handle_message(_message(**_full_report()))
        assert monitor.has_change() is True
        monitor.mark_sent()
        assert monitor.has_change() is False

        monitor.handle_message(_message(wifi_signal="-70dBm", sequence_id="5"))
        assert monitor.has_change() is False

        monitor.handle_message(_message(gcode_state="RUNNING"))
        assert monitor.has_change() is True

    def test_ignores_non_status_commands_and_other_top_level_keys(self, caplog):
        monitor = bambu.BambuMonitor()
        with caplog.at_level("WARNING"):
            assert monitor.handle_message(json.dumps({"print": {"command": "gcode_line", "x": 1}}).encode()) is False
            assert monitor.handle_message(json.dumps({"info": {"command": "get_version"}}).encode()) is False

        assert monitor.report == {}
        assert any("print 以外の種別" in r.message for r in caplog.records)

    def test_bad_json_is_ignored(self):
        assert bambu.BambuMonitor().handle_message(b"not json") is False
        assert bambu.BambuMonitor().handle_message(b"[1, 2]") is False

    def test_warns_once_on_new_keys(self, caplog):
        monitor = bambu.BambuMonitor()
        with caplog.at_level("WARNING"):
            monitor.handle_message(_message(brand_new_field=1))
            monitor.handle_message(_message(brand_new_field=2))

        assert len([r for r in caplog.records if "brand_new_field" in r.message]) == 1

    def test_warns_when_expected_keys_are_missing_from_full_report(self, caplog):
        report = _full_report()
        del report["mc_percent"]
        monitor = bambu.BambuMonitor()
        with caplog.at_level("WARNING"):
            monitor.handle_message(_message(**report))

        assert any("mc_percent" in r.message and "想定している項目" in r.message for r in caplog.records)


class TestPayloadAndMessages:
    def test_pushall_is_the_only_request_and_is_not_a_control_command(self):
        message = json.loads(bambu.pushall_message())

        assert list(message) == ["pushing"]
        assert message["pushing"]["command"] == "pushall"

    def test_build_payload_formats_jst_timestamp(self):
        import datetime

        moment = datetime.datetime(2026, 9, 21, 3, 0, 0, tzinfo=datetime.timezone.utc)
        payload = bambu.build_payload(True, {"a": 1}, moment)

        assert payload["last_message_at"] == "2026-09-21T12:00:00+09:00"

    def test_expected_keys_match_backend(self):
        from backend import bambu as backend_bambu

        assert bambu.EXPECTED_KEYS == backend_bambu.EXPECTED_KEYS


class TestConfigAndErrors:
    def test_load_config_requires_connection_settings(self, monkeypatch):
        for name in ("BAMBU_HOST", "BAMBU_SERIAL", "BAMBU_ACCESS_CODE"):
            monkeypatch.delenv(name, raising=False)

        with pytest.raises(bambu.ConfigError, match="BAMBU_HOST"):
            bambu.load_config()

    def test_load_config_reads_values(self, monkeypatch):
        monkeypatch.setenv("BAMBU_HOST", "192.168.2.50")
        monkeypatch.setenv("BAMBU_SERIAL", "SERIAL0001")
        monkeypatch.setenv("BAMBU_ACCESS_CODE", "12345678")
        monkeypatch.delenv("MYROOM_BAMBU_API_URL", raising=False)

        config = bambu.load_config()

        assert config["host"] == "192.168.2.50"
        assert config["api_url"] == bambu.DEFAULT_API_URL

    def test_env_file_parser(self, tmp_path):
        env = tmp_path / ".env"
        env.write_text('# c\nBAMBU_HOST=1.2.3.4\nexport BAMBU_SERIAL="S1"\n', encoding="utf-8")

        assert bambu.load_env_file(str(env)) == {"BAMBU_HOST": "1.2.3.4", "BAMBU_SERIAL": "S1"}

    def test_classify_connect_errors(self):
        assert "証明書" in bambu.classify_connect_error(ssl.SSLCertVerificationError())
        assert "TLS" in bambu.classify_connect_error(ssl.SSLError())
        assert "電源" in bambu.classify_connect_error(TimeoutError())
        assert "電源" in bambu.classify_connect_error(OSError("unreachable"))

    def test_refused_connection_points_at_access_code(self):
        message = bambu.describe_failure("disconnected", None, "Not authorized")

        assert "アクセスコード" in message

    def test_module_imports_without_paho(self):
        """paho-mqtt が無い環境（バックエンドのテスト環境）でも import できる。"""
        assert hasattr(bambu, "Session")

    def test_tls_context_verifies_certificate_but_not_hostname(self):
        context = bambu.build_tls_context(_self_signed_pem())

        assert context.verify_mode == ssl.CERT_REQUIRED
        assert context.check_hostname is False


def _self_signed_pem() -> str:
    """テスト用の自己署名証明書（`cryptography` はバックエンドの依存に含まれる）。"""
    import datetime

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    return cert.public_bytes(serialization.Encoding.PEM).decode()


class TestPushallInterval:
    def test_first_request_is_allowed(self):
        assert bambu.BambuMonitor().pushall_allowed() is True

    def test_reconnect_within_minimum_interval_is_not_allowed(self):
        """再接続が連発しても、5分未満の間隔では pushall を要求しない。"""
        clock = [1000.0]
        monitor = bambu.BambuMonitor(now=lambda: clock[0])
        monitor.mark_pushall()

        clock[0] += bambu.PUSHALL_MIN_INTERVAL - 1
        assert monitor.pushall_allowed() is False

        clock[0] += 1
        assert monitor.pushall_allowed() is True

    def test_minimum_interval_is_at_least_five_minutes(self):
        assert bambu.PUSHALL_MIN_INTERVAL >= 300
        assert bambu.PUSHALL_INTERVAL >= bambu.PUSHALL_MIN_INTERVAL


# --- 3mf から読む造形の使用量（#454）-----------------------------------------------

import io
import zipfile

# 実機（A1 mini）の 3mf の `Metadata/slice_info.config`。`error_code =` の前の空白も実物のまま
SLICE_INFO = """<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="weight" value="24.41"/>
    <object identify_id="78" name="ボディ1" skipped="false" />
    <filament id="1" tray_info_idx="GFL99" type="PLA" color="#BCBCBC" used_m="8.18" used_g="24.41" group_id="0" nozzle_diameter="0.40" volume_type="Standard" used_for_object="true" used_for_support="false"/>
    <warning msg="bed_temperature_too_high_than_filament" level="3" error_code ="1000C001"  />
  </plate>
</config>
"""


def _make_3mf(slice_info=SLICE_INFO):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("Metadata/plate_1.json", "{}")
        if slice_info is not None:
            archive.writestr("Metadata/slice_info.config", slice_info)
    return buffer.getvalue()


class TestSliceInfo:
    def test_reads_used_grams_per_filament(self):
        assert bambu.parse_slice_info(SLICE_INFO) == [
            {"id": 1, "type": "PLA", "color": "#BCBCBC", "used_g": 24.41}
        ]

    def test_reads_it_out_of_the_3mf_archive(self):
        assert bambu.read_filaments_from_3mf(_make_3mf())[0]["used_g"] == 24.41

    def test_several_filaments_are_all_returned(self):
        xml = SLICE_INFO.replace(
            "</plate>", '<filament id="2" type="PETG" color="#FF0000" used_g="3.5"/></plate>'
        )

        assert [item["used_g"] for item in bambu.parse_slice_info(xml)] == [24.41, 3.5]

    def test_several_plates_cannot_be_told_apart(self):
        xml = SLICE_INFO.replace("</config>", SLICE_INFO.split("<config>")[1])

        assert bambu.parse_slice_info(xml) is None

    @pytest.mark.parametrize(
        "text",
        [
            "not xml",
            "<config><plate></plate></config>",
            '<config><plate><filament id="1" used_g="0"/></plate></config>',
            '<config><plate><filament id="1" used_g="abc"/></plate></config>',
            '<config><plate><filament id="1" used_g="nan"/></plate></config>',
        ],
    )
    def test_unusable_content_returns_none(self, text):
        assert bambu.parse_slice_info(text) is None

    def test_broken_or_incomplete_archives_return_none(self):
        assert bambu.read_filaments_from_3mf(b"not a zip") is None
        assert bambu.read_filaments_from_3mf(_make_3mf(slice_info=None)) is None


class TestThreemfPaths:
    def test_cache_first_then_root_with_both_naming_styles(self):
        assert bambu.threemf_paths("50x110 ケース.3mf") == [
            "/cache/50x110 ケース.3mf",
            "/cache/50x110 ケース.gcode.3mf",
            "/50x110 ケース.3mf",
            "/50x110 ケース.gcode.3mf",
        ]

    def test_name_without_extension_tries_both_extensions(self):
        assert "/箸立て.gcode.3mf" in bambu.threemf_paths("箸立て")
        assert "/cache/箸立て.3mf" in bambu.threemf_paths("箸立て")

    @pytest.mark.parametrize(
        "name", ["", ".hidden.3mf", "../etc/passwd", "a/b.3mf", "a\\b.3mf", "a\r\nDELE x", "a\x00b"]
    )
    def test_names_that_are_not_plain_file_names_are_refused(self, name):
        """プリンターから届いた文字列を、そのままFTPのコマンドへ入れない。"""
        assert bambu.threemf_paths(name) == []


class TestJobTracking:
    FILAMENTS = [{"id": 1, "type": "PLA", "color": "#BCBCBC", "used_g": 24.41}]

    def _monitor(self):
        clock = {"now": 1000.0}
        monitor = bambu.BambuMonitor(now=lambda: clock["now"])
        monitor.clock = clock
        return monitor

    def _running(self, monitor, name="benchy", **fields):
        monitor.handle_message(
            _message(**_full_report(gcode_state="RUNNING", subtask_name=name, **fields))
        )

    def test_starting_a_job_asks_for_its_3mf_once(self):
        monitor = self._monitor()
        self._running(monitor)

        request = monitor.take_fetch_request()

        assert request["name"] == "benchy"
        assert request["key"].startswith("benchy@")
        assert monitor.take_fetch_request() is None  # 読み込み中は重ねて頼まない

    def test_idle_printer_asks_for_nothing(self):
        monitor = self._monitor()
        monitor.handle_message(_message(**_full_report()))

        assert monitor.take_fetch_request() is None

    def test_a_job_without_a_name_yet_is_not_started(self):
        """接続直後の差分には状態だけが来て、名前が無いことがある。"""
        monitor = self._monitor()
        monitor.handle_message(_message(**_full_report(gcode_state="RUNNING", subtask_name="")))

        assert monitor.take_fetch_request() is None

    def test_result_is_sent_with_the_payload(self):
        monitor = self._monitor()
        self._running(monitor)
        request = monitor.take_fetch_request()

        assert monitor.finish_fetch(request["key"], self.FILAMENTS) is True

        assert monitor.snapshot(True)["job_filament"] == {
            "job_key": request["key"],
            "name": "benchy",
            "filaments": self.FILAMENTS,
        }
        assert monitor.take_fetch_request() is None  # 読めたら取りに行かない

    def test_payload_omits_it_until_read(self):
        monitor = self._monitor()
        self._running(monitor)

        assert "job_filament" not in monitor.snapshot(True)

    def test_a_new_result_counts_as_a_change_to_send(self):
        monitor = self._monitor()
        self._running(monitor)
        monitor.mark_sent()
        assert monitor.has_change() is False

        monitor.finish_fetch(monitor.take_fetch_request()["key"], self.FILAMENTS)

        assert monitor.has_change() is True
        monitor.mark_sent()
        assert monitor.has_change() is False

    def test_result_survives_the_end_of_the_print(self):
        """完了の瞬間に MyRoom へ渡すのに要るので、造形が終わっても消さない。"""
        monitor = self._monitor()
        self._running(monitor)
        monitor.finish_fetch(monitor.take_fetch_request()["key"], self.FILAMENTS)

        monitor.handle_message(
            _message(**_full_report(gcode_state="FINISH", subtask_name="benchy"))
        )

        assert monitor.snapshot(True)["job_filament"]["name"] == "benchy"

    def test_next_job_starts_over_even_with_the_same_file(self):
        monitor = self._monitor()
        self._running(monitor)
        first = monitor.take_fetch_request()
        monitor.finish_fetch(first["key"], self.FILAMENTS)
        monitor.handle_message(
            _message(**_full_report(gcode_state="FINISH", subtask_name="benchy"))
        )
        monitor.clock["now"] += 3600

        self._running(monitor)
        second = monitor.take_fetch_request()

        assert second is not None
        assert "job_filament" not in monitor.snapshot(True)
        assert monitor.finish_fetch(first["key"], self.FILAMENTS) is False  # 古い結果は捨てる

    def test_failures_are_retried_with_a_pause_then_given_up(self, caplog):
        monitor = self._monitor()
        self._running(monitor)

        for delay in bambu.FETCH_RETRY_DELAYS:
            request = monitor.take_fetch_request()
            assert request is not None
            assert monitor.finish_fetch(request["key"], None) is False
            assert monitor.take_fetch_request() is None  # 間隔が空くまで待つ
            monitor.clock["now"] += delay
        request = monitor.take_fetch_request()
        with caplog.at_level(logging.WARNING, logger="bambu_to_myroom"):
            monitor.finish_fetch(request["key"], None)

        monitor.clock["now"] += 10_000
        assert monitor.take_fetch_request() is None
        assert any("自動では引かれません" in record.getMessage() for record in caplog.records)
