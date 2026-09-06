import datetime

from backend import light_history
from backend.light_history import Segment


def dt(day: int, hour: int, minute: int = 0) -> datetime.datetime:
    return datetime.datetime(2026, 9, day, hour, minute)


def illuminance_records(values, day=6, step_minutes=10, start_hour=0):
    """`(照度, ...)` を等間隔の記録に並べる。"""
    base = dt(day, start_hour)
    return [
        {"datetime": base + datetime.timedelta(minutes=index * step_minutes), "illuminance": value}
        for index, value in enumerate(values)
    ]


# ------------------------------------------------- 照度からの復元


def test_照度がしきい値を上回った区間を点灯として切り出す():
    records = illuminance_records([5, 5, 300, 300, 300, 5, 5])
    segments = light_history.segments_from_illuminance(records, 80, dt(6, 0), dt(6, 2))

    assert len(segments) == 1
    assert segments[0].start == dt(6, 0, 20)
    assert segments[0].end == dt(6, 0, 50)


def test_しきい値ちょうどは点灯に含める():
    records = illuminance_records([5, 80, 80, 5])
    segments = light_history.segments_from_illuminance(records, 80, dt(6, 0), dt(6, 2))

    assert len(segments) == 1
    assert segments[0].minutes == 20


def test_しきい値が0以下なら判定しない():
    records = illuminance_records([300, 300, 300])
    assert light_history.segments_from_illuminance(records, 0, dt(6, 0), dt(6, 2)) == []


def test_照度が届いていない記録は読み飛ばして区間を切らない():
    # 途中で照度だけ欠けても、点灯が2つに割れない
    records = illuminance_records([5, 300, None, 300, 5])
    segments = light_history.segments_from_illuminance(records, 80, dt(6, 0), dt(6, 2))

    assert len(segments) == 1
    assert segments[0].start == dt(6, 0, 10)
    assert segments[0].end == dt(6, 0, 40)


def test_1点だけ落ち込んでも区間を割らない():
    # 300, 300, 5, 300, 300 の「5」は10分ぶんしかないのでつなぐ
    records = illuminance_records([5, 300, 300, 5, 300, 300, 5])
    segments = light_history.segments_from_illuminance(records, 80, dt(6, 0), dt(6, 2))

    assert len(segments) == 1
    assert segments[0].start == dt(6, 0, 10)
    assert segments[0].end == dt(6, 1, 0)


def test_1点だけ跳ねた短い区間は落とす():
    records = illuminance_records([5, 5, 300, 5, 5, 5])
    assert light_history.segments_from_illuminance(records, 80, dt(6, 0), dt(6, 2)) == []


def test_記録が長く空いた区間は繋がない():
    records = [
        {"datetime": dt(6, 0, 0), "illuminance": 300},
        {"datetime": dt(6, 0, 10), "illuminance": 300},
        {"datetime": dt(6, 0, 20), "illuminance": 300},
        {"datetime": dt(6, 0, 30), "illuminance": 300},
        # ここで6時間空く（バックエンドが止まっていた等）
        {"datetime": dt(6, 6, 30), "illuminance": 300},
        {"datetime": dt(6, 6, 40), "illuminance": 300},
        {"datetime": dt(6, 6, 50), "illuminance": 300},
        {"datetime": dt(6, 7, 0), "illuminance": 5},
    ]
    segments = light_history.segments_from_illuminance(records, 80, dt(6, 0), dt(6, 12))

    assert len(segments) == 2
    assert segments[0].end == dt(6, 0, 30)
    assert segments[1].start == dt(6, 6, 30)


def test_最後まで点いたままなら継続中として返す():
    records = illuminance_records([5, 300, 300])
    segments = light_history.segments_from_illuminance(records, 80, dt(6, 0), dt(6, 1))

    assert len(segments) == 1
    assert segments[0].open_end is True


def test_窓の手前から続く区間は開始が窓の先頭になり点けた扱いにしない():
    # 窓の手前（LOOKBACK ぶん）から点いている
    records = [
        {"datetime": dt(6, 0, 0) - datetime.timedelta(minutes=30), "illuminance": 300},
        {"datetime": dt(6, 0, 0) - datetime.timedelta(minutes=20), "illuminance": 300},
        {"datetime": dt(6, 0, 10), "illuminance": 300},
        {"datetime": dt(6, 0, 20), "illuminance": 5},
    ]
    segments = light_history.segments_from_illuminance(records, 80, dt(6, 0), dt(6, 1))

    assert len(segments) == 1
    assert segments[0].start == dt(6, 0)
    assert segments[0].open_start is True
    assert light_history.summarize(segments)["on_count"] == 0


# ------------------------------------------------- 記録済みイベントからの復元


def test_点灯と消灯の記録から区間を組み立てる():
    events = [(dt(6, 6, 50), "on"), (dt(6, 8, 10), "off"), (dt(6, 18, 35), "on")]
    segments = light_history.segments_from_events(events, dt(6, 0), dt(6, 23))

    assert len(segments) == 2
    assert (segments[0].start, segments[0].end) == (dt(6, 6, 50), dt(6, 8, 10))
    assert segments[1].start == dt(6, 18, 35)
    assert segments[1].open_end is True


def test_窓の手前で点灯していれば先頭から点いている扱いにする():
    events = [(dt(6, 1, 20), "off")]
    segments = light_history.segments_from_events(events, dt(6, 0), dt(6, 23), initial_status="on")

    assert len(segments) == 1
    assert segments[0].start == dt(6, 0)
    assert segments[0].open_start is True


