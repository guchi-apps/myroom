import {
  buildDefaultChartColors,
  normalizeChartColors,
  type ChartColorSettings,
} from "@/lib/chart-colors";
import {
  buildDefaultDisplayOrder,
  normalizeDisplayOrder,
  orderItemKey,
  type DisplayOrderItem,
} from "@/lib/display-order";
import {
  buildDefaultLifeCardOrder,
  normalizeLifeCardOrder,
} from "@/lib/life-card-order";
import {
  normalizeHiddenDeviceKeys,
} from "@/lib/visible-devices";
import { fetchUiSettings, updateUiSettings } from "@/lib/api";
import { DASHBOARD_SENSOR_DEVICE_IDS } from "@/lib/types";

const LEGACY_DISPLAY_ORDER_KEY = "myroom_display_order";
const LEGACY_CHART_COLORS_KEY = "myroom_chart_colors";
const LEGACY_HIDDEN_DEVICES_KEY = "myroom_hidden_devices";
const MIGRATION_FLAG_KEY = "myroom_ui_settings_migrated";

function parseOrderItem(key: string): DisplayOrderItem | null {
  if (key === "outdoor") return { type: "outdoor" };
  if (key === "aircon") return { type: "aircon" };
  if (key.startsWith("device:")) {
    const deviceId = Number(key.slice("device:".length));
    return Number.isFinite(deviceId) ? { type: "device", deviceId } : null;
  }
  return null;
}

function clearLegacyStorage(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LEGACY_DISPLAY_ORDER_KEY);
  localStorage.removeItem(LEGACY_CHART_COLORS_KEY);
  localStorage.removeItem(LEGACY_HIDDEN_DEVICES_KEY);
}

/** DB を正とし、旧 localStorage の UI 設定は破棄する（DB へは書き込まない） */
function discardLegacyLocalStorage(): void {
  if (typeof window === "undefined") return;
  clearLegacyStorage();
  localStorage.setItem(MIGRATION_FLAG_KEY, "true");
}

export async function loadUiSettingsFromServer(
  sensorDeviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS
): Promise<{
  displayOrder: DisplayOrderItem[];
  lifeCardOrder: string[];
  chartColors: ChartColorSettings;
  hiddenDeviceKeys: Set<string>;
  staleAlertExcludedKeys: Set<string>;
  pressureOffsets: Record<string, number>;
  lightThresholds: Record<string, number>;
}> {
  discardLegacyLocalStorage();
  const settings = await fetchUiSettings();

  const displayOrder = normalizeDisplayOrder(
    settings.display_order
      .map((key) => parseOrderItem(key))
      .filter((item): item is DisplayOrderItem => item != null),
    sensorDeviceIds
  );

  const staleAlertExcluded = Array.isArray(settings.stale_alert_excluded_devices)
    ? settings.stale_alert_excluded_devices
    : [];

  return {
    displayOrder,
    lifeCardOrder: normalizeLifeCardOrder(settings.life_card_order),
    chartColors: normalizeChartColors(settings.chart_colors),
    hiddenDeviceKeys: normalizeHiddenDeviceKeys(settings.hidden_devices, sensorDeviceIds),
    staleAlertExcludedKeys: new Set(staleAlertExcluded),
    pressureOffsets: settings.pressure_offsets ?? {},
    lightThresholds: settings.light_thresholds ?? {},
  };
}

export async function saveDisplayOrderToServer(order: DisplayOrderItem[]): Promise<void> {
  await updateUiSettings({ display_order: order.map(orderItemKey) });
}

export async function saveLifeCardOrderToServer(order: readonly string[]): Promise<void> {
  await updateUiSettings({ life_card_order: [...order] });
}

export async function saveChartColorsToServer(colors: ChartColorSettings): Promise<void> {
  await updateUiSettings({ chart_colors: colors });
}

export async function saveHiddenDevicesToServer(keys: Set<string>): Promise<void> {
  await updateUiSettings({ hidden_devices: [...keys] });
}

export async function saveStaleAlertExcludedToServer(keys: Set<string>): Promise<void> {
  await updateUiSettings({ stale_alert_excluded_devices: [...keys] });
}

export async function savePressureOffsetsToServer(
  offsets: Record<string, number>
): Promise<void> {
  await updateUiSettings({ pressure_offsets: offsets });
}

export async function saveLightThresholdsToServer(
  thresholds: Record<string, number>
): Promise<void> {
  await updateUiSettings({ light_thresholds: thresholds });
}

export function getDefaultUiSettings(sensorDeviceIds: readonly number[] = DASHBOARD_SENSOR_DEVICE_IDS) {
  return {
    displayOrder: buildDefaultDisplayOrder(sensorDeviceIds),
    lifeCardOrder: buildDefaultLifeCardOrder(),
    chartColors: buildDefaultChartColors(sensorDeviceIds),
    hiddenDeviceKeys: new Set<string>(),
    staleAlertExcludedKeys: new Set<string>(),
    pressureOffsets: {} as Record<string, number>,
    lightThresholds: {} as Record<string, number>,
  };
}
