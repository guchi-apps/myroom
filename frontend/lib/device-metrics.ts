import {
  METRIC_LABELS,
  type ChartMetric,
  type LatestData,
} from "@/lib/types";

/**
 * センサーの「いまの値」を組み立てる。
 *
 * ダッシュボードのカードと、デバイス・屋外の詳細パネルで同じ数字・同じ書式を使うために
 * ここへ集約する。**カードに出すのは先頭2つだけ**（`pickCardReadings`）で、残りは詳細
 * パネルの「いまの値」に出る。センサーだけのアプリだった頃は5つ全部をカードへ縦に並べて
 * いたが、暮らしのカードが増えた今はカードの高さがそのぶん画面を食う（#226）。
 */

/**
 * 並び順は「体感に近い順」。カードへ出す2つは必ずこの先頭から取るため、
 * 温度・湿度を持つセンサーでは温度・湿度になる。
 */
export const METRIC_PRIORITY: readonly ChartMetric[] = [
  "temperature",
  "humidity",
  "pressure",
  "co2",
  "illuminance",
];

/** カードに出す計測値の数 */
export const CARD_READING_LIMIT = 2;

export interface MetricReading {
  metric: ChartMetric;
  /** 「温度」「湿度」など */
  label: string;
  /** 単位を含まない数値の文字列（例: `24.6`） */
  text: string;
  /** 単位（例: `°C`）。数値と単位のあいだに空白は含めない */
  unit: string;
}

/** 指標ごとの丸め方。桁数はカードでも詳細パネルでも同じにする */
export function formatMetricNumber(metric: ChartMetric, value: number): string {
  switch (metric) {
    case "temperature":
      return value.toFixed(1);
    case "humidity":
      return String(Math.round(value));
    case "pressure":
    case "co2":
      return String(Math.round(value));
    case "illuminance":
      // 明るい場所では小数が意味を持たないので整数へ寄せる
      return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  }
}

export const METRIC_UNIT_SUFFIX: Record<ChartMetric, string> = {
  temperature: "°C",
  humidity: "%",
  pressure: "hPa",
  co2: "ppm",
  illuminance: "lx",
};

function buildReadings(
  values: Partial<Record<ChartMetric, number | null | undefined>>
): MetricReading[] {
  const readings: MetricReading[] = [];
  for (const metric of METRIC_PRIORITY) {
    const value = values[metric];
    if (value == null || !Number.isFinite(value)) continue;
    readings.push({
      metric,
      label: METRIC_LABELS[metric],
      text: formatMetricNumber(metric, value),
      unit: METRIC_UNIT_SUFFIX[metric],
    });
  }
  return readings;
}

/** 屋内センサーの計測値。取れているものだけが `METRIC_PRIORITY` の順で並ぶ */
export function buildIndoorReadings(
  data: LatestData | null | undefined
): MetricReading[] {
  if (!data) return [];
  return buildReadings({
    temperature: data.temperature,
    humidity: data.humidity,
    pressure: data.pressure,
    co2: data.co2,
    illuminance: data.illuminance,
  });
}

/** 屋外（Open-Meteo）の計測値。CO2・照度は取得元が返さない */
export function buildOutdoorReadings(
  data: LatestData | null | undefined
): MetricReading[] {
  if (!data) return [];
  return buildReadings({
    temperature: data.outdoor_temperature,
    humidity: data.outdoor_humidity,
    pressure: data.outdoor_pressure,
  });
}

/** エアコンの計測値。カードに出すのは室温だけで、運転モードと設定温度はバッジが受け持つ */
export function buildAirconReadings(
  roomTemperature: number | null | undefined
): MetricReading[] {
  return buildReadings({ temperature: roomTemperature });
}

/**
 * カードへ出す先頭2つ。温度・湿度を持たないセンサーでも空にならないよう、
 * 取れている計測値の先頭から詰める。
 */
export function pickCardReadings(
  readings: readonly MetricReading[]
): MetricReading[] {
  return readings.slice(0, CARD_READING_LIMIT);
}

/** 数値と単位をつなげた表示（例: `24.6°C`・`1006 hPa`） */
export function formatReading(reading: MetricReading): string {
  const separator = reading.unit === "°C" || reading.unit === "%" ? "" : " ";
  return `${reading.text}${separator}${reading.unit}`;
}
