import logging
import os
from typing import List, Optional

import requests

logger = logging.getLogger(__name__)

SENSOR_WEBHOOK_URL = os.getenv("SENSOR_WEBHOOK_URL", "").strip()
# ゴミの日は既存のセンサー通知と同じ Signaly の宛先を使う。
# 宛先を分けたい場合だけ GARBAGE_WEBHOOK_URL を設定する。
GARBAGE_WEBHOOK_URL = os.getenv("GARBAGE_WEBHOOK_URL", "").strip() or SENSOR_WEBHOOK_URL


def post_notification(webhook_url: str, payload: dict) -> None:
    """Signaly の Webhook へ1件送る。失敗しても呼び出し元の処理は止めない。"""
    try:
        response = requests.post(webhook_url, json=payload, timeout=5)
        response.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("Failed to send Signaly notification: %s", exc)


def send_sensor_stale_notification(
    *,
    device_name: str,
    device_id: int,
    last_seen: Optional[str],
    age_minutes: Optional[float],
    threshold_minutes: int,
) -> None:
    if not SENSOR_WEBHOOK_URL:
        logger.debug("SENSOR_WEBHOOK_URL not set; skipping Signaly notification")
        return

    if last_seen:
        last_seen_value = f"{last_seen}（約 {int(age_minutes or 0)} 分前）"
    else:
        last_seen_value = "なし（一度も届いていません）"

    post_notification(SENSOR_WEBHOOK_URL, {
        "title": "⚠️ センサーデータが届いていません",
        "color": "#ed4245",
        "fields": [
            {"name": "センサー", "value": f"{device_name}（device={device_id}）", "inline": False},
            {"name": "最終受信", "value": last_seen_value, "inline": True},
            {"name": "閾値", "value": f"{threshold_minutes} 分", "inline": True},
        ],
    })


def send_sensor_recovered_notification(
    *,
    device_name: str,
    device_id: int,
    last_seen: Optional[str],
) -> None:
    if not SENSOR_WEBHOOK_URL:
        logger.debug("SENSOR_WEBHOOK_URL not set; skipping Signaly notification")
        return

    fields = [{"name": "センサー", "value": f"{device_name}（device={device_id}）", "inline": False}]
    if last_seen:
        fields.append({"name": "最終受信", "value": last_seen, "inline": True})

    post_notification(SENSOR_WEBHOOK_URL, {
        "title": "✅ センサーデータが復旧しました",
        "color": "#57f287",
        "fields": fields,
    })


def send_garbage_notification(
    *,
    date_label: str,
    category_names: List[str],
    notes: Optional[List[str]] = None,
) -> None:
    if not GARBAGE_WEBHOOK_URL:
        logger.debug("GARBAGE_WEBHOOK_URL / SENSOR_WEBHOOK_URL not set; skipping Signaly notification")
        return

    fields = [
        {"name": "収集日", "value": date_label, "inline": True},
        {"name": "品目", "value": "・".join(category_names), "inline": True},
    ]
    if notes:
        fields.append({"name": "備考", "value": "\n".join(notes), "inline": False})

    post_notification(GARBAGE_WEBHOOK_URL, {
        "title": "🗑️ 明日はゴミの日です",
        "color": "#3498db",
        "fields": fields,
    })
