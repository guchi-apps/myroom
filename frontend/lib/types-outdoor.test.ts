import { describe, expect, it } from "vitest";
import {
  formatOutdoorApiLabel,
  outdoorLocationWeatherFromLatest,
  pickOutdoorLatestSource,
  resolveOutdoorBatchLoadStatus,
  resolveOutdoorLocationLoadStatus,
  type LatestData,
  type OutdoorLocationEntry,
} from "@/lib/types";

describe("formatOutdoorApiLabel", () => {
  it("returns the bare location name without the old '地点データ(...)' wrapper", () => {
    expect(formatOutdoorApiLabel("茨木市")).toBe("茨木市");
    expect(formatOutdoorApiLabel("  実家  ")).toBe("実家");
  });

  it("falls back to a placeholder when no name is set", () => {
    expect(formatOutdoorApiLabel(undefined)).toBe("地点未登録");
    expect(formatOutdoorApiLabel(null)).toBe("地点未登録");
    expect(formatOutdoorApiLabel("")).toBe("地点未登録");
  });
});

describe("outdoor latest helpers", () => {
  it("uses outdoor values from any visible device when primary device lacks them", () => {
    const latestByDevice: Record<number, LatestData | null> = {
      1: { device_id: 1, temperature: 24.0 },
      2: {
        device_id: 2,
        temperature: 26.0,
        outdoor_temperature: 28.1,
        outdoor_humidity: 62,
      },
    };

    expect(pickOutdoorLatestSource(latestByDevice)?.outdoor_temperature).toBe(28.1);
    expect(
      resolveOutdoorBatchLoadStatus(latestByDevice, { 1: "ok", 2: "ok" })
    ).toBe("ok");
  });

  it("reports empty when no device has outdoor values", () => {
    const latestByDevice: Record<number, LatestData | null> = {
      2: { device_id: 2, temperature: 26.0 },
    };

    expect(pickOutdoorLatestSource(latestByDevice)).toBeNull();
    expect(
      resolveOutdoorBatchLoadStatus(latestByDevice, { 2: "ok" })
    ).toBe("empty");
  });
});

describe("地点ごとの屋外カード（#321）", () => {
  const tokyo: OutdoorLocationEntry = {
    id: "tokyo",
    name: "東京",
    latitude: 35.6895,
    longitude: 139.6917,
    is_primary: true,
  };

  it("基準地点は /api/latest の値からカード用の天気を組み立てられる", () => {
    const weather = outdoorLocationWeatherFromLatest(tokyo, {
      device_id: 1,
      outdoor_temperature: 29.8,
      outdoor_humidity: 62,
      outdoor_weather_label: "晴れ",
      outdoor_weather_icon: "sun",
    });

    expect(weather?.id).toBe("tokyo");
    expect(weather?.temperature).toBe(29.8);
    expect(weather?.weather_label).toBe("晴れ");
  });

  it("屋外の値が無ければ組み立てない", () => {
    expect(
      outdoorLocationWeatherFromLatest(tokyo, { device_id: 1, temperature: 24 })
    ).toBeNull();
  });

  it("取得に失敗したときだけエラー、値が無いだけなら空として扱う", () => {
    expect(resolveOutdoorLocationLoadStatus(null, false)).toBe("empty");
    expect(resolveOutdoorLocationLoadStatus(null, true)).toBe("error");
    expect(
      resolveOutdoorLocationLoadStatus(
        {
          id: "osaka",
          name: "大阪",
          temperature: 31.2,
          humidity: null,
          pressure: null,
          weather_code: null,
          weather_label: null,
          weather_icon: null,
          observed_at: null,
        },
        true
      )
    ).toBe("ok");
  });
});
