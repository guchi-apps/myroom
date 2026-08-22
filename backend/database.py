import os
from sqlalchemy import create_engine, Column, Integer, Float, DateTime, Date, String, Text
from sqlalchemy.orm import declarative_base, sessionmaker
import datetime
import random
from dotenv import load_dotenv

load_dotenv()

# Environment variables
DB_USER = os.getenv("DB_USER", "user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "myroom")
DB_MOCK = os.getenv("DB_MOCK", "true").lower() == "true"

Base = declarative_base()

SENSOR_READINGS_TABLE = "sensor_readings"
LEGACY_SENSOR_READINGS_TABLE = "dht"


class SensorRecord(Base):
    __tablename__ = SENSOR_READINGS_TABLE
    
    # Existing schema has composite PK or just datetime/pressure as PK. 
    # Setting datetime as PK for SQLAlchemy mapping.
    datetime = Column(DateTime, primary_key=True)
    device_id = Column(Integer, primary_key=True, default=1)
    
    temperature = Column(Float, nullable=True)
    temperature_dht11 = Column(Float, nullable=True)
    humidity = Column(Integer, nullable=True)
    pressure = Column(Integer, nullable=True)
    co2 = Column(Integer, nullable=True)
    illuminance = Column(Float, nullable=True)


class AirconRecord(Base):
    __tablename__ = "aircon"

    datetime = Column(DateTime, primary_key=True)
    ac_id = Column(Integer, primary_key=True, default=1)

    name = Column(String(100), nullable=True)
    room_temperature = Column(Float, nullable=True)
    target_temperature = Column(Float, nullable=True)
    humidity = Column(Integer, nullable=True)
    mode = Column(String(20), nullable=True)
    power = Column(String(10), nullable=True)
    fan_speed = Column(String(10), nullable=True)
    fan_swing = Column(String(20), nullable=True)
    online = Column(Integer, nullable=True)
    model = Column(String(100), nullable=True)


class DailyEnergyRecord(Base):
    """日別の電力使用量。取得元（source）を問わず1つのテーブルにためる。

    `source` はエアコンなら `aircon`、スマートプラグなら `tapo:<機器名>` のように
    「種別:識別子」の形にする。機器が増えても列を足さずに済むようにするため。
    `cost_yen` は取得元が金額まで返してきたときだけ入り、通常は NULL。
    その場合は単価設定（`ui_settings` の `energy_unit_price`）から計算する。
    """

    __tablename__ = "daily_energy"

    date = Column(Date, primary_key=True)
    source = Column(String(64), primary_key=True)

    kwh = Column(Float, nullable=True)
    cost_yen = Column(Float, nullable=True)
    #: その日に最後に観測した瞬時値（W）。日別の集計値ではなく「いま動いているか」の
    #: 確認用で、返すのはスマートプラグだけ。エアコン（AirCloud Home）は NULL のまま。
    power_w = Column(Float, nullable=True)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
    )


class CleanerRunRecord(Base):
    """お掃除ロボットの稼働履歴。**状態が変わった瞬間だけ1行**入る。

    `datetime` はその状態になった時刻、`updated_at` は同じ状態を最後に確認した時刻。
    収集は数分おきに送ってくるが、状態が変わっていなければ行は増やさず `updated_at`
    （と `battery`）だけを進める。そのため `battery` は「その状態で最後に観測した残量」で、
    充電中の行は充電が進むにつれて上がっていく。
    """

    __tablename__ = "cleaner_runs"

    datetime = Column(DateTime, primary_key=True)

    #: `cleaning` / `charging` / `docked` など（`backend/cleaner.py` の EVENT_LABELS）
    event = Column(String(20), nullable=False)
    battery = Column(Integer, nullable=True)
    updated_at = Column(DateTime, nullable=True)


class DisplayEntity(Base):
    __tablename__ = "display_entities"

    entity_type = Column(String(20), primary_key=True)
    entity_id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    inherits_from = Column(Integer, nullable=True)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
    )


class AppSetting(Base):
    __tablename__ = "app_settings"

    setting_key = Column(String(64), primary_key=True)
    setting_value = Column(Text, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
    )

# SensorDaily model removed as we aggregate from sensor_readings table directly

