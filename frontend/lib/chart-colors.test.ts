import { describe, expect, it } from "vitest";
import {
  AIRCON_TARGET_COLOR_KEY,
  buildDefaultChartColors,
  deviceColorKey,
  getAirconTargetChartColor,
  getChartColorConfigItems,
  getDeviceChartColor,
  normalizeChartColors,
  OUTDOOR_COLOR_KEY,
} from "@/lib/chart-colors";
import { AIRCON_CHART_DEVICE_ID } from "@/lib/types";

describe("chart-colors", () => {
  it("builds defaults for all series", () => {
    const defaults = buildDefaultChartColors();
    expect(defaults[deviceColorKey(1)]).toBe("#3498db");
    expect(defaults[deviceColorKey(2)]).toBe("#e67e22");
    expect(defaults[deviceColorKey(AIRCON_CHART_DEVICE_ID)]).toBe("#1abc9c");
    expect(defaults[AIRCON_TARGET_COLOR_KEY]).toBe("#9b59b6");
    expect(defaults[OUTDOOR_COLOR_KEY]).toBe("#adb5bd");
  });

  it("normalizes saved colors and keeps unknown keys with valid hex", () => {
    const normalized = normalizeChartColors({
      [deviceColorKey(1)]: "#e74c3c",
      [AIRCON_TARGET_COLOR_KEY]: "#ff5722",
      unknown: "#123456",
    });

    expect(normalized[deviceColorKey(1)]).toBe("#e74c3c");
    expect(normalized[AIRCON_TARGET_COLOR_KEY]).toBe("#ff5722");
    expect(normalized[deviceColorKey(2)]).toBe("#e67e22");
    expect(normalized.unknown).toBe("#123456");
  });

  it("lists config items including separate aircon room and target", () => {
    const items = getChartColorConfigItems(
      { 1: "リビング", 2: "寝室", 4: "書斎", [AIRCON_CHART_DEVICE_ID]: "寝室エアコン" },
      "外気",
      "寝室エアコン",
      [1, 2, 4]
    );

    expect(items.map((item) => item.label)).toEqual([
      "リビング",
      "寝室",
      "書斎",
      "寝室エアコン（室温）",
      "寝室エアコン（設定温度）",
      "外気",
    ]);
  });

  it("resolves device and target colors from settings", () => {
    const colors = buildDefaultChartColors();
    colors[AIRCON_TARGET_COLOR_KEY] = "#ff4081";

    expect(getDeviceChartColor(colors, AIRCON_CHART_DEVICE_ID)).toBe("#1abc9c");
    expect(getAirconTargetChartColor(colors)).toBe("#ff4081");
  });
});
