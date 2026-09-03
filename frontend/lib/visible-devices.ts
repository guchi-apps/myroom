import {
  EMPTY_OUTDOOR_ORDER_CONTEXT,
  LEGACY_OUTDOOR_ORDER_KEY,
  orderItemKey,
  outdoorOrderKey,
  type DisplayOrderItem,
  type OutdoorOrderContext,
} from "@/lib/display-order";
import {
  AIRCON_TARGET_VISIBILITY_KEY,
  deviceDht11VisibilityKey,
  deviceMetricVisibilityKey,
  deviceVisibilityKey,
  outdoorMetricVisibilityKey,
  OUTDOOR_VISIBILITY_KEY,
} from "@/lib/chart-line-visibility";
import {
  AIRCON_CHART_DEVICE_ID,
  CHART_METRICS,
  DASHBOARD_SENSOR_DEVICE_IDS,
} from "@/lib/types";
import { COMING_SOON_SECTION_KEY, LIFE_CARDS } from "@/lib/dashboard-sections";

export { AIRCON_TARGET_VISIBILITY_KEY } from "@/lib/chart-line-visibility";

export const AIRCON_ROOM_HIDDEN_KEY = deviceVisibilityKey(AIRCON_CHART_DEVICE_ID);

export const HIDDEN_DEVICES_STORAGE_KEY = "myroom_hidden_devices";
export const VISIBLE_DEVICES_CHANGED_EVENT = "myroom-visible-devices-changed";

function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function buildAllDashboardTargetKeys(
  sensorDeviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS,
  outdoorLocationIds: readonly string[] = []
): Set<string> {
  const keys = new Set<string>();
  for (const deviceId of sensorDeviceIds) {
    keys.add(orderItemKey({ type: "device", deviceId }));
    keys.add(deviceDht11VisibilityKey(deviceId));
  }
  keys.add(LEGACY_OUTDOOR_ORDER_KEY);
  for (const locationId of outdoorLocationIds) {
    keys.add(outdoorOrderKey(locationId));
  }
  keys.add(AIRCON_ROOM_HIDDEN_KEY);
  keys.add(AIRCON_TARGET_VISIBILITY_KEY);
  // 暮らしセクションのカード（display_order には混ぜず、表示・非表示だけ共通で持つ）
  for (const card of LIFE_CARDS) {
    keys.add(card.key);
  }
  // 近日公開セクションはカード単位ではなくセクションごと切り替える
  keys.add(COMING_SOON_SECTION_KEY);
  return keys;
}

export function isHiddenKeyVisible(hiddenKeys: Set<string>, key: string): boolean {
  if (key === "aircon") {
    return isAirconAnyVisible(hiddenKeys);
  }
  return !hiddenKeys.has(key);
}

export function isAirconRoomVisible(hiddenKeys: Set<string>): boolean {
  if (hiddenKeys.has("aircon")) return false;
  return !hiddenKeys.has(AIRCON_ROOM_HIDDEN_KEY);
}

export function isAirconTargetVisible(hiddenKeys: Set<string>): boolean {
  if (hiddenKeys.has("aircon")) return false;
  return !hiddenKeys.has(AIRCON_TARGET_VISIBILITY_KEY);
}

export function isAirconAnyVisible(hiddenKeys: Set<string>): boolean {
  return isAirconRoomVisible(hiddenKeys) || isAirconTargetVisible(hiddenKeys);
}

export function isDeviceDht11Visible(
  hiddenKeys: Set<string>,
  deviceId: number
): boolean {
  return !hiddenKeys.has(deviceDht11VisibilityKey(deviceId));
}

export function setHiddenKeyVisible(
  hiddenKeys: Set<string>,
  key: string,
  visible: boolean
): Set<string> {
  const next = new Set(hiddenKeys);
  if (visible) {
    next.delete(key);
    if (key === AIRCON_ROOM_HIDDEN_KEY || key === AIRCON_TARGET_VISIBILITY_KEY) {
      next.delete("aircon");
    }
  } else {
    next.add(key);
    if (key === AIRCON_ROOM_HIDDEN_KEY || key === AIRCON_TARGET_VISIBILITY_KEY) {
      next.delete("aircon");
    }
  }
  return next;
}

export function normalizeHiddenDeviceKeys(
  saved: readonly string[] | null,
  sensorDeviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS,
  outdoor: OutdoorOrderContext = EMPTY_OUTDOOR_ORDER_CONTEXT
): Set<string> {
  const validKeys = buildAllDashboardTargetKeys(sensorDeviceIds, outdoor.locationIds);
  if (!saved?.length) return new Set();

  const normalized = new Set<string>();
  for (const key of saved) {
    if (key === "aircon") {
      normalized.add(AIRCON_ROOM_HIDDEN_KEY);
      normalized.add(AIRCON_TARGET_VISIBILITY_KEY);
      continue;
    }
    // 地点を持たない屋外は基準地点を隠していたもの（#308以前）として読み替える
    if (key === LEGACY_OUTDOOR_ORDER_KEY && outdoor.primaryId) {
      normalized.add(outdoorOrderKey(outdoor.primaryId));
      continue;
    }
    if (validKeys.has(key)) {
      normalized.add(key);
    }
  }
  return normalized;
}

