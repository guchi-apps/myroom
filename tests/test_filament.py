import datetime

import pytest

from backend import filament

TODAY = datetime.date(2026, 9, 21)
NOW = datetime.datetime(2026, 9, 21, 13, 30, tzinfo=filament.JST)


def spool(**overrides):
    base = {
        "id": "s1",
        "name": "ELEGOO PLA (グレー)",
        "material": "PLA",
        "color": "#8C8F94",
        "net_g": 1000,
        "tare_g": 152,
        "weighings": [],
        "usages": [],
    }
    base.update(overrides)
    return filament.normalize_document({"spools": [base]})["spools"][0]


def weighing(date, gross, recorded_at="2026-09-14T10:00:00+09:00"):
    return {"id": f"w-{date}", "date": date, "gross_g": gross, "recorded_at": recorded_at}


def usage(date, grams, recorded_at="2026-09-18T20:00:00+09:00", note=""):
    return {
        "id": f"u-{date}-{grams}",
        "date": date,
        "grams": grams,
        "note": note,
        "recorded_at": recorded_at,
    }


# --- 残量の計算 ---------------------------------------------------------------


def test_remaining_from_weighing_matches_notion():
    """Notionのグレー（初期全体1152g・初期量1000g・現在全体1011g）は 859g・86%。"""
    result = filament.compute_remaining(
        spool(weighings=[weighing("2026-08-10", 1011)])
    )
    assert result["remaining_g"] == 859
    assert result["percent"] == 86
    assert result["base"]["kind"] == "weighing"
    assert result["level"] == "ok"


def test_remaining_without_weighing_starts_from_net_amount():
    result = filament.compute_remaining(spool(usages=[usage("2026-09-18", 26)]))
    assert result["remaining_g"] == 974
    assert result["base"]["kind"] == "initial"
    assert result["used_since_g"] == 26


def test_usage_after_weighing_is_subtracted():
    result = filament.compute_remaining(
        spool(
            weighings=[weighing("2026-09-14", 611)],
            usages=[usage("2026-09-18", 26), usage("2026-09-21", 42)],
        )
    )
    # 611 - 152 = 459、そこから 68 引く
    assert result["remaining_g"] == 391
    assert result["percent"] == 39
    assert result["used_since_count"] == 2


def test_usage_before_weighing_is_already_in_the_weight():
    """計量より前の印刷は、量った重さにすでに含まれる。二重に引かない。"""
    result = filament.compute_remaining(
        spool(
            weighings=[weighing("2026-09-14", 611)],
            usages=[usage("2026-09-10", 80), usage("2026-09-18", 26)],
        )
    )
    assert result["remaining_g"] == 433
    assert result["used_since_count"] == 1


def test_backdated_usage_entered_after_weighing_is_not_counted():
    """計量のあとに、計量より前の日の印刷を入れ忘れて登録しても数えない。"""
    result = filament.compute_remaining(
        spool(
            weighings=[weighing("2026-09-14", 611, "2026-09-14T10:00:00+09:00")],
            usages=[usage("2026-09-13", 50, recorded_at="2026-09-15T09:00:00+09:00")],
        )
    )
    assert result["remaining_g"] == 459


def test_same_day_usage_is_ordered_by_recorded_time():
    weighed = weighing("2026-09-14", 611, "2026-09-14T10:00:00+09:00")
    before = usage("2026-09-14", 30, recorded_at="2026-09-14T09:00:00+09:00")
    after = usage("2026-09-14", 20, recorded_at="2026-09-14T11:00:00+09:00")
    result = filament.compute_remaining(
        spool(weighings=[weighed], usages=[before, after])
    )
    assert result["remaining_g"] == 439


def test_latest_weighing_wins_even_when_entered_out_of_order():
    result = filament.compute_remaining(
        spool(weighings=[weighing("2026-09-14", 611), weighing("2026-09-01", 900)])
    )
    assert result["remaining_g"] == 459


def test_weighing_is_ignored_when_tare_is_unknown():
    """空スプールの重さが分からなければ、全体重量から残量を出せない。"""
    result = filament.compute_remaining(
        spool(tare_g=None, weighings=[weighing("2026-09-14", 611)])
    )
    assert result["base"]["kind"] == "initial"
    assert result["remaining_g"] == 1000


def test_remaining_never_goes_below_zero_and_percent_stops_at_100():
    empty = filament.compute_remaining(spool(usages=[usage("2026-09-18", 1200)]))
    assert empty["remaining_g"] == 0
    assert empty["level"] == "empty"

    overweight = filament.compute_remaining(
        spool(weighings=[weighing("2026-09-14", 1200)])
    )
    assert overweight["remaining_g"] == 1048
    assert overweight["percent"] == 100


