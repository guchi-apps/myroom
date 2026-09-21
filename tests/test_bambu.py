"""Bambu Lab A1 mini の状態の正規化・鮮度・遷移・API（#428）。"""

import datetime

import pytest

from backend import bambu

JST = bambu.JST
NOW = datetime.datetime(2026, 9, 21, 12, 0, 0, tzinfo=JST)


def _report(**overrides):
    """実機の全状態（待機・完了済み）を模した `print`。"""
    report = {
        "command": "push_status",
        "gcode_state": "FINISH",
        "mc_percent": 100,
        "mc_remaining_time": 0,
        "layer_num": 75,
        "total_layer_num": 75,
        "subtask_name": "benchy",
        "nozzle_temper": 28.59375,
        "nozzle_target_temper": 0,
        "bed_temper": 28.125,
        "bed_target_temper": 0,
        "spd_lvl": 2,
        "print_error": 0,
        "hms": [],
        "ams": {"ams": [], "tray_now": "254"},
        "vt_tray": {"id": "254", "tray_type": "PLA", "tray_color": "BCBCBCFF", "remain": 0},
    }
    report.update(overrides)
    return report


@pytest.fixture(autouse=True)
def _reset_warnings():
    bambu._warned.clear()
    yield
    bambu._warned.clear()


class TestBuildSnapshot:
    def test_maps_fields(self):
        snapshot = bambu.build_snapshot(_report(), NOW)

        assert snapshot["state"] == "finished"
        assert snapshot["rawState"] == "FINISH"
        assert snapshot["job"]["name"] == "benchy"
        assert snapshot["job"]["progressPercent"] == 100
        assert snapshot["job"]["layer"] == 75
        assert snapshot["job"]["totalLayers"] == 75
        assert snapshot["nozzle"] == {"temperature": 28.6, "target": 0.0}
        assert snapshot["bed"] == {"temperature": 28.1, "target": 0.0}
        assert snapshot["speed"] == {"level": 2, "mode": "standard"}

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("IDLE", "idle"),
            ("PREPARE", "preparing"),
            ("RUNNING", "printing"),
            ("PAUSE", "paused"),
            ("FINISH", "finished"),
            ("FAILED", "failed"),
        ],
    )
    def test_state_mapping(self, raw, expected):
        assert bambu.build_snapshot(_report(gcode_state=raw), NOW)["state"] == expected

    def test_unknown_state_becomes_unknown_and_warns_once(self, caplog):
        with caplog.at_level("WARNING"):
            first = bambu.build_snapshot(_report(gcode_state="CALIBRATING"), NOW)
            bambu.build_snapshot(_report(gcode_state="CALIBRATING"), NOW)

        assert first["state"] == "unknown"
        assert first["rawState"] == "CALIBRATING"
        assert [r.message for r in caplog.records if "CALIBRATING" in r.message].__len__() == 1

    def test_remaining_time_gives_finish_estimate_only_while_active(self):
        printing = bambu.build_snapshot(
            _report(gcode_state="RUNNING", mc_remaining_time=90), NOW
        )
        finished = bambu.build_snapshot(_report(gcode_state="FINISH", mc_remaining_time=90), NOW)

        assert printing["job"]["remainingMinutes"] == 90
        assert printing["job"]["estimatedFinishAt"] == "2026-09-21T13:30:00+09:00"
        assert finished["job"]["remainingMinutes"] is None
        assert finished["job"]["estimatedFinishAt"] is None

    def test_missing_fields_become_null_and_warn(self, caplog):
        with caplog.at_level("WARNING"):
            snapshot = bambu.build_snapshot({"gcode_state": "IDLE"}, NOW)

        assert snapshot["job"]["progressPercent"] is None
        assert snapshot["nozzle"]["temperature"] is None
        assert snapshot["speed"]["mode"] is None
        assert any("想定している項目" in r.message for r in caplog.records)

    def test_ignores_out_of_range_and_non_numeric_values(self):
        snapshot = bambu.build_snapshot(
            _report(mc_percent=250, nozzle_temper="abc", bed_temper=True), NOW
        )

        assert snapshot["job"]["progressPercent"] is None
        assert snapshot["nozzle"]["temperature"] is None
        assert snapshot["bed"]["temperature"] is None

    def test_errors(self):
        snapshot = bambu.build_snapshot(
            _report(
                print_error=0x03004001,
                hms=[{"attr": 0x03000100, "code": 0x00020007}, {"attr": "x", "code": 1}],
            ),
            NOW,
        )

        assert snapshot["errors"]["printError"] == {"code": "0300_4001", "raw": 0x03004001}
        assert snapshot["errors"]["hms"] == [
            {"code": "HMS_0300_0100_0002_0007", "severity": "serious"}
        ]

    def test_no_error_is_null(self):
        assert bambu.build_snapshot(_report(), NOW)["errors"] == {"printError": None, "hms": []}


