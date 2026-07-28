import logging
import os
from typing import Optional

import requests

logger = logging.getLogger(__name__)

SENSOR_WEBHOOK_URL = os.getenv("SENSOR_WEBHOOK_URL", "").strip()


def _post(webhook_url: str, payload: dict) -> None:
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

    _post(SENSOR_WEBHOOK_URL, {
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

    _post(SENSOR_WEBHOOK_URL, {
        "title": "✅ センサーデータが復旧しました",
        "color": "#57f287",
        "fields": fields,
    })
