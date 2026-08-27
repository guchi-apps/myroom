import { moveOrderItem, normalizeOrderKeys } from "@/lib/ordering";
import {
  AIRCON_CHART_DEVICE_ID,
  DASHBOARD_SENSOR_DEVICE_IDS,
  formatOutdoorApiLabel,
} from "@/lib/types";

export type DisplayOrderItem =
  | { type: "device"; deviceId: number }
  | { type: "outdoor" }
  | { type: "aircon" };

export const DISPLAY_ORDER_CHANGED_EVENT = "myroom-display-order-changed";

const STORAGE_KEY = "myroom_display_order";

function getOrderStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function orderItemKey(item: DisplayOrderItem): string {
  if (item.type === "device") return `device:${item.deviceId}`;
  return item.type;
}

function parseOrderItem(key: string): DisplayOrderItem | null {
  if (key === "outdoor") return { type: "outdoor" };
  if (key === "aircon") return { type: "aircon" };
  if (key.startsWith("device:")) {
    const deviceId = Number(key.slice("device:".length));
    return Number.isFinite(deviceId) ? { type: "device", deviceId } : null;
  }
  return null;
}

export function buildDefaultDisplayOrder(
  sensorDeviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS
): DisplayOrderItem[] {
  return [
    ...sensorDeviceIds.map((deviceId) => ({ type: "device" as const, deviceId })),
    { type: "outdoor" as const },
    { type: "aircon" as const },
  ];
}

export function normalizeDisplayOrder(
  saved: DisplayOrderItem[] | null,
  sensorDeviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS
): DisplayOrderItem[] {
  const defaults = buildDefaultDisplayOrder(sensorDeviceIds);
  if (!saved?.length) return defaults;

  // キーの列に落として整え、元の項目へ引き直す（整える規則は `lib/ordering.ts` が持つ）
  const byKey = new Map<string, DisplayOrderItem>();
  for (const item of [...defaults, ...saved]) {
    const key = orderItemKey(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }

  return normalizeOrderKeys(
    saved.map(orderItemKey),
    defaults.map(orderItemKey)
  )
    .map((key) => byKey.get(key))
    .filter((item): item is DisplayOrderItem => item != null);
}

export function loadDisplayOrder(
  sensorDeviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS
): DisplayOrderItem[] {
  const storage = getOrderStorage();
  if (!storage) {
    return buildDefaultDisplayOrder(sensorDeviceIds);
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return buildDefaultDisplayOrder(sensorDeviceIds);

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return buildDefaultDisplayOrder(sensorDeviceIds);

    const items = parsed
      .map((entry) => (typeof entry === "string" ? parseOrderItem(entry) : null))
      .filter((item): item is DisplayOrderItem => item != null);

    return normalizeDisplayOrder(items, sensorDeviceIds);
  } catch {
    return buildDefaultDisplayOrder(sensorDeviceIds);
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
  airconName?: string | null
): string {
  if (item.type === "device") {
    return deviceNames[item.deviceId] ?? `デバイス ${item.deviceId}`;
  }
  if (item.type === "outdoor") {
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