# Mock Data Generator
def generate_mock_history_for_range(
    start_time: datetime.datetime,
    end_time: datetime.datetime,
    device_id: int = 1,
) -> list:
    """指定期間のモック履歴のみ生成（全件フィルタより高速）。"""
    data = []
    start_naive = start_time.replace(tzinfo=None) if start_time.tzinfo else start_time
    end_naive = end_time.replace(tzinfo=None) if end_time.tzinfo else end_time
    t = end_naive
    interval = datetime.timedelta(minutes=10)
    temp_offset = 0 if device_id == 1 else -2.5
    humid_offset = 0 if device_id == 1 else 5
    co2_offset = 0 if device_id == 1 else 80

    while t >= start_naive:
        temp = 20 + temp_offset + 5 * (1 + math.sin(t.hour / 24 * 2 * math.pi)) + random.uniform(-1, 1)
        humid = 50 + humid_offset + 10 * (1 + math.cos(t.hour / 24 * 2 * math.pi)) + random.uniform(-2, 2)
        co2 = 450 + co2_offset + 150 * (1 + math.sin(t.hour / 24 * 2 * math.pi)) + random.uniform(-30, 30)
        illuminance = max(
            0,
            200
            + 800 * max(0, math.sin((t.hour - 6) / 12 * math.pi))
            + random.uniform(-50, 50),
        )
        entry = {
            "datetime": t,
            "temperature": round(temp, 1),
            "humidity": round(humid, 1),
            "co2": round(co2),
            "illuminance": round(illuminance, 1),
        }
        if device_id == 1:
            entry["pressure"] = round(1013 + random.uniform(-5, 5), 1)
        data.append(entry)
        t -= interval

    data.reverse()
    return data


def generate_mock_history():
    """直近2年分（後方互換）。"""
    end = datetime.datetime.now()
    start = end - datetime.timedelta(days=730)
    return generate_mock_history_for_range(start, end)

def generate_mock_aircon_latest() -> dict:
    return {
        "ac_id": 1,
        "datetime": datetime.datetime.now(),
        "name": "リビングエアコン",
        "source_name": "リビングエアコン",
        "room_temperature": round(24.5 + random.uniform(-0.3, 0.3), 1),
        "target_temperature": 26.0,
        "humidity": 50,
        "mode": "COOLING",
        "power": "ON",
        "fan_speed": "AUTO",
        "fan_swing": "AUTO",
        "online": True,
        "model": "RAS-KW4025D",
    }


def generate_mock_aircon_history_for_range(
    start_time: datetime.datetime,
    end_time: datetime.datetime,
    ac_id: int = 1,
) -> list:
    """指定期間のエアコンモック履歴を生成。"""
    data = []
    start_naive = start_time.replace(tzinfo=None) if start_time.tzinfo else start_time
    end_naive = end_time.replace(tzinfo=None) if end_time.tzinfo else end_time
    t = end_naive
    interval = datetime.timedelta(minutes=10)
    fixed_target = 26.0

    while t >= start_naive:
        if t.hour in (8, 9, 18, 19):
            fixed_target = 24.0 if t.hour < 12 else 27.0
        # 昼過ぎは自動運転（設定温度は室温からのシフト量 +1.0）にして、
        # 固定設定温度と自動運転が混ざった状態をモックでも再現する
        target = 1.0 if 13 <= t.hour < 17 else fixed_target
        power = "OFF" if t.hour < 6 or t.hour >= 23 else "ON"
        room = (
            22
            + 5 * (1 + math.sin(t.hour / 24 * 2 * math.pi))
            + random.uniform(-0.8, 0.8)
        )
        data.append(
            {
                "datetime": t,
                "ac_id": ac_id,
                "room_temperature": round(room, 1),
                "target_temperature": target if power == "ON" else None,
                "power": power,
            }
        )
        t -= interval

    data.reverse()
    return data


def generate_mock_daily():
    data = []
    today = datetime.date.today()
    for i in range(30):
        d = today - datetime.timedelta(days=i)
        data.append({
            "date": d,
            "temp_max": round(25 + random.uniform(0, 5), 1),
            "temp_min": round(15 + random.uniform(0, 5), 1),
            "humid_max": round(60 + random.uniform(0, 10), 1),
            "humid_min": round(40 + random.uniform(0, 10), 1)
        })
    data.sort(key=lambda x: x["date"])
    return data


def generate_mock_aircon_daily(ac_id: int = 1) -> list:
    data = []
    today = datetime.date.today()
    for i in range(30):
        d = today - datetime.timedelta(days=i)
        base = 24.5 + random.uniform(-1.5, 1.5)
        data.append({
            "date": d,
            "temp_max": round(base + random.uniform(0.5, 2.5), 1),
            "temp_min": round(base - random.uniform(0.5, 2.5), 1),
        })
    data.sort(key=lambda x: x["date"])
    return data

