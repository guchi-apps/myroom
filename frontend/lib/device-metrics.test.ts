import { describe, expect, it } from "vitest";
import {
  buildAirconReadings,
  buildIndoorReadings,
  buildOutdoorReadings,
  CARD_READING_LIMIT,
  formatMetricNumber,
  formatReading,
  pickCardReadings,
} from "@/lib/device-metrics";
import type { LatestData } from "@/lib/types";

const fullIndoor: LatestData = {
  device_id: 1,
  datetime: "2026-08-22 20:14:00",
  temperature: 24.62,
  humidity: 58.4,
  pressure: 1006.3,
  co2: 612,
  illuminance: 84.24,
};

describe("device-metrics", () => {
  it("屋内センサーの計測値を体感に近い順で並べる", () => {
    expect(buildIndoorReadings(fullIndoor).map((r) => r.metric)).toEqual([
      "temperature",
      "humidity",
      "pressure",
      "co2",
      "illuminance",
    ]);
  });

  it("値が無い指標は並びから落ちる", () => {
    expect(
      buildIndoorReadings({
        device_id: 1,
        datetime: "2026-08-22 20:14:00",
        temperature: 24.6,
        co2: 612,
      }).map((r) => r.metric)
    ).toEqual(["temperature", "co2"]);
  });

  it("データそのものが無ければ空になる", () => {
    expect(buildIndoorReadings(null)).toEqual([]);
    expect(buildOutdoorReadings(undefined)).toEqual([]);
  });

  it("カードへ出すのは先頭2つだけ", () => {
    const card = pickCardReadings(buildIndoorReadings(fullIndoor));
    expect(card).toHaveLength(CARD_READING_LIMIT);
    expect(card.map((r) => r.metric)).toEqual(["temperature", "humidity"]);
  });

  it("温度・湿度が無いセンサーでもカードが空にならない", () => {
    const card = pickCardReadings(
      buildIndoorReadings({
        device_id: 5,
        datetime: "2026-08-22 20:14:00",
        pressure: 1006.3,
        co2: 612,
      })
    );
    expect(card.map((r) => r.metric)).toEqual(["pressure", "co2"]);
  });

  it("屋外はCO2・照度を持たない", () => {
    expect(
      buildOutdoorReadings({
        device_id: 1,
        datetime: "2026-08-22 20:14:00",
        outdoor_temperature: 29.75,
        outdoor_humidity: 64,
        outdoor_pressure: 1005.4,
      }).map((r) => r.metric)
    ).toEqual(["temperature", "humidity", "pressure"]);
  });

  it("エアコンは室温だけを返す", () => {
    expect(buildAirconReadings(24.83)).toEqual([
      { metric: "temperature", label: "温度", text: "24.8", unit: "°C" },
    ]);
    expect(buildAirconReadings(null)).toEqual([]);
  });

  it("指標ごとの丸め方", () => {
    expect(formatMetricNumber("temperature", 24.62)).toBe("24.6");
    expect(formatMetricNumber("humidity", 58.4)).toBe("58");
    expect(formatMetricNumber("pressure", 1006.3)).toBe("1006");
    expect(formatMetricNumber("co2", 612.7)).toBe("613");
    expect(formatMetricNumber("illuminance", 84.24)).toBe("84.2");
    expect(formatMetricNumber("illuminance", 1250.4)).toBe("1250");
  });

  it("単位の空白は °C と % だけ詰める", () => {
    const [temp, humid, pressure] = buildIndoorReadings(fullIndoor);
    expect(formatReading(temp)).toBe("24.6°C");
    expect(formatReading(humid)).toBe("58%");
    expect(formatReading(pressure)).toBe("1006 hPa");
  });
});