class TestAms:
    def _ams_report(self, trays, tray_now="1"):
        return _report(
            ams={"ams": [{"id": "0", "humidity": "4", "tray": trays}], "tray_now": tray_now}
        )

    def test_slots_material_color_and_remaining(self):
        snapshot = bambu.build_snapshot(
            self._ams_report(
                [
                    {"id": "0", "tray_type": "PLA", "tray_color": "FF0000FF", "remain": 80,
                     "tray_sub_brands": "PLA Basic"},
                    {"id": "1", "tray_type": "PETG", "tray_color": "00ff00", "remain": -1},
                    {"id": "2"},
                ]
            ),
            NOW,
        )
        ams = snapshot["ams"]

        assert ams["connected"] is True
        assert ams["activeSource"] == "ams"
        assert ams["activeSlot"] == 1
        slots = ams["units"][0]["slots"]
        assert slots[0] == {
            "slot": 0, "empty": False, "material": "PLA", "brand": "PLA Basic",
            "color": "#FF0000", "remainPercent": 80,
        }
        # 残量 -1 は「読めない」
        assert slots[1]["remainPercent"] is None
        assert slots[1]["color"] == "#00FF00"
        assert slots[2]["empty"] is True
        assert slots[2]["color"] is None

    def test_no_ams_uses_external_spool(self):
        ams = bambu.build_snapshot(_report(), NOW)["ams"]

        assert ams["connected"] is False
        assert ams["units"] == []
        assert ams["activeSource"] == "external"
        # 外付けスプールの remain=0 は「不明」で、残量0%ではない
        assert ams["externalSpool"]["material"] == "PLA"
        assert ams["externalSpool"]["remainPercent"] is None

    def test_no_slot_selected(self):
        ams = bambu.build_snapshot(self._ams_report([], tray_now="255"), NOW)["ams"]

        assert ams["activeSource"] == "none"
        assert ams["activeSlot"] is None


class TestTransitions:
    def _snap(self, **overrides):
        return bambu.build_snapshot(_report(**overrides), NOW)

    def test_finished_after_printing(self):
        events = bambu.detect_transition_events(
            self._snap(gcode_state="RUNNING"), self._snap(gcode_state="FINISH"), NOW
        )

        assert [e.kind for e in events] == ["bambu_print_finished"]
        assert events[0].priority == "normal"
        assert events[0].body == "benchy"

    def test_failed_after_printing_is_high_priority(self):
        events = bambu.detect_transition_events(
            self._snap(gcode_state="RUNNING"), self._snap(gcode_state="FAILED"), NOW
        )

        assert [e.kind for e in events] == ["bambu_print_failed"]
        assert events[0].priority == "high"

    def test_paused(self):
        events = bambu.detect_transition_events(
            self._snap(gcode_state="RUNNING"), self._snap(gcode_state="PAUSE"), NOW
        )

        assert [e.kind for e in events] == ["bambu_print_paused"]

    def test_new_error_detected_once(self):
        before = self._snap(gcode_state="RUNNING")
        after = self._snap(gcode_state="RUNNING", print_error=0x03004001)

        assert [e.kind for e in bambu.detect_transition_events(before, after, NOW)] == [
            "bambu_error"
        ]
        # 同じエラーが続いているだけなら再通知しない
        assert bambu.detect_transition_events(after, after, NOW) == []

    def test_info_level_hms_is_not_an_error(self):
        after = self._snap(hms=[{"attr": 0x03000100, "code": 0x00040007}])

        assert bambu.detect_transition_events(self._snap(), after, NOW) == []

    def test_no_previous_means_no_events(self):
        """初回受信で完了済み（FINISH のまま）を「いま完了した」と誤検出しない。"""
        assert bambu.detect_transition_events(None, self._snap(), NOW) == []

    @pytest.mark.parametrize("before", ["IDLE", "FINISH", "FAILED"])
    def test_finished_only_from_active(self, before):
        events = bambu.detect_transition_events(
            self._snap(gcode_state=before), self._snap(gcode_state="FINISH"), NOW
        )

        assert events == []

    def test_no_change_no_events(self):
        assert bambu.detect_transition_events(self._snap(), self._snap(), NOW) == []