def generate_mock_daily_energy(source: str = "aircon", days: int = 75) -> list:
    """モック用の日別使用量。当日は「まだ途中」に見えるよう少なめにする。"""
    data = []
    today = datetime.date.today()
    for i in range(days):
        d = today - datetime.timedelta(days=i)
        # 夏冬に増えて春秋に減る、ゆるい季節変動
        seasonal = 1.0 + 0.8 * abs(math.sin((d.timetuple().tm_yday / 365) * 2 * math.pi))
        kwh = max(0.0, seasonal * (1.6 + random.uniform(-0.9, 1.4)))
        if i == 0:
            kwh *= 0.3
        data.append({"date": d, "source": source, "kwh": round(kwh, 2), "cost_yen": None})
    data.sort(key=lambda x: x["date"])
    return data


#: モックの取得元。(source, 使用量の倍率, いまの W)。
#: エアコンは AirCloud Home から瞬時値を取れないので W は None。
MOCK_ENERGY_SOURCES = (
    ("aircon", 1.0, None),
    ("tapo:冷蔵庫", 0.46, 38.2),
    ("tapo:テレビ", 0.17, 72.0),
    ("tapo:デスク", 0.13, 0.0),
)


def generate_mock_energy_rows(days: int = 75) -> list:
    """モック用の、取得元を横断した日別使用量。

    消費電力カードはエアコンとスマートプラグを1枚にまとめるため、
    モックでも複数の取得元が混ざった状態を作る。
    """
    today = datetime.date.today()
    rows = []
    for source, factor, power_w in MOCK_ENERGY_SOURCES:
        for row in generate_mock_daily_energy(source, days):
            rows.append(
                {
                    **row,
                    "kwh": round(row["kwh"] * factor, 2),
                    # 瞬時値は「いま」の値なので、当日ぶんにだけ入る
                    "power_w": power_w if row["date"] == today else None,
                }
            )
    rows.sort(key=lambda item: (item["date"], item["source"]))
    return rows


#: モックの稼働開始時刻。午前と午後を交互にして、カードの「最終起動」が
#: いつも同じ時刻に見えないようにする
MOCK_CLEANER_START_HOURS = (9, 14)

#: モックで作る履歴の長さ（日）。当月の回数と平均を出せればよい
MOCK_CLEANER_DAYS = 45


def generate_mock_cleaner_rows(now=None) -> list:
    """モック用のお掃除ロボットの稼働履歴。

    2〜3日おきに1回動き、終わると充電して待機に戻る、という実機に近い並びを作る。
    本物と同じく**状態が変わった行だけ**を返す（`backend/cleaner.py` の前提）。
    """
    if now is None:
        now = datetime.datetime.now()

    # 直近の稼働は「3時間前」に固定する。実行した時刻によってカードが
    # 「何日も動いていない」ように見えるのを避けるため。
    starts = [(now - datetime.timedelta(hours=3)).replace(second=0, microsecond=0)]
    while (now - starts[-1]).days < MOCK_CLEANER_DAYS:
        index = len(starts)
        starts.append(
            (starts[-1] - datetime.timedelta(days=2 if index % 2 else 3)).replace(
                hour=MOCK_CLEANER_START_HOURS[index % 2],
                minute=(5 + index * 7) % 55,
            )
        )

    rows = []
    for index, start in enumerate(reversed(starts)):
        duration = 26 + (index * 5) % 20  # 26〜45分
        end = start + datetime.timedelta(minutes=duration)
        docked = end + datetime.timedelta(minutes=110)

        # battery は「その状態で最後に観測した残量」。掃除中は減り、充電中は増える
        rows.append(
            {
                "datetime": start,
                "event": "cleaning",
                "battery": max(20, 92 - duration),
                "updated_at": end,
            }
        )
        rows.append(
            {
                "datetime": end,
                "event": "charging",
                "battery": 99,
                "updated_at": docked,
            }
        )
        rows.append(
            {
                "datetime": docked,
                "event": "docked",
                "battery": 100,
                "updated_at": docked,
            }
        )

    if rows:
        # 最後の行だけは「いま」まで確認できていることにする（受信途絶の警告を出さない）
        rows[-1]["updated_at"] = now
    return rows


import math

# Database Connection
if not DB_MOCK:
    DATABASE_URL = f"mysql+mysqlconnector://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
else:
    engine = None
    SessionLocal = None

def get_db():
    if DB_MOCK:
        yield None
    else:
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()