def test_記録済みの短い点灯は落とさない():
    # 照度と違い1件1件が操作の結果なので、5分の点灯も本物として残す
    events = [(dt(6, 6, 50), "on"), (dt(6, 6, 55), "off")]
    segments = light_history.segments_from_events(events, dt(6, 0), dt(6, 23))

    assert len(segments) == 1
    assert segments[0].minutes == 5


def test_日をまたぐ区間は窓で切られ両端に印が付く():
    events = [(dt(5, 18, 0), "on"), (dt(6, 1, 0), "off")]
    segments = light_history.segments_from_events(
        [e for e in events if dt(6, 0) <= e[0]], dt(6, 0), dt(7, 0), initial_status="on"
    )

    assert len(segments) == 1
    assert segments[0].start == dt(6, 0)
    assert segments[0].end == dt(6, 1)
    assert segments[0].open_start is True
    assert segments[0].open_end is False


# ------------------------------------------------- 一覧・集計


def test_一覧は新しい順で消灯にも続いた長さが付く():
    segments = [
        Segment(dt(6, 6, 50), dt(6, 8, 10)),
        Segment(dt(6, 18, 35), dt(6, 23, 0), open_end=True),
    ]
    rows = light_history.build_events(segments, dt(6, 0), dt(6, 23), daylight_flags=False)

    assert [row["datetime"] for row in rows] == [
        dt(6, 18, 35).isoformat(),
        dt(6, 8, 10).isoformat(),
        dt(6, 6, 50).isoformat(),
    ]
    off_row = rows[1]
    assert off_row["status"] == "off"
    assert off_row["duration_minutes"] == 625  # 8:10 -> 18:35


def test_窓の手前から続く区間は点灯の行を作らない():
    segments = [Segment(dt(6, 0), dt(6, 1, 20), open_start=True)]
    rows = light_history.build_events(segments, dt(6, 0), dt(6, 23), daylight_flags=False)

    assert [row["status"] for row in rows] == ["off"]


def test_日中に収まる区間だけ日射の印が付く():
    segments = [
        Segment(dt(6, 11, 30), dt(6, 13, 40)),  # 日中に収まる
        Segment(dt(6, 17, 20), dt(6, 23, 0), open_end=True),  # 夕方から夜まで
    ]
    flags = [
        light_history.segment_payload(segment, True)["daylight"] for segment in segments
    ]
    assert flags == [True, False]


def test_日射の印は照度から判定したときだけ付ける():
    segment = Segment(dt(6, 11, 30), dt(6, 13, 40))
    assert light_history.segment_payload(segment, False)["daylight"] is False


def test_集計は窓の手前から続く区間を回数に数えず時間には含める():
    segments = [
        Segment(dt(6, 0), dt(6, 1), open_start=True),
        Segment(dt(6, 6, 50), dt(6, 8, 10)),
    ]
    assert light_history.summarize(segments) == {"on_count": 1, "on_minutes": 140}


# ------------------------------------------------- ポーリングでの変化の検出


def test_初めて読んだ機器は変化として1件記録する():
    changes = light_history.detect_changes({"d-a": "on"}, {}, dt(6, 12))
    assert changes == [("d-a", dt(6, 12), "on")]


def test_変わっていなければ何も記録しない():
    assert light_history.detect_changes({"d-a": "on"}, {"d-a": "on"}, dt(6, 12)) == []


def test_変わった機器だけ記録する():
    changes = light_history.detect_changes(
        {"d-a": "off", "d-b": "on"}, {"d-a": "on", "d-b": "on"}, dt(6, 12)
    )
    assert changes == [("d-a", dt(6, 12), "off")]


# ------------------------------------------------- 記録の読み出し（#371）


def test_窓の手前は直前の1件だけ読む(monkeypatch):
    """`light_events` を下限なしで全件引かない。

    状態が変わったときだけ1行足す追記専用のテーブルなので、窓の先頭ですでに点いていたかを
    知るには手前の記録が要る。ただし要るのは**直前の1件だけ**で、それより古い行は結果に
    影響しない（運用が長くなるほど読む行が増え続けるのを防ぐ）。
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from backend import database, main

    engine = create_engine("sqlite://")
    database.LightEventRecord.__table__.create(engine)
    db = sessionmaker(bind=engine)()

    rows = [
        ("k", dt(1, 7), "on"),  # 窓のずっと手前。読まない
        ("k", dt(1, 9), "off"),
        ("k", dt(2, 22), "on"),  # 窓の直前。ここだけ読む
        ("k", dt(3, 7), "off"),  # 窓の中
        ("k", dt(4, 8), "on"),  # 窓より先
        ("other", dt(3, 8), "on"),  # 別の機器
    ]
    for appliance_key, recorded_at, power in rows:
        db.add(
            database.LightEventRecord(
                recorded_at=recorded_at, appliance_key=appliance_key, power=power
            )
        )
    db.commit()

    monkeypatch.setattr(database, "DB_MOCK", False)
    got = main._light_history_events("k", dt(3, 0), dt(3, 23), db)

    assert got == [(dt(2, 22), "on"), (dt(3, 7), "off")]


def test_窓の手前に記録が無ければ窓の中だけ返す(monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from backend import database, main

    engine = create_engine("sqlite://")
    database.LightEventRecord.__table__.create(engine)
    db = sessionmaker(bind=engine)()
    db.add(database.LightEventRecord(recorded_at=dt(3, 7), appliance_key="k", power="on"))
    db.commit()

    monkeypatch.setattr(database, "DB_MOCK", False)
    assert main._light_history_events("k", dt(3, 0), dt(3, 23), db) == [(dt(3, 7), "on")]
