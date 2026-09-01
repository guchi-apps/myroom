import type {
  AirconData,
  AirconUnitInfo,
  DailyStat,
  DeviceInfo,
  HistoryPoint,
  LatestData,
  OutdoorLocation,
  OutdoorLocationEntry,
  OutdoorLocationWeather,
} from "@/lib/types";

export const OFFLINE_CACHE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DB_NAME = "myroom-offline";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "dashboard";

export interface DashboardOfflineSnapshot {
  cachedAt: string;
  dataLatestAt: string | null;
  sensorDeviceIds: number[];
  airconAcId: number;
  latestByDevice: Record<number, LatestData | null>;
  dailyStatsByDevice: Record<number, DailyStat[]>;
  airconLatest: AirconData | null;
  historyData: HistoryPoint[];
  devices: DeviceInfo[];
  airconUnits: AirconUnitInfo[];
  /** 基準地点。#321より前に保存されたスナップショットにはこれしか無い */
  outdoorLocation: OutdoorLocation | null;
  /** 登録済みの屋外地点。オフラインでも地点ごとのカードを並べるために持つ（#321） */
  outdoorLocations?: OutdoorLocationEntry[];
  /** 地点ごとの「いまの天気」（#321） */
  outdoorWeathers?: OutdoorLocationWeather[];
}

export interface BuildDashboardOfflineSnapshotInput {
  sensorDeviceIds: number[];
  airconAcId: number;
  latestByDevice: Record<number, LatestData | null>;
  dailyStatsByDevice: Record<number, DailyStat[]>;
  airconLatest: AirconData | null;
  historyData: HistoryPoint[];
  devices: DeviceInfo[];
  airconUnits: AirconUnitInfo[];
  outdoorLocation: OutdoorLocation | null;
  outdoorLocations?: OutdoorLocationEntry[];
  outdoorWeathers?: OutdoorLocationWeather[];
  windowMs?: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const request = run(store);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      })
  );
}

export function parseDataTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function getLatestDataTimestamp(
  latestByDevice: Record<number, LatestData | null>,
  airconLatest: AirconData | null,
  historyData: HistoryPoint[] = []
): number | null {
  const timestamps: number[] = [];

  for (const latest of Object.values(latestByDevice)) {
    const parsed = parseDataTimestamp(latest?.datetime);
    if (parsed != null) timestamps.push(parsed);
  }

  const airconTimestamp = parseDataTimestamp(airconLatest?.datetime);
  if (airconTimestamp != null) timestamps.push(airconTimestamp);

  for (const point of historyData) {
    if (Number.isFinite(point.datetimeObj)) {
      timestamps.push(point.datetimeObj);
    }
  }

  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

export function filterHistoryToOfflineWindow(
  historyData: HistoryPoint[],
  latestMs: number,
  windowMs = OFFLINE_CACHE_WINDOW_MS
): HistoryPoint[] {
  const minMs = latestMs - windowMs;
  return historyData.filter(
    (point) => point.datetimeObj >= minMs && point.datetimeObj <= latestMs
  );
}

export function filterDailyStatsToOfflineWindow(
  dailyStatsByDevice: Record<number, DailyStat[]>,
  latestMs: number,
  windowMs = OFFLINE_CACHE_WINDOW_MS
): Record<number, DailyStat[]> {
  const minDate = new Date(latestMs - windowMs).toISOString().slice(0, 10);
  const latestDate = new Date(latestMs).toISOString().slice(0, 10);
  const filtered: Record<number, DailyStat[]> = {};

  for (const [deviceId, stats] of Object.entries(dailyStatsByDevice)) {
    filtered[Number(deviceId)] = stats.filter((stat) => {
      const date = String(stat.date).slice(0, 10);
      return date >= minDate && date <= latestDate;
    });
  }

  return filtered;
}

export function buildDashboardOfflineSnapshot(
  input: BuildDashboardOfflineSnapshotInput
): DashboardOfflineSnapshot | null {
  const windowMs = input.windowMs ?? OFFLINE_CACHE_WINDOW_MS;
  const latestMs = getLatestDataTimestamp(
    input.latestByDevice,
    input.airconLatest,
    input.historyData
  );

  if (latestMs == null) return null;

  const historyData = filterHistoryToOfflineWindow(input.historyData, latestMs, windowMs);
  if (historyData.length === 0) return null;

  return {
    cachedAt: new Date().toISOString(),
    dataLatestAt: new Date(latestMs).toISOString(),
    sensorDeviceIds: [...input.sensorDeviceIds],
    airconAcId: input.airconAcId,
    latestByDevice: input.latestByDevice,
    dailyStatsByDevice: filterDailyStatsToOfflineWindow(
      input.dailyStatsByDevice,
      latestMs,
      windowMs
    ),
    airconLatest: input.airconLatest,
    historyData,
    devices: input.devices,
    airconUnits: input.airconUnits,
    outdoorLocation: input.outdoorLocation,
    outdoorLocations: input.outdoorLocations ?? [],
    outdoorWeathers: input.outdoorWeathers ?? [],
  };
}

export async function saveDashboardOfflineSnapshot(
  snapshot: DashboardOfflineSnapshot
): Promise<void> {
  await runTransaction("readwrite", (store) => store.put(snapshot, SNAPSHOT_KEY));
}

export async function loadDashboardOfflineSnapshot(): Promise<DashboardOfflineSnapshot | null> {
  try {
    const snapshot = await runTransaction<DashboardOfflineSnapshot | undefined>("readonly", (store) =>
      store.get(SNAPSHOT_KEY)
    );
    return snapshot ?? null;
  } catch {
    return null;
  }
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
