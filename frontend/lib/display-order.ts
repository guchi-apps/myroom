import { moveOrderItem, normalizeOrderKeys } from "@/lib/ordering";
import {
  AIRCON_CHART_DEVICE_ID,
  DASHBOARD_SENSOR_DEVICE_IDS,
  formatOutdoorApiLabel,
} from "@/lib/types";

export type DisplayOrderItem =
  | { type: "device"; deviceId: number }
  | { type: "outdoor"; locationId?: string | null }
  | { type: "aircon" };

export const DISPLAY_ORDER_CHANGED_EVENT = "myroom-display-order-changed";

/**
 * 地点を持たない屋外のキー（#308以前）。地点ごとのカードへ広げた#321のあとも、
 * 保存済みの並び・非表示の設定にはこのキーが残っている。読み込むときに基準地点の
 * キーへ読み替えるだけにして、移行スクリプトも一括の書き換えも行わない。
 */
export const LEGACY_OUTDOOR_ORDER_KEY = "outdoor";

/** 屋外の並び順のキー。地点ごとに1枚のカードを持つ（#321） */
export function outdoorOrderKey(locationId?: string | null): string {
  const trimmed = locationId?.trim();
  return trimmed ? `outdoor:${trimmed}` : LEGACY_OUTDOOR_ORDER_KEY;
}

/**
 * 屋外の地点の一覧と基準地点。並び順・非表示の設定を地点ごとに扱うために要る。
 * 地点がまだ読み込めていない場面（起動直後・オフライン）では空で渡し、
 * 従来どおり屋外1枚として扱う。
 */
export interface OutdoorOrderContext {
  locationIds: readonly string[];
  primaryId?: string | null;
}

export const EMPTY_OUTDOOR_ORDER_CONTEXT: OutdoorOrderContext = {
  locationIds: [],
  primaryId: null,
};

const STORAGE_KEY = "myroom_display_order";

function getOrderStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function orderItemKey(item: DisplayOrderItem): string {
  if (item.type === "device") return `device:${item.deviceId}`;
  if (item.type === "outdoor") return outdoorOrderKey(item.locationId);
  return item.type;
}

export function parseOrderItem(key: string): DisplayOrderItem | null {
  if (key === LEGACY_OUTDOOR_ORDER_KEY) return { type: "outdoor", locationId: null };
  if (key.startsWith("outdoor:")) {
    const locationId = key.slice("outdoor:".length);
    return locationId ? { type: "outdoor", locationId } : null;
  }
  if (key === "aircon") return { type: "aircon" };
  if (key.startsWith("device:")) {
    const deviceId = Number(key.slice("device:".length));
    return Number.isFinite(deviceId) ? { type: "device", deviceId } : null;
  }
  return null;
}

/** 地点を持たない屋外の項目を、基準地点の項目として読み替える（#321） */
export function resolveOutdoorOrderItem(
  item: DisplayOrderItem,
  outdoor: OutdoorOrderContext
): DisplayOrderItem {
  if (item.type !== "outdoor") return item;
  if (item.locationId) return item;
  if (!outdoor.primaryId) return item;
  return { type: "outdoor", locationId: outdoor.primaryId };
}

export function buildDefaultDisplayOrder(
  sensorDeviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS,
  outdoor: OutdoorOrderContext = EMPTY_OUTDOOR_ORDER_CONTEXT
): DisplayOrderItem[] {
  const outdoorItems: DisplayOrderItem[] = outdoor.locationIds.length
    ? outdoor.locationIds.map((locationId) => ({
        type: "outdoor" as const,
        locationId,
      }))
    : [{ type: "outdoor" as const, locationId: null }];

  return [
    ...sensorDeviceIds.map((deviceId) => ({ type: "device" as const, deviceId })),
    ...outdoorItems,
    { type: "aircon" as const },
  ];
}

export function normalizeDisplayOrder(
  saved: DisplayOrderItem[] | null,
  sensorDeviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS,
  outdoor: OutdoorOrderContext = EMPTY_OUTDOOR_ORDER_CONTEXT
): DisplayOrderItem[] {
  const defaults = buildDefaultDisplayOrder(sensorDeviceIds, outdoor);
  if (!saved?.length) return defaults;

  const resolved = saved.map((item) => resolveOutdoorOrderItem(item, outdoor));

  // キーの列に落として整え、元の項目へ引き直す（整える規則は `lib/ordering.ts` が持つ）
  const byKey = new Map<string, DisplayOrderItem>();
  for (const item of [...defaults, ...resolved]) {
    const key = orderItemKey(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }

  return normalizeOrderKeys(
    resolved.map(orderItemKey),
    defaults.map(orderItemKey)
  )
    .map((key) => byKey.get(key))
    .filter((item): item is DisplayOrderItem => item != null);
}

export function loadDisplayOrder(
  sensorDeviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS,
  outdoor: OutdoorOrderContext = EMPTY_OUTDOOR_ORDER_CONTEXT
): DisplayOrderItem[] {
  const storage = getOrderStorage();
  if (!storage) {
    return buildDefaultDisplayOrder(sensorDeviceIds, outdoor);
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return buildDefaultDisplayOrder(sensorDeviceIds, outdoor);

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return buildDefaultDisplayOrder(sensorDeviceIds, outdoor);

    const items = parsed
      .map((entry) => (typeof entry === "string" ? parseOrderItem(entry) : null))
      .filter((item): item is DisplayOrderItem => item != null);

    return normalizeDisplayOrder(items, sensorDeviceIds, outdoor);
  } catch {
    return buildDefaultDisplayOrder(sensorDeviceIds, outdoor);
  }
}

export function saveDisplayOrder(order: DisplayOrderItem[]): void {
  const storage = getOrderStorage();
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(order.map(orderItemKey)));
}

export function getChartDeviceSeriesOrder(order: DisplayOrderItem[]): number[] {
  return order
    .filter((item) => item.type === "device" || item.type === "aircon")
    .map((item) =>
      item.type === "device" ? item.deviceId : AIRCON_CHART_DEVICE_ID
    );
}

export function getSensorDeviceOrder(order: DisplayOrderItem[]): number[] {
  return order
    .filter((item): item is { type: "device"; deviceId: number } => item.type === "device")
    .map((item) => item.deviceId);
}

export function getDisplayOrderLabel(
  item: DisplayOrderItem,
  deviceNames: Record<number, string>,
  outdoorName?: string | null,
  airconName?: string | null,
  outdoorNameById: Record<string, string> = {}
): string {
  if (item.type === "device") {
    return deviceNames[item.deviceId] ?? `デバイス ${item.deviceId}`;
  }
  if (item.type === "outdoor") {
    // 地点を持つ項目は、その地点の名前だけを見る。見つからないものを基準地点の名前で
    // 補うと、消した地点が基準地点の名前で並び続ける
    if (item.locationId) return formatOutdoorApiLabel(outdoorNameById[item.locationId]);
    return formatOutdoorApiLabel(outdoorName);
  }
  return airconName ?? "エアコン";
}

export function moveDisplayOrderItem(
  order: DisplayOrderItem[],
  index: number,
  direction: -1 | 1
): DisplayOrderItem[] {
  return moveOrderItem(order, index, direction);
}
