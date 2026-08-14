import {
  AIRCON_CHART_DEVICE_ID,
  DASHBOARD_SENSOR_DEVICE_IDS,
  FALLBACK_SENSOR_DEVICE_IDS,
  PRIMARY_SENSOR_DEVICE_ID,
  hasAirconData,
  resolveAirconDataLoadStatus,
  resolveLatestDataLoadStatus,
  type AirconData,
  type AirconUnitInfo,
  type DailyStat,
  type DeviceDataLoadStatus,
  type DeviceInfo,
  type HistoryPoint,
  type LatestData,
  type OutdoorLocation,
  type OutdoorLocationSearchResult,
  type SensorRecordsResponse,
  type SensorsStatusResponse,
  type TimeRange,
  type ChartViewRange,
  type UiSettings,
} from "@/lib/types";
import type { GarbageSchedule } from "@/lib/garbage";
import { processHistoryData, processAirconHistoryData } from "@/lib/chart-utils";
import { toApiDateTime, type AirconHistoryPoint } from "@/lib/history-loader";
import { expandDeviceIdsForHistory } from "@/lib/device-inheritance";
import { authHeaders, AuthError } from "@/lib/auth";
import { supabase } from "@/lib/supabase-client";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(await authHeaders()),
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch";
    throw new TypeError(`${message} (${url})`);
  }
  if (res.status === 401) {
    await supabase.auth.signOut();
    throw new AuthError();
  }
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(await authHeaders()),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    await supabase.auth.signOut();
    throw new AuthError();
  }
  return res;
}

export async function fetchUiSettings(): Promise<UiSettings> {
  return fetchJson<UiSettings>("/api/ui-settings");
}