def test_low_level_below_ten_percent():
    result = filament.compute_remaining(
        spool(weighings=[weighing("2026-09-14", 152 + 99)])
    )
    assert result["percent"] == 10
    assert result["level"] == "ok"
    result = filament.compute_remaining(
        spool(weighings=[weighing("2026-09-14", 152 + 90)])
    )
    assert result["percent"] == 9
    assert result["level"] == "low"


# --- 正規化 -------------------------------------------------------------------


def test_normalize_drops_broken_entries_and_fixes_defaults():
    document = filament.normalize_document(
        {
            "active_id": "missing",
            "spools": [
                {"name": ""},
                "壊れた行",
                {
                    "name": "  Ｂａｍｂｕ  PLA ",
                    "material": "ナイロン",
                    "color": "red",
                    "net_g": "abc",
                    "tare_g": -5,
                    "usages": [{"date": "2026-13-40", "grams": 10}, {"date": "2026-09-18", "grams": 0}],
                },
            ],
        }
    )
    assert document["active_id"] is None
    (item,) = document["spools"]
    assert item["name"] == "Bambu PLA"
    assert item["material"] == "その他"
    assert item["color"] is None
    assert item["net_g"] == 1000
    assert item["tare_g"] is None
    assert item["usages"] == []


def test_normalize_clears_active_when_spool_is_archived():
    document = filament.normalize_document(
        {"active_id": "s1", "spools": [{"id": "s1", "name": "A", "archived": True}]}
    )
    assert document["active_id"] is None


def test_normalize_survives_garbage():
    assert filament.normalize_document(None) == {"active_id": None, "spools": []}
    assert filament.normalize_document("x") == {"active_id": None, "spools": []}


# --- 操作（DB_MOCK のファイル保存） -------------------------------------------


@pytest.fixture
def store(data_dir):
    return data_dir


def add(**fields):
    return filament.add_spool({"name": "ELEGOO PLA (ホワイト)", "tare_g": 152, **fields}, today=TODAY, now=NOW)


def test_first_spool_becomes_active_and_second_does_not(store):
    first = add()
    assert first["active_id"] == first["spools"][0]["id"]
    second = add(name="ブラック")
    assert second["active_id"] == first["active_id"]
    assert len(second["spools"]) == 2


def test_add_with_current_gross_records_first_weighing(store):
    document = add(current_gross_g=611)
    payload = filament.build_payload(document)
    view = payload["spools"][0]
    assert view["remaining_g"] == 459
    assert view["base"]["kind"] == "weighing"
    assert view["weighings"][0]["date"] == "2026-09-21"


def test_add_with_current_gross_requires_tare(store):
    with pytest.raises(filament.FilamentError):
        add(tare_g=None, current_gross_g=611)


def test_add_rejects_bad_input(store):
    with pytest.raises(filament.FilamentError):
        filament.add_spool({"name": " "}, today=TODAY, now=NOW)
    with pytest.raises(filament.FilamentError):
        add(net_g=0)
    with pytest.raises(filament.FilamentError):
        add(tare_g=99999)
    with pytest.raises(filament.FilamentError):
        add(purchased_on="2099-01-01")


def test_record_usage_and_remove(store):
    document = add()
    spool_id = document["spools"][0]["id"]
    document = filament.record_usage(spool_id, 42, date="2026-09-20", note="benchy", today=TODAY, now=NOW)
    view = filament.build_payload(document)["spools"][0]
    assert view["remaining_g"] == 958
    assert view["usages"][0]["note"] == "benchy"
    assert view["usages"][0]["counted"] is True

    usage_id = view["usages"][0]["id"]
    document = filament.remove_usage(spool_id, usage_id)
    assert filament.build_payload(document)["spools"][0]["remaining_g"] == 1000


def test_record_usage_rejects_bad_input(store):
    spool_id = add()["spools"][0]["id"]
    with pytest.raises(filament.FilamentError):
        filament.record_usage(spool_id, 0, today=TODAY, now=NOW)
    with pytest.raises(filament.FilamentError):
        filament.record_usage(spool_id, "abc", today=TODAY, now=NOW)
    with pytest.raises(filament.FilamentError):
        filament.record_usage(spool_id, 10, date="2099-01-01", today=TODAY, now=NOW)
    with pytest.raises(filament.FilamentError):
        filament.record_usage(spool_id, 10, date="2026/09/01", today=TODAY, now=NOW)
    with pytest.raises(filament.SpoolNotFound):
        filament.record_usage("nope", 10, today=TODAY, now=NOW)


