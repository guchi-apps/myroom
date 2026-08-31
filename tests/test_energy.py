import datetime

from backend import database, energy, ui_settings


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


# ---------------------------------------------------------------- 取得元をまたぐ集計


def _mixed_rows(values):
    """(日付文字列, source, kWh, W) の並びから `_fetch_all_rows` 相当の行を作る。"""
    return [
        {
            "date": datetime.date.fromisoformat(date),
            "source": source,
            "kwh": kwh,
            "cost_yen": None,
            "power_w": power_w,
            "updated_at": None,
        }
        for date, source, kwh, power_w in values
    ]


def test_source_label_strips_the_namespace():
    assert energy.source_label("aircon") == "エアコン"
    assert energy.source_label("tapo:冷蔵庫") == "冷蔵庫"
    # 知らない取得元は生の値を出す（原因を追えるようにするため）
    assert energy.source_label("kepco") == "kepco"


def test_breakdown_sums_across_sources():
    rows = _mixed_rows(
        [
            ("2026-08-22", "aircon", 1.86, None),
            ("2026-08-22", "tapo:冷蔵庫", 0.86, 38.2),
            ("2026-08-22", "tapo:テレビ", 0.31, 72.0),
        ]
    )
    result = energy.build_breakdown(rows, datetime.date(2026, 8, 22), 31.0)

    assert result["today"]["kwh"] == 3.03
    assert result["this_month"]["kwh"] == 3.03
    # 3.03 kWh × 31円 は行ごとに丸めてから足す（57.7 + 26.7 + 9.6）
    assert result["today"]["cost_yen"] == 94
    assert [row["source"] for row in result["sources"]] == [
        "aircon",
        "tapo:冷蔵庫",
        "tapo:テレビ",
    ]


def test_breakdown_counts_days_not_rows():
    """取得元が増えても日数は増えない（`len(rows)` を日数にすると4台で4倍になる）。"""
    rows = _mixed_rows(
        [
            ("2026-08-21", "aircon", 1.0, None),
            ("2026-08-21", "tapo:冷蔵庫", 1.0, 10.0),
            ("2026-08-22", "aircon", 1.0, None),
            ("2026-08-22", "tapo:冷蔵庫", 1.0, 10.0),
        ]
    )
    result = energy.build_breakdown(rows, datetime.date(2026, 8, 22), 31.0)
    assert result["this_month"]["days"] == 2


def test_breakdown_puts_aircon_first_then_heaviest_plug():
    rows = _mixed_rows(
        [
            ("2026-08-22", "tapo:テレビ", 0.3, 72.0),
            ("2026-08-22", "tapo:冷蔵庫", 0.9, 38.0),
            ("2026-08-22", "aircon", 0.1, None),
        ]
    )
    result = energy.build_breakdown(rows, datetime.date(2026, 8, 22), 31.0)
    assert [row["label"] for row in result["sources"]] == ["エアコン", "冷蔵庫", "テレビ"]


def test_breakdown_keeps_watts_only_for_today():
    rows = _mixed_rows(
        [
            ("2026-08-21", "tapo:冷蔵庫", 1.0, 99.0),
            ("2026-08-22", "tapo:冷蔵庫", 0.5, 38.2),
            ("2026-08-22", "aircon", 1.0, None),
        ]
    )
    result = energy.build_breakdown(rows, datetime.date(2026, 8, 22), 31.0)
    by_source = {row["source"]: row for row in result["sources"]}
    assert by_source["tapo:冷蔵庫"]["power_w"] == 38.2
    # エアコンは瞬時値を返さない
    assert by_source["aircon"]["power_w"] is None


def test_breakdown_daily_carries_the_split_per_source():
    rows = _mixed_rows(
        [
            ("2026-08-22", "aircon", 1.86, None),
            ("2026-08-22", "tapo:冷蔵庫", 0.86, 38.2),
        ]
    )
    result = energy.build_breakdown(rows, datetime.date(2026, 8, 22), 31.0)
    assert result["daily"] == [
        {
            "date": "2026-08-22",
            "kwh": 2.72,
            "cost_yen": 84,
            "by_source": {"aircon": 1.86, "tapo:冷蔵庫": 0.86},
        }
    ]


def test_breakdown_without_records_is_empty_but_valid():
    result = energy.build_breakdown([], datetime.date(2026, 8, 22), 31.0)
    assert result["sources"] == []
    assert result["daily"] == []
    assert result["today"]["kwh"] == 0
    assert result["latest_date"] is None


