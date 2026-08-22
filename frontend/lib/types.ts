export type TimeRange = "day" | "week" | "month" | "year" | "custom";

/** グラフの表示幅（横スクロールのウィンドウサイズ） */
export type ChartViewRange = "day" | "week" | "month" | "year";

export type ChartMetric = "temperature" | "humidity" | "pressure" | "co2" | "illuminance";

export interface LatestData {
  device_id?: number;
  datetime?: string;
  temperature?: number;
  temperature_dht11?: number;
  humidity?: number;
  pressure?: number;
  co2?: number;
  illuminance?: number;
  outdoor_temperature?: number;
  outdoor_humidity?: number;
  outdoor_pressure?: number;
}

export interface SensorRecord {
  datetime: string;
  device_id: number;
  temperature?: number | null;
  temperature_dht11?: number | null;
  humidity?: number | null;
  pressure?: number | null;
  co2?: number | null;
  illuminance?: number | null;
}

export interface SensorRecordsResponse {
  records: SensorRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface HistoryPoint {
  datetime?: string;
  datetimeObj: number;
  temperature?: number;
  temperature_dht11?: number;
  humidity?: number;
  pressure?: number;
  co2?: number;
  illuminance?: number;
  outdoor_temperature?: number;
  outdoor_humidity?: number;
  outdoor_pressure?: number;
  temperatureRange?: [number, number] | null;
  humidityRange?: [number, number] | null;
  pressureRange?: [number, number] | null;
  co2Range?: [number, number] | null;
  illuminanceRange?: [number, number] | null;
  temperature_min?: number;
  temperature_max?: number;
  humidity_min?: number;
  humidity_max?: number;
  pressure_min?: number;
  pressure_max?: number;
  co2_min?: number;
  co2_max?: number;
  illuminance_min?: number;
  illuminance_max?: number;
}

export interface DailyStat {
  date: string;
  temp_min?: number;
  temp_max?: number;
  humid_min?: number;
  humid_max?: number;
  pressure_min?: number;
  pressure_max?: number;
  co2_min?: number;
  co2_max?: number;
  illuminance_min?: number;
  illuminance_max?: number;
}

export interface OutdoorLocation {
  latitude: number;
  longitude: number;
  name: string;
}

export interface DeviceInfo {
  id: number;
  name: string;
  inherits_from?: number | null;
}

/** Open-Meteo 等 API から取得する屋外気象データの表示ラベル */
export function formatOutdoorApiLabel(locationName?: string | null): string {
  const trimmed = locationName?.trim();
  if (trimmed) return `地点データ(${trimmed})`;
  return "地点データ(未登録)";
}

export interface UiSettings {
  display_order: string[];
  chart_colors: Record<string, string>;
  hidden_devices: string[];
  stale_alert_excluded_devices: string[];
  pressure_offsets: Record<string, number>;
  /** 電気料金の単価（円/kWh）。使用量に掛けて電気代の目安を出す */
  energy_unit_price: number;
}

export interface EnergyTotal {
  kwh: number;
  cost_yen: number;
  /** 集計に入った日数（欠けている日は数えない） */
  days: number;
  start: string;
  end: string;
}

/**
 * 消費電力カードの1行。`daily_energy` の取得元（`aircon` / `tapo:<機器名>`）ごとに1件。
 */
export interface EnergySourceRow {
  /** `aircon` / `tapo:冷蔵庫` */
  source: string;
  /** 画面に出す名前。`tapo:` は落とし、`aircon` は「エアコン」になる */
  label: string;
  today_kwh: number | null;
  today_cost_yen: number | null;
  /** いまの消費電力（W）。返すのはスマートプラグだけで、エアコンは null */
  power_w: number | null;
  this_month_kwh: number;
  latest_date: string | null;
}

/** 日別の合計と、その日の取得元ごとの内訳（積み上げグラフに使う） */
export interface EnergyBreakdownDay {
  /** `2026-08-22` */
  date: string;
  kwh: number;
  cost_yen: number;
  /** `{ "aircon": 1.86, "tapo:冷蔵庫": 0.86 }`。値の無い取得元は入らない */
  by_source: Record<string, number>;
}

/** 家全体の1日ぶん。日数は常に1だが、期間合計と同じ形にして扱いを揃える */
export interface EnergyDayTotal {
  date: string;
  kwh: number;
  cost_yen: number;
  days: number;
}

/** 消費電力カードが使う集計。`GET /api/energy/breakdown` の戻り */
export interface EnergyBreakdown {
  unit_price: number;
  /** エアコンが先頭、以降は今月の使用量が多い順 */
  sources: EnergySourceRow[];
  today: EnergyDayTotal;
  this_month: EnergyTotal;
  last_month: EnergyTotal;
  /** 先月の同じ日まで。今月とそのまま比べられる */
  last_month_to_date: EnergyTotal;
  daily: EnergyBreakdownDay[];
  latest_date: string | null;
  updated_at: string | null;
}

export interface SensorDeviceStatus {
  device_id: number;
  name: string;
  last_seen: string | null;
  age_minutes: number | null;
  stale: boolean;
  has_data: boolean;
}

export interface SensorsStatusResponse {
  threshold_minutes: number;
  healthy: boolean;
  devices: SensorDeviceStatus[];
}

export interface AirconUnitInfo {
  ac_id: number;
  name: string;
}

export interface AirconData {
  ac_id?: number;
  datetime?: string;
  name?: string;
  source_name?: string;
  room_temperature?: number;
  target_temperature?: number;
  humidity?: number;
  mode?: string;
  power?: string;
  fan_speed?: string;
  fan_swing?: string;
  online?: boolean;
  model?: string;
}

export const AIRCON_MODE_LABELS: Record<string, string> = {
  HEATING: "暖房",
  COOLING: "冷房",
  FAN: "送風",
  DRY: "除湿",
  DRY_COOL: "除湿冷房",
  AUTO: "自動",
  UNKNOWN: "--",
};

export function formatAirconMode(mode?: string | null): string {
  if (!mode) return "--";
  return AIRCON_MODE_LABELS[mode] ?? mode;
}

export function hasAirconData(data: AirconData | null | undefined): boolean {
  if (!data) return false;
  return (
    data.room_temperature != null ||
    data.target_temperature != null ||
    data.power != null ||
    data.mode != null
  );
}

/** センサーカードのデータ取得結果 */
export type DeviceDataLoadStatus = "ok" | "empty" | "error";

export function hasLatestSensorValues(data: LatestData | null | undefined): boolean {
  if (!data) return false;
  return (
    data.temperature != null ||
    data.humidity != null ||
    data.pressure != null ||
    data.co2 != null ||
    data.illuminance != null
  );
}

export function hasOutdoorValues(data: LatestData | null | undefined): boolean {
  if (!data) return false;
  return (
    data.outdoor_temperature != null ||
    data.outdoor_humidity != null ||
    data.outdoor_pressure != null
  );
}

export function pickOutdoorLatestSource(
  latestByDevice: Record<number, LatestData | null | undefined>
): LatestData | null {
  const primary = latestByDevice[PRIMARY_SENSOR_DEVICE_ID];
  if (hasOutdoorValues(primary)) return primary ?? null;

  for (const data of Object.values(latestByDevice)) {
    if (hasOutdoorValues(data)) return data ?? null;
  }

  return primary ?? null;
}

export function resolveOutdoorBatchLoadStatus(
  latestByDevice: Record<number, LatestData | null | undefined>,
  loadStatusByDevice: Record<number, DeviceDataLoadStatus>
): DeviceDataLoadStatus {
  if (hasOutdoorValues(pickOutdoorLatestSource(latestByDevice))) return "ok";

  const statuses = Object.values(loadStatusByDevice);
  if (statuses.length > 0 && statuses.every((status) => status === "error")) {
    return "error";
  }
  return "empty";
}

export function resolveLatestDataLoadStatus(
  data: LatestData | null | undefined,
  fetchFailed: boolean
): DeviceDataLoadStatus {
  if (fetchFailed) return "error";
  if (hasLatestSensorValues(data)) return "ok";
  return "empty";
}

export function resolveOutdoorDataLoadStatus(
  data: LatestData | null | undefined,
  sourceFetchFailed: boolean
): DeviceDataLoadStatus {
  if (hasOutdoorValues(data)) return "ok";
  if (sourceFetchFailed) return "error";
  return "empty";
}

export function resolveAirconDataLoadStatus(
  data: AirconData | null | undefined,
  fetchFailed: boolean
): DeviceDataLoadStatus {
  if (fetchFailed) return "error";
  if (hasAirconData(data)) return "ok";
  return "empty";
}

/** グラフ・日次記録に使うデバイス */
export const PRIMARY_SENSOR_DEVICE_ID = 1;

/** デバイス一覧取得前のフォールバック */
export const FALLBACK_SENSOR_DEVICE_IDS = [1, 2] as const;

/** @deprecated API のデバイス一覧を使う。互換用フォールバックのみ */
export const DASHBOARD_SENSOR_DEVICE_IDS = FALLBACK_SENSOR_DEVICE_IDS;

/** グラフ用の仮想デバイスID（エアコン室温）。実センサーの device_id と重複しない値 */
export const AIRCON_CHART_DEVICE_ID = 9001;

/** @deprecated 旧バージョンでエアコン室温に使っていた ID（localStorage 移行用） */
export const LEGACY_AIRCON_CHART_DEVICE_ID = 3;

/** /api/devices から屋内センサーの device_id 一覧を得る */
export function getSensorDeviceIds(devices: DeviceInfo[]): number[] {
  const ids = devices
    .map((device) => device.id)
    .filter((id) => id !== AIRCON_CHART_DEVICE_ID)
    .sort((a, b) => a - b);
  return ids.length > 0 ? ids : [...FALLBACK_SENSOR_DEVICE_IDS];
}

export const CHART_METRICS: ChartMetric[] = [
  "temperature",
  "humidity",
  "pressure",
  "co2",
  "illuminance",
];

export function deviceMetricKey(deviceId: number, metric: ChartMetric): string {
  return `d${deviceId}_${metric}`;
}

export function deviceDht11TemperatureKey(deviceId: number): string {
  return `d${deviceId}_temperature_dht11`;
}

export function deviceMetricMinKey(deviceId: number, metric: ChartMetric): string {
  return `d${deviceId}_${metric}_min`;
}

export function deviceMetricMaxKey(deviceId: number, metric: ChartMetric): string {
  return `d${deviceId}_${metric}_max`;
}

export function deviceTargetMetricKey(deviceId: number): string {
  return `d${deviceId}_target_temperature`;
}

export function deviceAirconPowerKey(deviceId: number): string {
  return `d${deviceId}_aircon_power`;
}

export function getDeviceMetricValue(
  point: HistoryPoint,
  deviceId: number,
  metric: ChartMetric
): number | undefined {
  const key = deviceMetricKey(deviceId, metric);
  const row = point as unknown as Record<string, unknown>;
  if (key in row) {
    const value = row[key];
    return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
  }
  if (deviceId === PRIMARY_SENSOR_DEVICE_ID) {
    const legacy = point[metric as keyof HistoryPoint];
    return typeof legacy === "number" && !Number.isNaN(legacy) ? legacy : undefined;
  }
  return undefined;
}

export function getDeviceDht11TemperatureValue(
  point: HistoryPoint,
  deviceId: number
): number | undefined {
  const key = deviceDht11TemperatureKey(deviceId);
  const row = point as unknown as Record<string, unknown>;
  if (key in row) {
    const value = row[key];
    return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
  }
  if (deviceId === PRIMARY_SENSOR_DEVICE_ID) {
    const legacy = point.temperature_dht11;
    return typeof legacy === "number" && !Number.isNaN(legacy) ? legacy : undefined;
  }
  return undefined;
}

export function getDeviceTargetMetricValue(
  point: HistoryPoint,
  deviceId: number
): number | undefined {
  const raw = getDeviceTargetMetricRawValue(point, deviceId);
  if (raw == null || isAirconAutoTarget(raw)) return undefined;
  return raw;
}

export function isAirconPowerOff(power: unknown): boolean {
  return typeof power === "string" && power.toUpperCase() === "OFF";
}

/**
 * AirCloud Home が eco / 自動運転時に返す設定温度は、温度そのものではなく
 * 室温からのシフト量（-3.0〜+3.0 程度、0 はシフトなし）。
 * 固定の設定温度は 16〜32℃ の範囲にしかならないため、この閾値で切り分ける。
 */
export const AIRCON_AUTO_TARGET_OFFSET_LIMIT = 5;

/** 設定温度がシフト量（自動運転）かどうか。0℃ の設定温度ではない */
export function isAirconAutoTarget(value: unknown): boolean {
  return (
    typeof value === "number" &&
    !Number.isNaN(value) &&
    Math.abs(value) <= AIRCON_AUTO_TARGET_OFFSET_LIMIT
  );
}

/** 自動運転時の室温からのシフト量。自動運転でなければ undefined */
export function getAirconAutoTargetOffset(value: unknown): number | undefined {
  return isAirconAutoTarget(value) ? (value as number) : undefined;
}

/** シフト量の表示（符号付き）。シフトなしのときは空文字 */
export function formatAirconAutoTargetOffset(
  offset: number,
  options?: { withUnit?: boolean }
): string {
  if (offset === 0) return "";
  const sign = offset > 0 ? "+" : "-";
  const formatted = `${sign}${Math.abs(offset).toFixed(1)}`;
  return options?.withUnit === false ? formatted : `${formatted}°C`;
}

export function getDeviceTargetMetricRawValue(
  point: HistoryPoint,
  deviceId: number
): number | undefined {
  const key = deviceTargetMetricKey(deviceId);
  const row = point as unknown as Record<string, unknown>;
  const value = row[key];
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string" && value !== "") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

export function formatAirconTargetTemperature(
  value: number | null | undefined,
  options?: { withUnit?: boolean }
): string {
  if (value == null) return "--";
  const offset = getAirconAutoTargetOffset(value);
  if (offset != null) {
    const offsetLabel = formatAirconAutoTargetOffset(offset, options);
    return offsetLabel
      ? `${AIRCON_MODE_LABELS.AUTO} ${offsetLabel}`
      : AIRCON_MODE_LABELS.AUTO;
  }
  const formatted = value.toFixed(1);
  return options?.withUnit === false ? formatted : `${formatted}°C`;
}

/**
 * カードに出す「運転モード + 設定温度」。
 * 自動運転はモード名と設定温度の表示がどちらも「自動」になるため、1つにまとめる。
 */
export function formatAirconModeTarget(
  data: Pick<AirconData, "mode" | "power" | "target_temperature">
): string {
  const powerOff = isAirconPowerOff(data.power);
  const modeLabel = powerOff ? "停止" : formatAirconMode(data.mode);
  if (powerOff || data.target_temperature == null) return modeLabel;

  const offset = getAirconAutoTargetOffset(data.target_temperature);
  if (offset != null) {
    const autoLabel = AIRCON_MODE_LABELS.AUTO;
    const base = modeLabel === autoLabel ? autoLabel : `${modeLabel} ${autoLabel}`;
    const offsetLabel = formatAirconAutoTargetOffset(offset);
    return offsetLabel ? `${base} ${offsetLabel}` : base;
  }

  return `${modeLabel} ${formatAirconTargetTemperature(data.target_temperature)}`;
}

/** Recharts 用の設定温度系列キー */
export const AIRCON_TARGET_CHART_KEY = "airconTarget";

/** グラフのデバイスライン色（指標に関係なくデバイス固定） */
export const DEVICE_LINE_COLORS: Record<number, string> = {
  1: "#3498db",
  2: "#e67e22",
  3: "#9b59b6",
  [AIRCON_CHART_DEVICE_ID]: "#1abc9c",
};

/** エアコン設定温度ライン（室温とは別色） */
export const AIRCON_TARGET_LINE_COLORS = {
  light: "#9333ea",
  dark: "#e879f9",
} as const;

export function getDeviceLineColor(deviceId: number): string {
  return DEVICE_LINE_COLORS[deviceId] ?? "#95a5a6";
}

export function getAirconTargetLineColor(theme: "light" | "dark" = "light"): string {
  return AIRCON_TARGET_LINE_COLORS[theme];
}

export interface OutdoorLocationSearchResult {
  name: string;
  label: string;
  latitude: number;
  longitude: number;
}

export const METRIC_COLORS: Record<ChartMetric, string> = {
  temperature: "#3498db",
  humidity: "#2ecc71",
  pressure: "#9b59b6",
  co2: "#e67e22",
  illuminance: "#f1c40f",
};

export const METRIC_LABELS: Record<ChartMetric, string> = {
  temperature: "温度",
  humidity: "湿度",
  pressure: "気圧",
  co2: "CO2",
  illuminance: "照度",
};

export const METRIC_UNITS: Record<ChartMetric, string> = {
  temperature: "°C",
  humidity: "%",
  pressure: "hPa",
  co2: "ppm",
  illuminance: " lx",
};

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  day: "1D",
  week: "1W",
  month: "1M",
  year: "1Y",
  custom: "全期間",
};

export const CHART_VIEW_RANGE_LABELS: Record<ChartViewRange, string> = {
  day: "日",
  week: "週",
  month: "月",
  year: "年",
};
