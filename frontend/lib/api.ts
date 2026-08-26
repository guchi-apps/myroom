import {
  AIRCON_CHART_DEVICE_ID,
  DASHBOARD_SENSOR_DEVICE_IDS,
  FALLBACK_SENSOR_DEVICE_IDS,
  PRIMARY_SENSOR_DEVICE_ID,
  hasAirconData,
  resolveAirconDataLoadStatus,
  resolveLatestDataLoadStatus,
  type AirconControlCommand,
  type AirconControlState,
  type AirconData,
  type AirconUnitInfo,
  type DailyStat,
  type DeviceDataLoadStatus,
  type DeviceInfo,
  type EnergyBreakdown,
  type HistoryPoint,
  type LatestData,
  type OutdoorLocation,
  type OutdoorLocationSearchResult,
  type SensorRecordsResponse,
  type SensorsStatusResponse,
  type TimeRange,
  type ChartViewRange,
  type UiSettings,
  type UtilityBillSummary,
} from "@/lib/types";
import type { CleaningSchedule, CleaningTaskInput } from "@/lib/cleaning";
import type { GarbageSchedule } from "@/lib/garbage";
import type { RemoteButtons, RemoteSendResult } from "@/lib/remote";
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

export interface AirconUnitsResponse {
  units: AirconUnitInfo[];
  /** 操作パネルを出してよいか。白くまくんのログイン情報が未設定なら false */
  control_enabled: boolean;
}

export async function fetchAirconUnitsResponse(): Promise<AirconUnitsResponse> {
  const data = await fetchJson<AirconUnitsResponse>("/api/aircon/units");
  return { units: data.units ?? [], control_enabled: data.control_enabled ?? false };
}

export async function fetchAirconUnits(): Promise<AirconUnitInfo[]> {
  return (await fetchAirconUnitsResponse()).units;
}

/** 操作パネル用の現在状態。DBの最新記録ではなくエアコンから直接読む */
export async function fetchAirconControlState(
  acId: number
): Promise<AirconControlState> {
  return airconControlRequest(`/api/aircon/units/${acId}/state`);
}

export async function sendAirconControl(
  acId: number,
  command: AirconControlCommand
): Promise<AirconControlState> {
  return airconControlRequest(`/api/aircon/units/${acId}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
}

/**
 * 操作APIの呼び出し。**バックエンドが返した理由をそのまま画面へ運ぶ。**
 * 「つながらない」「混み合っている」「設定されていない」を区別できないと、
 * 送ったのに効かないときに打つ手が分からなくなる。
 */
async function airconControlRequest(
  url: string,
  init?: RequestInit
): Promise<AirconControlState> {
  const res = await fetchWithAuth(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `エアコンを操作できませんでした（${res.status}）`);
  }
  return res.json() as Promise<AirconControlState>;
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

/**
 * ログインしたことをバックエンドへ知らせる（Signaly のログイン通知の起点。#240）。
 *
 * Supabase Auth ではコールバックが Supabase 側でホストされるため、バックエンドには
 * 「ログインした瞬間」が通らない。認証コールバックの完了時にここから1回だけ叩く。
 * **通知はおまけなので、失敗してもログインは通す。**
 */
export async function notifyLogin(): Promise<void> {
  try {
    // fetchWithAuth を使わないのは、401 でサインアウトさせないため。
    // 通知はおまけなので、ここでの失敗がセッションに影響してはいけない。
    await fetch("/api/auth/login-notify", {
      method: "POST",
      headers: await authHeaders(),
    });
  } catch {
    // 通知先が未設定・到達不能でもログインを止めない
  }
}

export async function fetchGarbageSchedule(): Promise<GarbageSchedule> {
  return fetchJson<GarbageSchedule>("/api/garbage");
}

/** 掃除カード用。場所ごとの次にやる日まで計算済みで返る */
export async function fetchCleaningSchedule(): Promise<CleaningSchedule> {
  return fetchJson<CleaningSchedule>("/api/cleaning");
}

/**
 * 掃除の定義をまとめて置き換える（追加・編集・削除・並べ替えを1回で送る）。
 * 実施履歴は送らない。同じ id の項目からサーバー側が引き継ぐ。
 */
export async function updateCleaningTasks(
  tasks: CleaningTaskInput[]
): Promise<CleaningSchedule> {
  const res = await fetchWithAuth("/api/cleaning/tasks", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tasks }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<CleaningSchedule>;
}

/** 掃除をやった記録を足す。次にやる日はこの日から数え直される */
export async function markCleaningDone(taskId: string): Promise<CleaningSchedule> {
  const res = await fetchWithAuth(
    `/api/cleaning/tasks/${encodeURIComponent(taskId)}/done`,
    { method: "POST" }
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<CleaningSchedule>;
}

/** 電気の操作カード用。押せるボタンの一覧だけを取る（Nature Remo は叩かない） */
export async function fetchRemoteButtons(): Promise<RemoteButtons> {
  return fetchJson<RemoteButtons>("/api/remote/buttons");
}

/** ボタンを押す。失敗した理由はそのままカードに出すため、detail を Error に載せる */
export async function sendRemoteButton(buttonId: string): Promise<RemoteSendResult> {
  let res: Response;
  try {
    res = await fetchWithAuth(
      `/api/remote/buttons/${encodeURIComponent(buttonId)}/send`,
      { method: "POST" }
    );
  } catch (err) {
    if (err instanceof AuthError) throw err;
    // ここへ来るのは fetch 自体が失敗したとき。文言はそのままカードに出る
    throw new Error("通信できませんでした（オフラインかもしれません）");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<RemoteSendResult>;
}

/** 消費電力カード用。エアコンとスマートプラグをまとめた集計を取る */
export async function fetchEnergyBreakdown(days = 30): Promise<EnergyBreakdown> {
  const params = new URLSearchParams({ days: String(days) });
  return fetchJson<EnergyBreakdown>(`/api/energy/breakdown?${params.toString()}`);
}

/** 電気・ガス料金カード用。はぴeみる電のメール由来の月次請求を取る */
export async function fetchBillsSummary(months = 12): Promise<UtilityBillSummary> {
  const params = new URLSearchParams({ months: String(months) });
  return fetchJson<UtilityBillSummary>(`/api/bills/summary?${params.toString()}`);
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