export async function updateUiSettings(
  settings: Partial<UiSettings>
): Promise<UiSettings> {
  const res = await fetchWithAuth("/api/ui-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<UiSettings>;
}

export async function fetchLatest(deviceId = PRIMARY_SENSOR_DEVICE_ID): Promise<LatestData> {
  return fetchJson<LatestData>(`/api/latest?device=${deviceId}`);
}

export async function fetchAirconLatest(acId?: number): Promise<AirconData | null> {
  const url =
    acId != null ? `/api/aircon/latest?ac_id=${acId}` : "/api/aircon/latest";
  const data = await fetchJson<AirconData>(url);
  return hasAirconData(data) ? data : null;
}

export async function fetchHistory(
  timeRange: TimeRange,
  customStartDate: string,
  customEndDate: string,
  deviceId = PRIMARY_SENSOR_DEVICE_ID
): Promise<HistoryPoint[]> {
  let url = `/api/history?range=${timeRange}&device=${deviceId}`;
  if (timeRange === "custom") {
    url = `/api/history?start=${customStartDate}&end=${customEndDate}&device=${deviceId}`;
  }
  const data = await fetchJson<Record<string, unknown>[]>(url);
  return processHistoryData(data);
}

export async function fetchOutdoorHistoryWindow(
  start: Date,
  end: Date,
  viewRange: ChartViewRange
): Promise<HistoryPoint[]> {
  const params = new URLSearchParams({
    start: toApiDateTime(start),
    end: toApiDateTime(end),
  });
  if (viewRange === "year") {
    params.set("range", "year");
  }
  const data = await fetchJson<Record<string, unknown>[]>(
    `/api/outdoor-history?${params.toString()}`
  );
  return processHistoryData(data);
}

export async function fetchHistoryWindow(
  start: Date,
  end: Date,
  viewRange: ChartViewRange,
  deviceId = PRIMARY_SENSOR_DEVICE_ID
): Promise<HistoryPoint[]> {
  const params = new URLSearchParams({
    start: toApiDateTime(start),
    end: toApiDateTime(end),
    device: String(deviceId),
  });
  if (viewRange === "year") {
    params.set("range", "year");
  }
  const data = await fetchJson<Record<string, unknown>[]>(
    `/api/history?${params.toString()}`
  );
  return processHistoryData(data);
}

export async function fetchAirconHistoryWindow(
  start: Date,
  end: Date,
  viewRange: ChartViewRange,
  acId = 1
): Promise<AirconHistoryPoint[]> {
  const params = new URLSearchParams({
    start: toApiDateTime(start),
    end: toApiDateTime(end),
    ac_id: String(acId),
  });
  if (viewRange === "year") {
    params.set("range", "year");
  }
  const data = await fetchJson<Record<string, unknown>[]>(
    `/api/aircon/history?${params.toString()}`
  );
  return processAirconHistoryData(data);
}

export async function fetchDailyStats(
  deviceId = PRIMARY_SENSOR_DEVICE_ID
): Promise<DailyStat[]> {
  return fetchJson<DailyStat[]>(`/api/daily-stats?device=${deviceId}`);
}

export async function fetchDailyStatsBatch(
  deviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS
): Promise<Record<number, DailyStat[]>> {
  const results = await Promise.allSettled(
    deviceIds.map((deviceId) => fetchDailyStats(deviceId))
  );

  const dailyStatsByDevice: Record<number, DailyStat[]> = {};
  deviceIds.forEach((deviceId, index) => {
    const result = results[index];
    dailyStatsByDevice[deviceId] =
      result.status === "fulfilled" ? result.value : [];
  });
  return dailyStatsByDevice;
}

export async function fetchAirconDailyStats(acId = 1): Promise<DailyStat[]> {
  return fetchJson<DailyStat[]>(`/api/aircon/daily-stats?ac_id=${acId}`);
}

export async function fetchDevices(): Promise<DeviceInfo[]> {
  const data = await fetchJson<{ devices: DeviceInfo[] }>("/api/devices");
  return data.devices;
}

export async function updateDeviceName(
  deviceId: number,
  name: string,
  inheritsFrom?: number | null
): Promise<DeviceInfo> {
  const body: { name: string; inherits_from?: number | null } = { name };
  if (inheritsFrom !== undefined) {
    body.inherits_from = inheritsFrom;
  }
  const res = await fetchWithAuth(`/api/devices/${deviceId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<DeviceInfo>;
}

export async function fetchAirconUnits(): Promise<AirconUnitInfo[]> {
  const data = await fetchJson<{ units: AirconUnitInfo[] }>("/api/aircon/units");
  return data.units;
}

export async function updateAirconUnitName(
  acId: number,
  name: string
): Promise<AirconUnitInfo> {
  const res = await fetchWithAuth(`/api/aircon/units/${acId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<AirconUnitInfo>;
}

export async function fetchOutdoorLocation(): Promise<OutdoorLocation> {
  return fetchJson<OutdoorLocation>("/api/outdoor-location");
}

export async function updateOutdoorLocation(
  location: OutdoorLocation
): Promise<OutdoorLocation> {
  const res = await fetchWithAuth("/api/outdoor-location", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(location),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<OutdoorLocation>;
}

export async function searchOutdoorLocations(
  query: string
): Promise<OutdoorLocationSearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const data = await fetchJson<{ results: OutdoorLocationSearchResult[] }>(
    `/api/outdoor-location/search?${params}`
  );
  return data.results;
}

export async function fetchSensorRecords(
  deviceId: number,
  offset = 0,
  limit = 100
): Promise<SensorRecordsResponse> {
  const params = new URLSearchParams({
    device: String(deviceId),
    limit: String(limit),
    offset: String(offset),
  });
  return fetchJson<SensorRecordsResponse>(`/api/records?${params.toString()}`);
}

export async function deleteSensorRecord(
  deviceId: number,
  datetime: string
): Promise<void> {
  const params = new URLSearchParams({
    device: String(deviceId),
    datetime,
  });
  const res = await fetchWithAuth(`/api/records?${params.toString()}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Request failed: ${res.status}`);
  }
}

export async function deleteSensorRecordsBulk(
  deviceId: number,
  datetimes: string[]
): Promise<number> {
  const res = await fetchWithAuth("/api/records/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device: deviceId, datetimes }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Request failed: ${res.status}`);
  }
  const data = (await res.json()) as { deleted_count: number };
  return data.deleted_count;
}

export async function fetchSensorsStatus(): Promise<SensorsStatusResponse> {
  return fetchJson<SensorsStatusResponse>("/api/sensors/status");
}

export async function fetchGarbageSchedule(): Promise<GarbageSchedule> {
  return fetchJson<GarbageSchedule>("/api/garbage");
}

export interface LatestBatchResult {
  latestByDevice: Record<number, LatestData | null>;
  loadStatusByDevice: Record<number, DeviceDataLoadStatus>;
}

export async function fetchLatestBatch(
  deviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS
): Promise<LatestBatchResult> {
  const results = await Promise.allSettled(
    deviceIds.map((deviceId) => fetchLatest(deviceId))
  );

  const latestByDevice: Record<number, LatestData | null> = {};
  const loadStatusByDevice: Record<number, DeviceDataLoadStatus> = {};
  deviceIds.forEach((deviceId, index) => {
    const result = results[index];
    if (result.status === "fulfilled") {
      latestByDevice[deviceId] = result.value;
      loadStatusByDevice[deviceId] = resolveLatestDataLoadStatus(result.value, false);
    } else {
      latestByDevice[deviceId] = null;
      loadStatusByDevice[deviceId] = "error";
    }
  });
  return { latestByDevice, loadStatusByDevice };
}

export async function fetchDashboardData(
  acId = 1,
  sensorDeviceIds: readonly number[] = FALLBACK_SENSOR_DEVICE_IDS,
  devices: readonly DeviceInfo[] = []
) {
  const dailyStatsIds = expandDeviceIdsForHistory(sensorDeviceIds, devices);

  const [latestByDevice, dailyStatsByDevice, airconDailyStats, airconLatest] =
    await Promise.allSettled([
      fetchLatestBatch(sensorDeviceIds),
      fetchDailyStatsBatch(dailyStatsIds.length > 0 ? dailyStatsIds : sensorDeviceIds),
      fetchAirconDailyStats(acId),
      fetchAirconLatest(acId),
    ]);

  const mergedDailyStats =
    dailyStatsByDevice.status === "fulfilled" ? { ...dailyStatsByDevice.value } : {};
  if (airconDailyStats.status === "fulfilled" && airconDailyStats.value.length > 0) {
    mergedDailyStats[AIRCON_CHART_DEVICE_ID] = airconDailyStats.value;
  }

  const latestBatch =
    latestByDevice.status === "fulfilled"
      ? latestByDevice.value
      : {
          latestByDevice: {} as Record<number, LatestData | null>,
          loadStatusByDevice: Object.fromEntries(
            sensorDeviceIds.map((deviceId) => [deviceId, "error" as const])
          ),
        };

  const airconFetchFailed = airconLatest.status === "rejected";
  const airconValue = airconLatest.status === "fulfilled" ? airconLatest.value : null;

  return {
    latestByDevice: latestBatch.latestByDevice,
    latestLoadStatusByDevice: latestBatch.loadStatusByDevice,
    latest:
      latestByDevice.status === "fulfilled"
        ? latestBatch.latestByDevice[PRIMARY_SENSOR_DEVICE_ID] ?? null
        : null,
    dailyStatsByDevice: mergedDailyStats,
    airconLatest: airconValue,
    airconLoadStatus: resolveAirconDataLoadStatus(airconValue, airconFetchFailed),
    dashboardFetchFailed:
      latestByDevice.status === "rejected" &&
      airconLatest.status === "rejected",
  };
}