def test_energy_breakdown_requires_auth(client):
    response = client.get("/api/energy/breakdown")
    assert response.status_code == 401


def test_energy_breakdown_returns_mock_data(authed_client):
    response = authed_client.get("/api/energy/breakdown")
    assert response.status_code == 200
    payload = response.json()
    assert payload["unit_price"] > 0
    assert len(payload["daily"]) == 30
    labels = [row["label"] for row in payload["sources"]]
    assert labels[0] == "エアコン"
    assert "冷蔵庫" in labels
    # 内訳を足すとその日の合計になる
    day = payload["daily"][-1]
    assert round(sum(day["by_source"].values()), 2) == day["kwh"]


def test_energy_post_accepts_watts(client):
    response = client.post(
        "/api/energy",
        json={
            "records": [
                {"date": "2026-08-22", "source": "tapo:冷蔵庫", "kwh": 0.86, "power_w": 38.2}
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "mock_ok"


# ---------------------------------------------------------------- 時間ごと（#300）


def _reading(hour, minute, kwh, source="aircon", cost_yen=None, date="2026-08-22"):
    return {
        "recorded_at": datetime.datetime.combine(
            datetime.date.fromisoformat(date), datetime.time(hour, minute)
        ),
        "source": source,
        "kwh": kwh,
        "cost_yen": cost_yen,
    }


def test_build_hourly_computes_deltas_between_snapshots():
    readings = [_reading(8, 0, 0.5), _reading(9, 0, 1.2)]
    result = energy.build_hourly(readings, datetime.date(2026, 8, 22), 31.0)

    hours = {row["hour"]: row for row in result["hours"]}
    assert result["has_data"] is True
    assert result["sources"] == ["aircon"]
    # 8時台の直前にスナップショットが無いので、8時の累計(0.5)がそのままその時間帯の使用量になる
    assert hours[8]["kwh"] == 0.5
    assert hours[8]["cost_yen"] == round(energy.resolve_cost(0.5, None, 31.0))
    assert hours[9]["kwh"] == 0.7
    # 7時台は最初のスナップショットより前なので「まだ分からない」
    assert hours[7]["kwh"] is None
    # 10時台以降は新しいスナップショットが無いので差分0（直近値のまま）
    assert hours[10]["kwh"] == 0.0
    assert hours[23]["kwh"] == 0.0


def test_build_hourly_splits_by_source():
    readings = [
        _reading(8, 0, 0.5, source="aircon"),
        _reading(8, 0, 0.1, source="tapo:冷蔵庫"),
    ]
    result = energy.build_hourly(readings, datetime.date(2026, 8, 22), 31.0)
    hour8 = next(row for row in result["hours"] if row["hour"] == 8)
    assert hour8["by_source"] == {"aircon": 0.5, "tapo:冷蔵庫": 0.1}
    assert hour8["kwh"] == 0.6
    assert result["sources"] == ["aircon", "tapo:冷蔵庫"]


def test_build_hourly_prefers_source_cost_over_unit_price():
    readings = [_reading(8, 0, 0.5, cost_yen=20.0), _reading(9, 0, 1.2, cost_yen=50.0)]
    result = energy.build_hourly(readings, datetime.date(2026, 8, 22), 31.0)
    hours = {row["hour"]: row for row in result["hours"]}
    assert hours[9]["cost_yen"] == 30  # 実額の差分（50-20）


def test_build_hourly_without_readings_has_no_data():
    result = energy.build_hourly([], datetime.date(2026, 8, 22), 31.0)
    assert result["has_data"] is False
    assert result["sources"] == []
    assert all(row["kwh"] is None for row in result["hours"])
    assert len(result["hours"]) == 24


def test_energy_hourly_requires_auth(client):
    response = client.get("/api/energy/hourly", params={"date": "2026-08-22"})
    assert response.status_code == 401


def test_energy_hourly_returns_mock_data_for_today(authed_client):
    today = database._today_jst().isoformat()
    response = authed_client.get("/api/energy/hourly", params={"date": today})
    assert response.status_code == 200
    payload = response.json()
    assert payload["date"] == today
    assert payload["has_data"] is True
    assert len(payload["hours"]) == 24


def test_energy_hourly_reports_no_data_for_old_dates(authed_client):
    old_date = (database._today_jst() - datetime.timedelta(days=10)).isoformat()
    response = authed_client.get("/api/energy/hourly", params={"date": old_date})
    assert response.status_code == 200
    assert response.json()["has_data"] is False
