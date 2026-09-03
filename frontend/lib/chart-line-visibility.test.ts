import { describe, expect, it, vi } from "vitest";
import {
  AIRCON_TARGET_VISIBILITY_KEY,
  buildDefaultChartLineVisibility,
  buildPanelChartLineVisibility,
  deviceDht11VisibilityKey,
  deviceMetricVisibilityKey,
  isChartLineVisible,
  getDisplayItemVisibilityKey,
  loadChartLineVisibility,
  mergeEffectiveChartLineVisibility,
  normalizeChartLineVisibility,
  outdoorMetricVisibilityKey,
  OUTDOOR_VISIBILITY_KEY,
  resolveEffectiveChartLineVisibility,
  saveChartLineVisibility,
  toggleChartLineVisibility,
} from "@/lib/chart-line-visibility";
import { AIRCON_CHART_DEVICE_ID } from "@/lib/types";

describe("chart-line-visibility", () => {
  it("builds defaults with all metric keys visible per device and outdoor metrics hidden", () => {
    const defaults = buildDefaultChartLineVisibility([1, 2]);

    expect(defaults[deviceMetricVisibilityKey(1, "temperature")]).toBe(true);
    expect(defaults[deviceMetricVisibilityKey(1, "humidity")]).toBe(true);
    expect(defaults[deviceMetricVisibilityKey(2, "temperature")]).toBe(true);
    expect(defaults[deviceMetricVisibilityKey(2, "humidity")]).toBe(true);
    expect(defaults[deviceDht11VisibilityKey(1)]).toBe(true);
    expect(defaults[outdoorMetricVisibilityKey("temperature")]).toBe(false);
    expect(defaults[outdoorMetricVisibilityKey("humidity")]).toBe(false);
    expect(defaults[AIRCON_TARGET_VISIBILITY_KEY]).toBe(true);
  });

  it("normalizes saved settings and keeps defaults for missing keys", () => {
    const normalized = normalizeChartLineVisibility(
      {
        [deviceMetricVisibilityKey(1, "temperature")]: false,
        [outdoorMetricVisibilityKey("temperature")]: true,
      },
      [1, 2]
    );

    expect(normalized[deviceMetricVisibilityKey(1, "temperature")]).toBe(false);
    expect(normalized[deviceMetricVisibilityKey(1, "humidity")]).toBe(true);
    expect(normalized[deviceMetricVisibilityKey(2, "temperature")]).toBe(true);
    expect(normalized[outdoorMetricVisibilityKey("temperature")]).toBe(true);
    expect(normalized[outdoorMetricVisibilityKey("humidity")]).toBe(false);
  });

  it("toggling outdoor temperature does not affect outdoor humidity", () => {
    const defaults = buildDefaultChartLineVisibility([1]);
    const tempKey = outdoorMetricVisibilityKey("temperature");
    const humKey = outdoorMetricVisibilityKey("humidity");
    const updated = toggleChartLineVisibility(defaults, tempKey);

    expect(isChartLineVisible(updated, tempKey)).toBe(true);
    expect(isChartLineVisible(updated, humKey)).toBe(false);
  });

  it("toggles visibility", () => {
    const defaults = buildDefaultChartLineVisibility([1]);
    const key = deviceMetricVisibilityKey(1, "temperature");
    const hidden = toggleChartLineVisibility(defaults, key);

    expect(isChartLineVisible(defaults, key)).toBe(true);
    expect(isChartLineVisible(hidden, key)).toBe(false);
  });

  it("toggling temperature does not affect humidity", () => {
    const defaults = buildDefaultChartLineVisibility([1]);
    const tempKey = deviceMetricVisibilityKey(1, "temperature");
    const humKey = deviceMetricVisibilityKey(1, "humidity");
    const updated = toggleChartLineVisibility(defaults, tempKey);

    expect(isChartLineVisible(updated, tempKey)).toBe(false);
    expect(isChartLineVisible(updated, humKey)).toBe(true);
  });

  it("loads and saves settings from localStorage", () => {
    const backing: Record<string, string> = {};
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => backing[key] ?? null,
        setItem: (key: string, value: string) => {
          backing[key] = value;
        },
        removeItem: (key: string) => {
          delete backing[key];
        },
      },
    });

    saveChartLineVisibility({
      [deviceMetricVisibilityKey(2, "temperature")]: false,
      [outdoorMetricVisibilityKey("temperature")]: true,
    });

    const loaded = loadChartLineVisibility([1, 2]);
    expect(loaded[deviceMetricVisibilityKey(1, "temperature")]).toBe(true);
    expect(loaded[deviceMetricVisibilityKey(2, "temperature")]).toBe(false);
    expect(loaded[outdoorMetricVisibilityKey("temperature")]).toBe(true);

    vi.unstubAllGlobals();
  });

  it("maps display order items to visibility keys", () => {
    expect(
      getDisplayItemVisibilityKey({ type: "device", deviceId: 2 })
    ).toBe("device:2");
    expect(getDisplayItemVisibilityKey({ type: "outdoor" })).toBe(
      OUTDOOR_VISIBILITY_KEY
    );
  });

  it("merges session overrides on top of defaults", () => {
    const defaults = buildDefaultChartLineVisibility([1]);
    const tempKey = deviceMetricVisibilityKey(1, "temperature");
    const outdoorTempKey = outdoorMetricVisibilityKey("temperature");
    const effective = mergeEffectiveChartLineVisibility(defaults, {
      [tempKey]: false,
      [outdoorTempKey]: true,
    });

    expect(resolveEffectiveChartLineVisibility(defaults, {}, tempKey)).toBe(
      true
    );
    expect(
      resolveEffectiveChartLineVisibility(defaults, { [tempKey]: false }, tempKey)
    ).toBe(false);
    expect(isChartLineVisible(effective, tempKey)).toBe(false);
    expect(isChartLineVisible(effective, outdoorTempKey)).toBe(true);
  });

  it("詳細パネルの強制表示より、パネル内の切り替えを優先する", () => {
    const defaults = buildDefaultChartLineVisibility([1]);
    const airconTempKey = deviceMetricVisibilityKey(AIRCON_CHART_DEVICE_ID, "temperature");
    // グローバルではエアコンの線も設定温度も隠している状態
    const base = {
      ...defaults,
      [airconTempKey]: false,
      [AIRCON_TARGET_VISIBILITY_KEY]: false,
    };
    const forcedKeys = [airconTempKey, AIRCON_TARGET_VISIBILITY_KEY];

    // 開いた直後は、グローバルの非表示に関わらず両方出す（#351）
    const opened = buildPanelChartLineVisibility(base, forcedKeys, {});
    expect(isChartLineVisible(opened, airconTempKey)).toBe(true);
    expect(isChartLineVisible(opened, AIRCON_TARGET_VISIBILITY_KEY)).toBe(true);

    // パネル内で設定温度を消したら、強制表示に戻されない（#357）
    const toggled = buildPanelChartLineVisibility(base, forcedKeys, {
      [AIRCON_TARGET_VISIBILITY_KEY]: false,
    });
    expect(isChartLineVisible(toggled, AIRCON_TARGET_VISIBILITY_KEY)).toBe(false);
    expect(isChartLineVisible(toggled, airconTempKey)).toBe(true);
  });

  it("詳細パネルの対象外のキーは元の設定のまま残す", () => {
    const defaults = buildDefaultChartLineVisibility([1]);
    const otherKey = deviceMetricVisibilityKey(1, "humidity");
    const base = { ...defaults, [otherKey]: false };
    const panel = buildPanelChartLineVisibility(base, [AIRCON_TARGET_VISIBILITY_KEY], {});

    expect(isChartLineVisible(panel, otherKey)).toBe(false);
  });
});
