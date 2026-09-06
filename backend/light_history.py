"""照明が点いていた時間帯を復元する（#368）。

**アレクサの操作履歴そのものは取れない。** Alexa には第三者アプリがスマートホームの
操作履歴を読む公式APIが無く、IFTTT の Alexa 連携も2023年10月に廃止されている。
そこでこのモジュールは「操作の結果として残ったもの」から履歴を組み立てる。経路は2つで、
どちらもアレクサ・アプリ・壁のスイッチのどれで操作しても同じように記録に出る。

1. **Nature Remo の状態**（`LIGHT` として登録した機器）。クラウド側が `light.state.power`
   を持つので、5分ごとに読んで変わった時刻を `light_events` へ書き足す。
   `remote.py` が「状態を持たない」方針（#106）なのはボタンのカードの話で、そちらは
   変えない——ここが読むのは履歴のためだけ。
2. **照度センサー**。生の赤外線で操作する照明はクラウド側に状態が残らないので、
   `sensor_readings.illuminance` と `light_thresholds`（#258）から区間を組み立てる。

**どちらを使うかは場所ごとの設定（`light_sources`）が決める。** 判定そのものは純関数に
寄せてあり、DBにも Nature Remo にも触らない（テストが実データを要らない形になる）。

## 精度についての約束

- **時刻はポーリング間隔（5分）・センサー送信間隔（約10分）刻みの近似。** 区間の始まりは
  「その時刻には既に点いていた」ことしか意味しない。実際に点けたのは1つ前の記録との間
- **記録が空いた区間は繋がない**（`MAX_GAP_MINUTES`）。バックエンドが止まっていた6時間を
  「点いていた」と数えると、合計時間が実態から大きく外れる
- **照度からの判定は日中の日射でも成立してしまう。** 消せないので、日中に収まる区間へ印
  （`daylight`）を付けて画面から気づけるようにする
"""

from __future__ import annotations

import datetime
import logging
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

STATUS_ON = "on"
STATUS_OFF = "off"

#: センサーの送信間隔ぶん（約10分）。**この長さ以下の区間・すき間は「1点ぶんの揺れ」**
#: とみなし、区間なら落とし、すき間ならつなぐ。1点だけしきい値を跨いだときに点灯・消灯が
#: 2件増えるのを防ぐ。`<` ではなく `<=` で見るのは、1点ぶんの跳ね・落ち込みの長さが
#: ちょうど送信間隔と同じになるため。
#: **Nature Remo の状態には当てない**——あちらは記録そのものが操作の結果で、揺れない。
SMOOTHING_MINUTES = 10

#: 記録がこれ以上空いたら、そこで区間を切る（読めていない時間を「点いていた」にしない）
MAX_GAP_MINUTES = 60

#: 窓の手前をどれだけ余分に読むか。窓の先頭ですでに点いていたかを知るために要る
LOOKBACK_MINUTES = MAX_GAP_MINUTES

#: 日射で誤判定しやすい時間帯。照度から判定した区間にだけ印を付ける
DAYLIGHT_START_HOUR = 6
DAYLIGHT_END_HOUR = 18


@dataclass(frozen=True)
class Segment:
    """点いていた1区間。両端が窓の外へ続いているかを持つ。"""

    start: datetime.datetime
    end: datetime.datetime
    #: 窓の手前から続いている（＝この時刻に点けたわけではない）
    open_start: bool = False
    #: 窓の先へ続いている・まだ点いている（＝この時刻に消したわけではない）
    open_end: bool = False

    @property
    def minutes(self) -> float:
        return (self.end - self.start).total_seconds() / 60.0


def _minutes_between(a: datetime.datetime, b: datetime.datetime) -> float:
    return (b - a).total_seconds() / 60.0