def test_weighing_resets_the_base(store):
    spool_id = add()["spools"][0]["id"]
    filament.record_usage(spool_id, 100, date="2026-09-10", today=TODAY, now=NOW)
    document = filament.record_weighing(
        spool_id, 700, date="2026-09-20", today=TODAY, now=NOW + datetime.timedelta(hours=1)
    )
    view = filament.build_payload(document)["spools"][0]
    # 700 - 152 = 548。計量より前の使用量100gは引かない
    assert view["remaining_g"] == 548
    assert view["usages"][0]["counted"] is False


def test_weighing_requires_tare(store):
    spool_id = add(tare_g=None)["spools"][0]["id"]
    with pytest.raises(filament.FilamentError):
        filament.record_weighing(spool_id, 700, today=TODAY, now=NOW)


def test_weighing_can_be_removed(store):
    spool_id = add(current_gross_g=611)["spools"][0]["id"]
    view = filament.build_payload(filament.get_document())["spools"][0]
    document = filament.remove_weighing(spool_id, view["weighings"][0]["id"])
    view = filament.build_payload(document)["spools"][0]
    assert view["base"]["kind"] == "initial"
    assert view["remaining_g"] == 1000


def test_archiving_clears_active_and_blocks_reactivation(store):
    first = add()
    spool_id = first["spools"][0]["id"]
    document = filament.update_spool(spool_id, {"archived": True}, today=TODAY)
    assert document["active_id"] is None
    with pytest.raises(filament.FilamentError):
        filament.set_active(spool_id)


def test_set_active_switches_and_clears(store):
    add()
    second = add(name="ブラック")
    other = second["spools"][1]["id"]
    assert filament.set_active(other)["active_id"] == other
    assert filament.set_active(None)["active_id"] is None
    with pytest.raises(filament.SpoolNotFound):
        filament.set_active("nope")


def test_update_only_touches_sent_fields(store):
    spool_id = add(color="#ffffff")["spools"][0]["id"]
    document = filament.update_spool(spool_id, {"name": "ホワイト"}, today=TODAY)
    item = document["spools"][0]
    assert item["name"] == "ホワイト"
    assert item["color"] == "#FFFFFF"
    assert item["tare_g"] == 152
    document = filament.update_spool(spool_id, {"tare_g": None}, today=TODAY)
    assert document["spools"][0]["tare_g"] is None


def test_delete_spool_clears_active(store):
    spool_id = add()["spools"][0]["id"]
    document = filament.delete_spool(spool_id)
    assert document == {"active_id": None, "spools": []}


def test_usage_overflow_drops_only_records_that_do_not_matter(store, monkeypatch):
    monkeypatch.setattr(filament, "MAX_USAGES", 3)
    spool_id = add(current_gross_g=1000)["spools"][0]["id"]
    for day in ("2026-09-01", "2026-09-02", "2026-09-03"):
        filament.record_usage(spool_id, 5, date=day, today=TODAY, now=NOW)
    # 3件とも計量（9/21・13:30）より前なので数えない。4件目を足すと古いものから落ちる
    document = filament.record_usage(
        spool_id, 5, date="2026-09-21", today=TODAY, now=NOW + datetime.timedelta(hours=1)
    )
    dates = [item["date"] for item in document["spools"][0]["usages"]]
    assert dates == ["2026-09-02", "2026-09-03", "2026-09-21"]


def test_usage_overflow_refuses_when_every_record_counts(store, monkeypatch):
    monkeypatch.setattr(filament, "MAX_USAGES", 2)
    spool_id = add()["spools"][0]["id"]
    filament.record_usage(spool_id, 5, date="2026-09-01", today=TODAY, now=NOW)
    filament.record_usage(spool_id, 5, date="2026-09-02", today=TODAY, now=NOW)
    with pytest.raises(filament.FilamentError):
        filament.record_usage(spool_id, 5, date="2026-09-03", today=TODAY, now=NOW)


def test_payload_puts_archived_spools_last(store):
    first = add(name="A")
    second = add(name="B")
    # 先に足した A を使い切りにしても、末尾へ寄るのは使い切りのほう
    filament.update_spool(first["spools"][0]["id"], {"archived": True}, today=TODAY)
    del second
    views = filament.build_payload(filament.get_document())["spools"]
    assert [item["name"] for item in views] == ["B", "A"]
    assert views[-1]["archived"] is True