export function loadHiddenDeviceKeys(
  sensorDeviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS
): Set<string> {
  const storage = getStorage();
  if (!storage) return new Set();

  try {
    const raw = storage.getItem(HIDDEN_DEVICES_STORAGE_KEY);
    if (!raw) return new Set();

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();

    const keys = parsed.filter((entry): entry is string => typeof entry === "string");
    return normalizeHiddenDeviceKeys(keys, sensorDeviceIds);
  } catch {
    return new Set();
  }
}

export function saveHiddenDeviceKeys(keys: Set<string>): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(HIDDEN_DEVICES_STORAGE_KEY, JSON.stringify([...keys]));
  window.dispatchEvent(new Event(VISIBLE_DEVICES_CHANGED_EVENT));
}

export function isTargetVisible(
  hiddenKeys: Set<string>,
  item: DisplayOrderItem
): boolean {
  if (item.type === "aircon") {
    return isAirconAnyVisible(hiddenKeys);
  }
  return !hiddenKeys.has(orderItemKey(item));
}

/**
 * カードごとの表示・非表示を切り替える。
 *
 * **エアコンだけは `isTargetVisible()` が2つのキー（室温・設定温度）を見ている**ため、
 * `orderItemKey()` の `"aircon"` を足し引きするだけでは切り替えが片道になる（#358）。
 * 保存済みの `"aircon"` は `normalizeHiddenDeviceKeys()` が読み込み時に2つのキーへ
 * 読み替えるので、非表示にして開き直したあとに表示へ戻しても
 * （消すのは `"aircon"` だけで2つのキーが残り）**カードが戻ってこなかった**。
 * 判定に使うキーをそのまま足し引きする。
 */
export function setTargetVisible(
  hiddenKeys: Set<string>,
  item: DisplayOrderItem,
  visible: boolean
): Set<string> {
  if (item.type === "aircon") {
    // `setHiddenKeyVisible()` はこの2つのキーを触るときに旧 `"aircon"` も落とす
    const next = setHiddenKeyVisible(hiddenKeys, AIRCON_ROOM_HIDDEN_KEY, visible);
    return setHiddenKeyVisible(next, AIRCON_TARGET_VISIBILITY_KEY, visible);
  }

  const key = orderItemKey(item);
  const next = new Set(hiddenKeys);
  if (visible) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

export function filterDisplayOrderByVisibility(
  order: DisplayOrderItem[],
  hiddenKeys: Set<string>
): DisplayOrderItem[] {
  return order.filter((item) => isTargetVisible(hiddenKeys, item));
}

/** 非表示デバイスを末尾にまとめた表示順（各グループ内の相対順は維持） */
export function sortDisplayOrderHiddenLast(
  order: DisplayOrderItem[],
  hiddenKeys: Set<string>
): DisplayOrderItem[] {
  const visible: DisplayOrderItem[] = [];
  const hidden: DisplayOrderItem[] = [];
  for (const item of order) {
    if (isTargetVisible(hiddenKeys, item)) {
      visible.push(item);
    } else {
      hidden.push(item);
    }
  }
  return [...visible, ...hidden];
}

export function getVisibleSensorDeviceIds(
  sensorDeviceIds: readonly number[],
  hiddenKeys: Set<string>
): number[] {
  return sensorDeviceIds.filter((deviceId) =>
    isTargetVisible(hiddenKeys, { type: "device", deviceId })
  );
}

export function getVisibleChartDeviceIds(
  sensorDeviceIds: readonly number[],
  hiddenKeys: Set<string>
): number[] {
  const ids = getVisibleSensorDeviceIds(sensorDeviceIds, hiddenKeys);
  if (isAirconRoomVisible(hiddenKeys)) {
    ids.push(AIRCON_CHART_DEVICE_ID);
  }
  return ids;
}

/**
 * 推移グラフの屋外ラインは基準地点の1本だけ（#321）。カードは地点ごとに増えるが、
 * ラインを消すのは基準地点のカードを隠したときに限る。
 */
export function applyHiddenDevicesToLineVisibility<T extends Record<string, boolean>>(
  lineVisibility: T,
  hiddenKeys: Set<string>,
  sensorDeviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS,
  outdoorPrimaryKey: string = OUTDOOR_VISIBILITY_KEY
): T {
  const merged = { ...lineVisibility };
  for (const deviceId of sensorDeviceIds) {
    const key = deviceVisibilityKey(deviceId);
    if (hiddenKeys.has(key)) {
      for (const metric of CHART_METRICS) {
        merged[deviceMetricVisibilityKey(deviceId, metric) as keyof T] = false as T[keyof T];
      }
      merged[deviceDht11VisibilityKey(deviceId) as keyof T] = false as T[keyof T];
    } else {
      const dht11Key = deviceDht11VisibilityKey(deviceId);
      if (hiddenKeys.has(dht11Key)) {
        merged[dht11Key as keyof T] = false as T[keyof T];
      }
    }
  }
  if (hiddenKeys.has(outdoorPrimaryKey)) {
    for (const metric of CHART_METRICS) {
      merged[outdoorMetricVisibilityKey(metric) as keyof T] = false as T[keyof T];
    }
  }
  if (!isAirconRoomVisible(hiddenKeys)) {
    for (const metric of CHART_METRICS) {
      merged[deviceMetricVisibilityKey(AIRCON_CHART_DEVICE_ID, metric) as keyof T] = false as T[keyof T];
    }
  }
  if (!isAirconTargetVisible(hiddenKeys)) {
    merged[AIRCON_TARGET_VISIBILITY_KEY as keyof T] = false as T[keyof T];
  }
  return merged;
}
