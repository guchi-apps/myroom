"""ゴミの日通知・部屋の異常通知が共通で使う通知イベントの形と送信処理（#293）。

種別ごとの重複防止（同じ収集日を二重に通知しない・同じ異常が続く間は再通知しない）は
呼び出し側（`garbage_notify.py` / `sensor_monitor.py`）が自分の状態ファイルで判断する
（既存の `garbage_notify_state.json` / `sensor_alert_state.json` と同じやり方）。ここでは
「送るとなったイベントをPush通知として配信する」処理だけを共通化する。
"""

from __future__ import annotations

import dataclasses
import logging
from typing import Optional

from . import push_notify

logger = logging.getLogger(__name__)


@dataclasses.dataclass(frozen=True)
class NotificationEvent:
    #: "garbage" / "room_anomaly_temperature_high" のような種別
    kind: str
    title: str
    body: str
    #: "normal" | "high"。OS通知の見え方はブラウザ依存のため、いまは記録のみ
    priority: str
    #: タップしたときに開く画面
    url: str
    #: JSTのISO8601文字列
    occurred_at: str
    #: 同じ内容の通知をOS側で1つにまとめるためのキー（Service Workerの`tag`に渡す）
    dedupe_key: str


def dispatch_push_event(event: NotificationEvent) -> int:
    """PWA Pushとして配信する。失敗しても例外は投げない（呼び出し元の処理を止めないため）。"""
    try:
        result = push_notify.broadcast(
            {
                "title": event.title,
                "body": event.body,
                "tag": event.dedupe_key,
                "url": event.url,
            }
        )
        logger.info(
            "Push event dispatched: kind=%s sent=%d/%d dedupe_key=%s",
            event.kind,
            result["sent"],
            result["total"],
            event.dedupe_key,
        )
        return result["sent"]
    except Exception:  # 通知の失敗でゴミ・センサーの定期処理を止めない
        logger.exception("Failed to dispatch push event (kind=%s)", event.kind)
        return 0