def test_saved_document_survives_reload(store):
    """別の操作を挟んでも、保存済みの使用中・計量・使用量が残る。"""
    spool_id = add(current_gross_g=611)["spools"][0]["id"]
    filament.record_usage(spool_id, 30, date="2026-09-21", today=TODAY, now=NOW + datetime.timedelta(hours=1))
    filament.update_spool(spool_id, {"name": "ホワイト"}, today=TODAY)
    payload = filament.build_payload(filament.get_document())
    assert payload["active_id"] == spool_id
    assert payload["spools"][0]["remaining_g"] == 429


# --- API ----------------------------------------------------------------------


def test_api_requires_login(client):
    assert client.get("/api/filament").status_code in (401, 403)
    assert client.post("/api/filament/spools", json={"name": "A"}).status_code in (401, 403)


@pytest.fixture
def ticking_clock(monkeypatch):
    """呼ぶたびに1分進む時計。登録時刻の前後でしか並びが決まらないため、同じ秒に重ならないようにする。"""
    ticks = iter(range(1, 1000))
    monkeypatch.setattr(
        filament, "get_now_jst", lambda: NOW + datetime.timedelta(minutes=next(ticks))
    )


def test_api_full_flow(authed_client, ticking_clock):
    empty = authed_client.get("/api/filament").json()
    assert empty["configured"] is False
    assert empty["spools"] == []
    assert empty["today"] == filament.get_today_jst().isoformat()

    created = authed_client.post(
        "/api/filament/spools",
        json={"name": "ELEGOO PLA (ホワイト)", "tare_g": 152, "current_gross_g": 611, "color": "#F4F4F2"},
    )
    assert created.status_code == 200
    payload = created.json()
    spool_id = payload["spools"][0]["id"]
    assert payload["active_id"] == spool_id
    assert payload["spools"][0]["remaining_g"] == 459

    used = authed_client.post(
        f"/api/filament/spools/{spool_id}/usage", json={"grams": 42, "note": "benchy"}
    ).json()
    view = used["spools"][0]
    assert view["remaining_g"] == 417
    usage_id = view["usages"][0]["id"]

    weighed = authed_client.post(
        f"/api/filament/spools/{spool_id}/weigh", json={"gross_g": 560}
    ).json()
    assert weighed["spools"][0]["remaining_g"] == 408

    after_delete = authed_client.delete(f"/api/filament/spools/{spool_id}/usage/{usage_id}").json()
    assert after_delete["spools"][0]["usages"] == []

    archived = authed_client.put(
        f"/api/filament/spools/{spool_id}", json={"archived": True}
    ).json()
    assert archived["active_id"] is None
    assert archived["spools"][0]["archived"] is True

    removed = authed_client.delete(f"/api/filament/spools/{spool_id}").json()
    assert removed["spools"] == []


def test_api_active_selection(authed_client):
    first = authed_client.post("/api/filament/spools", json={"name": "A"}).json()
    second = authed_client.post("/api/filament/spools", json={"name": "B"}).json()
    other = second["spools"][1]["id"]
    switched = authed_client.put("/api/filament/active", json={"spool_id": other})
    assert switched.json()["active_id"] == other
    assert authed_client.put("/api/filament/active", json={"spool_id": None}).json()["active_id"] is None
    assert first["active_id"] is not None


def test_api_reports_errors_with_the_reason(authed_client):
    spool_id = authed_client.post("/api/filament/spools", json={"name": "A"}).json()["spools"][0]["id"]

    no_tare = authed_client.post(f"/api/filament/spools/{spool_id}/weigh", json={"gross_g": 500})
    assert no_tare.status_code == 400
    assert "空スプール" in no_tare.json()["detail"]

    future = authed_client.post(
        f"/api/filament/spools/{spool_id}/usage", json={"grams": 10, "date": "2099-01-01"}
    )
    assert future.status_code == 400

    missing = authed_client.post("/api/filament/spools/nope/usage", json={"grams": 10})
    assert missing.status_code == 404

    assert authed_client.post("/api/filament/spools", json={"name": "  "}).status_code == 400
    assert authed_client.delete(f"/api/filament/spools/{spool_id}/usage/nope").status_code == 404


def test_api_update_can_clear_tare_with_null(authed_client):
    payload = authed_client.post("/api/filament/spools", json={"name": "A", "tare_g": 200}).json()
    spool_id = payload["spools"][0]["id"]
    cleared = authed_client.put(f"/api/filament/spools/{spool_id}", json={"tare_g": None}).json()
    assert cleared["spools"][0]["tare_g"] is None
    untouched = authed_client.put(f"/api/filament/spools/{spool_id}", json={"name": "B"}).json()
    assert untouched["spools"][0]["tare_g"] is None