class TestBuildResponse:
    def _record(self, *, connected=True, received=NOW, message=NOW):
        return {
            "received_at": received.isoformat(),
            "connected": connected,
            "last_message_at": message.isoformat(),
            "snapshot": bambu.build_snapshot(_report(gcode_state="RUNNING"), message),
        }

    def test_no_data(self):
        response = bambu.build_response(None, NOW)

        assert response["configured"] is False
        assert response["connection"] == "no_data"
        assert response["online"] is False
        assert response["printer"] is None

    def test_online_returns_current_values(self):
        response = bambu.build_response(self._record(), NOW + datetime.timedelta(seconds=30))

        assert response["online"] is True
        assert response["connection"] == "online"
        assert response["ageSeconds"] == 30
        assert response["printer"]["state"] == "printing"
        assert response["lastKnown"] is None

    def test_collector_stale_hides_current_values(self):
        """収集が止まったら、古い温度・進捗を現在値として返さない。"""
        later = NOW + datetime.timedelta(seconds=bambu.DEFAULT_STALE_SECONDS + 1)
        response = bambu.build_response(self._record(), later)

        assert response["online"] is False
        assert response["stale"] is True
        assert response["connection"] == "collector_stale"
        assert response["printer"] is None
        assert response["lastKnown"]["state"] == "printing"
        assert response["ageSeconds"] == bambu.DEFAULT_STALE_SECONDS + 1

    def test_just_inside_threshold_is_online(self):
        later = NOW + datetime.timedelta(seconds=bambu.DEFAULT_STALE_SECONDS)

        assert bambu.build_response(self._record(), later)["online"] is True

    def test_printer_offline_hides_current_values(self):
        response = bambu.build_response(
            self._record(connected=False), NOW + datetime.timedelta(seconds=10)
        )

        assert response["online"] is False
        assert response["stale"] is False
        assert response["connection"] == "printer_offline"
        assert response["printer"] is None
        assert response["lastKnown"] is not None

    def test_stale_threshold_is_configurable(self, monkeypatch):
        monkeypatch.setenv("BAMBU_STALE_SECONDS", "20")
        response = bambu.build_response(self._record(), NOW + datetime.timedelta(seconds=21))

        assert response["connection"] == "collector_stale"
        assert response["staleThresholdSeconds"] == 20

    @pytest.mark.parametrize("value", ["", "abc", "0", "-5"])
    def test_invalid_threshold_falls_back(self, monkeypatch, value):
        monkeypatch.setenv("BAMBU_STALE_SECONDS", value)

        assert bambu.stale_seconds() == bambu.DEFAULT_STALE_SECONDS


class TestRecordState:
    def test_keeps_last_known_snapshot_while_disconnected(self, data_dir):
        bambu.record_state(
            connected=True, report=_report(), last_message_at=NOW.isoformat(), now=NOW
        )
        record, _ = bambu.record_state(
            connected=False,
            report=None,
            last_message_at=None,
            now=NOW + datetime.timedelta(seconds=60),
        )

        assert record["connected"] is False
        assert record["snapshot"]["state"] == "finished"
        assert record["last_message_at"] == NOW.isoformat()

    def test_detects_finish_between_two_posts(self, data_dir):
        bambu.record_state(
            connected=True, report=_report(gcode_state="RUNNING"),
            last_message_at=NOW.isoformat(), now=NOW,
        )
        _, events = bambu.record_state(
            connected=True, report=_report(gcode_state="FINISH"),
            last_message_at=None, now=NOW + datetime.timedelta(seconds=30),
        )

        assert [e.kind for e in events] == ["bambu_print_finished"]

    def test_does_not_compare_with_a_stale_previous_state(self, data_dir):
        """収集が止まっていた間に完了していても、再開直後に「いま完了した」と誤検出しない。"""
        bambu.record_state(
            connected=True, report=_report(gcode_state="RUNNING"),
            last_message_at=NOW.isoformat(), now=NOW,
        )
        _, events = bambu.record_state(
            connected=True, report=_report(gcode_state="FINISH"),
            last_message_at=None,
            now=NOW + datetime.timedelta(seconds=bambu.DEFAULT_STALE_SECONDS + 1),
        )

        assert events == []

    def test_first_post_produces_no_events(self, data_dir):
        _, events = bambu.record_state(
            connected=True, report=_report(), last_message_at=NOW.isoformat(), now=NOW
        )

        assert events == []