def _is_daylight(segment: Segment) -> bool:
    """区間がまるごと日中（6:00〜18:00）に収まるか。

    **またいでいる区間には印を付けない。** 夕方に点けて夜まで続く区間は日射では説明が
    つかないので、印を付けると本物の点灯まで疑わしく見える。
    """
    if segment.start.date() != segment.end.date():
        return False
    return (
        segment.start.hour >= DAYLIGHT_START_HOUR
        and (segment.end.hour < DAYLIGHT_END_HOUR
             or (segment.end.hour == DAYLIGHT_END_HOUR and segment.end.minute == 0))
    )


def smooth_segments(segments: Sequence[Segment]) -> List[Segment]:
    """短い揺れをならす。**照度から作った区間にだけ当てる。**

    先に「近すぎる区間をつなぐ」を行い、そのあとで「短すぎる区間を落とす」。逆にすると、
    1点だけ落ち込んで2つに割れた長い区間が、片方だけ落とされて半分になる。
    """
    if not segments:
        return []

    merged: List[Segment] = [segments[0]]
    for segment in segments[1:]:
        previous = merged[-1]
        if _minutes_between(previous.end, segment.start) <= SMOOTHING_MINUTES:
            merged[-1] = Segment(
                start=previous.start,
                end=segment.end,
                open_start=previous.open_start,
                open_end=segment.open_end,
            )
            continue
        merged.append(segment)

    # 端が窓の外へ続いている区間は、見えている長さが短くても本物なので落とさない
    return [
        segment
        for segment in merged
        if segment.minutes > SMOOTHING_MINUTES or segment.open_start or segment.open_end
    ]


def _clip(
    segments: Iterable[Segment],
    window_start: datetime.datetime,
    window_end: datetime.datetime,
) -> List[Segment]:
    """窓の外へはみ出した区間を切り、切ったことを `open_*` で残す。"""
    clipped: List[Segment] = []
    for segment in segments:
        if segment.end <= window_start or segment.start >= window_end:
            continue
        start = max(segment.start, window_start)
        end = min(segment.end, window_end)
        clipped.append(
            Segment(
                start=start,
                end=end,
                open_start=segment.open_start or segment.start < window_start,
                open_end=segment.open_end or segment.end > window_end,
            )
        )
    return clipped


def segments_from_illuminance(
    records: Sequence[Dict[str, Any]],
    threshold: float,
    window_start: datetime.datetime,
    window_end: datetime.datetime,
) -> List[Segment]:
    """照度としきい値から点いていた区間を組み立てる。

    `records` は `{"datetime": ..., "illuminance": ...}` を時刻順に並べたもので、
    窓の手前 `LOOKBACK_MINUTES` ぶんを含んでいてよい（窓の先頭ですでに点いていたかを
    知るために要る）。照度が届いていない記録は「判定できない」として読み飛ばす——
    消灯として扱うと、センサーが照度を送らなかっただけで区間が切れる。
    """
    if threshold <= 0:
        return []

    segments: List[Segment] = []
    open_start: Optional[datetime.datetime] = None
    previous_at: Optional[datetime.datetime] = None

    for record in records:
        at = record.get("datetime")
        illuminance = record.get("illuminance")
        if not isinstance(at, datetime.datetime) or illuminance is None:
            continue

        # 記録が空いていたら、読めていない時間を跨いで繋がない
        if (
            open_start is not None
            and previous_at is not None
            and _minutes_between(previous_at, at) > MAX_GAP_MINUTES
        ):
            segments.append(Segment(start=open_start, end=previous_at))
            open_start = None

        is_on = float(illuminance) >= threshold
        if is_on and open_start is None:
            open_start = at
        elif not is_on and open_start is not None:
            segments.append(Segment(start=open_start, end=at))
            open_start = None
        previous_at = at

    if open_start is not None and previous_at is not None:
        # 最後まで点いたまま。窓の終わりまで続いているものとして扱う
        segments.append(Segment(start=open_start, end=max(previous_at, window_end), open_end=True))

    return _clip(smooth_segments(segments), window_start, window_end)


