import datetime

from backend import energy, ui_settings


def _rows(values):
    """(日付文字列, kWh) の並びから `_fetch_rows` 相当の行を作る。"""
    return [
        {
            "date": datetime.date.fromisoformat(date),
            "source": "aircon",
            "kwh": kwh,
            "cost_yen": None,
            "updated_at": None,
        }
        for date, kwh in values
    ]


def test_parse_date_accepts_iso_and_date_objects():
    assert energy.parse_date("2026-08-22") == datetime.date(2026, 8, 22)
    assert energy.parse_date("2026-08-22T09:00:00") == datetime.date(2026, 8, 22)
    assert energy.parse_date(datetime.datetime(2026, 8, 22, 9)) == datetime.date(2026, 8, 22)


def test_cost_prefers_value_from_source():
    # 取得元が金額を返してきたら単価を掛け直さない
    assert energy.resolve_cost(2.0, 120.0, 31.0) == 120.0
    assert energy.resolve_cost(2.0, None, 31.0) == 62.0
    assert energy.resolve_cost(None, None, 31.0) is None


def test_summary_totals_split_this_month_and_last_month():
    rows = _rows(
        [
            ("2026-07-20", 2.0),
            ("2026-07-21", 3.0),
            ("2026-07-31", 4.0),
            ("2026-08-01", 1.0),
            ("2026-08-21", 2.0),
            ("2026-08-22", 0.5),
        ]
    )
    summary = energy.build_summary(rows, datetime.date(2026, 8, 22), 30.0, "aircon")

    assert summary["this_month"]["kwh"] == 3.5
    assert summary["this_month"]["cost_yen"] == 105
    assert summary["this_month"]["days"] == 3
    assert summary["last_month"]["kwh"] == 9.0
    # 先月の同じ日（7/22）までなので 7/31 は入らない
    assert summary["last_month_to_date"]["kwh"] == 5.0
    assert summary["today"] == {"date": "2026-08-22", "kwh": 0.5, "cost_yen": 15.0}
    assert summary["yesterday"]["date"] == "2026-08-21"
    assert summary["latest_date"] == "2026-08-22"


def test_summary_handles_month_end_when_previous_month_is_shorter():
    # 8/31 の「先月の同じ日」は 7/31。2月のように短い月でも末日で頭打ちにする
    rows = _rows([("2026-02-28", 1.0), ("2026-03-31", 2.0)])
    summary = energy.build_summary(rows, datetime.date(2026, 3, 31), 30.0, "aircon")
    assert summary["last_month_to_date"]["end"] == "2026-02-28"
    assert summary["last_month_to_date"]["kwh"] == 1.0


def test_summary_without_records_is_empty_but_valid():
    summary = energy.build_summary([], datetime.date(2026, 8, 22), 31.0, "aircon")
    assert summary["today"] is None
    assert summary["yesterday"] is None
    assert summary["this_month"]["kwh"] == 0
    assert summary["daily"] == []
    assert summary["latest_date"] is None


def test_summary_daily_is_limited_to_requested_days():
    rows = _rows([(f"2026-08-{day:02d}", 1.0) for day in range(1, 23)])
    summary = energy.build_summary(
        rows, datetime.date(2026, 8, 22), 31.0, "aircon", history_days=7
    )
    assert len(summary["daily"]) == 7
    assert summary["daily"][0]["date"] == "2026-08-16"


def test_unit_price_falls_back_to_default_for_invalid_values(data_dir):
    ui_settings.save_settings({ui_settings.SETTING_ENERGY_UNIT_PRICE: -5})
    assert ui_settings.get_settings()["energy_unit_price"] == (
        ui_settings.DEFAULT_ENERGY_UNIT_PRICE
    )

    ui_settings.save_settings({ui_settings.SETTING_ENERGY_UNIT_PRICE: 28.5})
    assert ui_settings.get_settings()["energy_unit_price"] == 28.5


def test_energy_summary_requires_auth(client):
    response = client.get("/api/energy/summary")
    assert response.status_code == 401


def test_energy_summary_returns_mock_data(authed_client):
    response = authed_client.get("/api/energy/summary")
    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "aircon"
    assert payload["unit_price"] > 0
    assert len(payload["daily"]) == 30
    assert payload["this_month"]["cost_yen"] >= 0


def test_energy_post_accepts_records(client):
    response = client.post(
        "/api/energy",
        json={"records": [{"date": "2026-08-22", "kwh": 2.4}]},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "mock_ok"


def test_energy_post_rejects_record_without_values(client):
    response = client.post(
        "/api/energy",
        json={"records": [{"date": "2026-08-22"}]},
    )
    assert response.status_code == 422