# --- API ---------------------------------------------------------------------


def _post(client, **body):
    return client.post("/api/bambu/state", json=body)


def test_post_then_internal_get_roundtrip(client, internal_api_key):
    response = _post(
        client,
        connected=True,
        last_message_at=bambu.now_jst().isoformat(),
        report=_report(gcode_state="RUNNING", mc_percent=42, mc_remaining_time=30),
    )
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "events": []}

    body = client.get(
        "/api/internal/bambu/printer", headers={"Authorization": f"Bearer {internal_api_key}"}
    ).json()

    assert body["online"] is True
    assert body["printer"]["state"] == "printing"
    assert body["printer"]["job"]["progressPercent"] == 42
    assert body["printer"]["job"]["remainingMinutes"] == 30


def test_post_reports_detected_events(client):
    now = bambu.now_jst().isoformat()
    _post(client, connected=True, last_message_at=now, report=_report(gcode_state="RUNNING"))
    response = _post(client, connected=True, last_message_at=now, report=_report(gcode_state="FINISH"))

    assert response.json()["events"] == ["bambu_print_finished"]


def test_post_disconnected_without_report(client, internal_api_key):
    _post(client, connected=True, last_message_at=bambu.now_jst().isoformat(), report=_report())
    assert _post(client, connected=False).status_code == 200

    body = client.get(
        "/api/internal/bambu/printer", headers={"Authorization": f"Bearer {internal_api_key}"}
    ).json()

    assert body["connection"] == "printer_offline"
    assert body["printer"] is None
    assert body["lastKnown"]["state"] == "finished"


def test_post_rejects_oversized_report(client):
    response = _post(client, connected=True, report={"blob": "x" * (bambu.MAX_REPORT_BYTES + 1)})

    assert response.status_code == 422


def test_internal_get_without_data(client, internal_api_key):
    body = client.get(
        "/api/internal/bambu/printer", headers={"Authorization": f"Bearer {internal_api_key}"}
    ).json()

    assert body["configured"] is False
    assert body["printer"] is None


def test_internal_get_requires_configured_key(client, no_internal_api_key):
    response = client.get(
        "/api/internal/bambu/printer", headers={"Authorization": "Bearer anything"}
    )

    assert response.status_code == 503


def test_internal_get_rejects_missing_and_wrong_token(client, internal_api_key):
    assert client.get("/api/internal/bambu/printer").status_code == 401
    assert (
        client.get(
            "/api/internal/bambu/printer", headers={"Authorization": "Bearer wrong"}
        ).status_code
        == 401
    )


def test_internal_get_does_not_accept_control_token(client, internal_api_key, internal_control_api_key):
    """操作用トークンでは読み取りの口を通さない（用途ごとにトークンを分けている）。"""
    response = client.get(
        "/api/internal/bambu/printer",
        headers={"Authorization": f"Bearer {internal_control_api_key}"},
    )

    assert response.status_code == 401


# --- 画面向けの読み取り口（#436） --------------------------------------------


def test_app_get_requires_login(client):
    """画面向けの口はユーザーJWTで守る（未ログインでは読めない）。"""
    assert client.get("/api/bambu/printer").status_code in (401, 403)


def test_app_get_without_data(authed_client):
    body = authed_client.get("/api/bambu/printer").json()

    assert body["configured"] is False
    assert body["connection"] == "no_data"
    assert body["printer"] is None


def test_app_get_returns_same_shape_as_internal(authed_client, internal_api_key):
    _post(
        authed_client,
        connected=True,
        last_message_at=bambu.now_jst().isoformat(),
        report=_report(gcode_state="RUNNING", mc_percent=42, mc_remaining_time=30),
    )

    body = authed_client.get("/api/bambu/printer").json()
    internal = authed_client.get(
        "/api/internal/bambu/printer", headers={"Authorization": f"Bearer {internal_api_key}"}
    ).json()

    assert body["online"] is True
    assert body["printer"]["state"] == "printing"
    assert body["printer"]["job"]["progressPercent"] == 42
    assert set(body) == set(internal)


def test_app_get_hides_current_values_when_printer_offline(authed_client):
    _post(authed_client, connected=True, last_message_at=bambu.now_jst().isoformat(), report=_report())
    _post(authed_client, connected=False)

    body = authed_client.get("/api/bambu/printer").json()

    assert body["online"] is False
    assert body["printer"] is None
    assert body["lastKnown"]["state"] == "finished"