def segments_from_events(
    events: Sequence[Tuple[datetime.datetime, str]],
    window_start: datetime.datetime,
    window_end: datetime.datetime,
    initial_status: Optional[str] = None,
) -> List[Segment]:
    """記録済みの点灯・消灯から区間を組み立てる。

    `events` は `(時刻, "on"/"off")` を時刻順に並べたもの。`initial_status` は窓の手前で
    最後に記録された状態で、`"on"` なら窓の先頭からすでに点いていたことになる。

    **ここでは `smooth_segments()` を当てない。** 記録の1件1件が「状態が変わった」という
    事実なので、短い点灯も本物として残す。
    """
    segments: List[Segment] = []
    open_start: Optional[datetime.datetime] = None
    from_before = False

    if initial_status == STATUS_ON:
        open_start = window_start
        from_before = True

    for at, status in events:
        if status == STATUS_ON:
            if open_start is None:
                open_start = at
                from_before = False
        elif status == STATUS_OFF and open_start is not None:
            segments.append(Segment(start=open_start, end=at, open_start=from_before))
            open_start = None
            from_before = False

    if open_start is not None:
        segments.append(
            Segment(start=open_start, end=window_end, open_start=from_before, open_end=True)
        )

    return _clip(segments, window_start, window_end)


def build_events(
    segments: Sequence[Segment],
    window_start: datetime.datetime,
    window_end: datetime.datetime,
    daylight_flags: bool,
) -> List[Dict[str, Any]]:
    """画面の一覧に出す行。新しいものから並べる。

    1行は「その時刻に始まった状態」で、続いた長さを添える。消灯の行が出るのは区間と区間の
    あいだで、窓の先頭・末尾の消灯（いつ消したか分からない）は行にしない。
    """
    rows: List[Dict[str, Any]] = []
    for index, segment in enumerate(segments):
        if not segment.open_start:
            rows.append(
                {
                    "datetime": segment.start.isoformat(),
                    "status": STATUS_ON,
                    "duration_minutes": round(segment.minutes),
                    "continuing": segment.open_end,
                    "daylight": daylight_flags and _is_daylight(segment),
                }
            )
        if segment.open_end:
            continue
        next_start = (
            segments[index + 1].start if index + 1 < len(segments) else window_end
        )
        rows.append(
            {
                "datetime": segment.end.isoformat(),
                "status": STATUS_OFF,
                "duration_minutes": round(_minutes_between(segment.end, next_start)),
                "continuing": index + 1 >= len(segments),
                "daylight": False,
            }
        )

    rows.sort(key=lambda row: row["datetime"], reverse=True)
    return rows


def summarize(segments: Sequence[Segment]) -> Dict[str, Any]:
    """点けた回数と、点いていた合計時間。

    **窓の手前から続いている区間は「点けた回数」に数えない。** その操作は窓の外で
    行われているので、数えると期間を狭めるほど回数が増える。合計時間には含める。
    """
    return {
        "on_count": sum(1 for segment in segments if not segment.open_start),
        "on_minutes": round(sum(segment.minutes for segment in segments)),
    }


def segment_payload(segment: Segment, daylight_flags: bool) -> Dict[str, Any]:
    return {
        "start": segment.start.isoformat(),
        "end": segment.end.isoformat(),
        "open_start": segment.open_start,
        "open_end": segment.open_end,
        "daylight": daylight_flags and _is_daylight(segment),
    }


# ------------------------------------------------- Nature Remo の状態を書き足す


def detect_changes(
    states: Dict[str, str],
    last_known: Dict[str, str],
    now: datetime.datetime,
) -> List[Tuple[str, datetime.datetime, str]]:
    """読み取った状態と、最後に記録した状態を比べて書き足すぶんを返す。

    **初めて読んだ機器も1件書く。** 何も無いところから始めると、次に変わるまで
    「いつから点いているか」が分からず、区間の始まりを窓の先頭に置くしかなくなる。

    **変化していなければ何も書かない。** 5分おきのスナップショットを溜めると
    1機器あたり年10万行になり、`energy_readings` と違って得られるものが無い。
    """
    changes: List[Tuple[str, datetime.datetime, str]] = []
    for key, power in states.items():
        if last_known.get(key) == power:
            continue
        changes.append((key, now, power))
    return changes
