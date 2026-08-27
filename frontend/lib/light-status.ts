import { formatMetricNumber, METRIC_UNIT_SUFFIX } from "@/lib/device-metrics";
import type { LatestData } from "@/lib/types";

/**
 * 照度から「照明がついているか」を判定する（#258）。
 *
 * リビングのセンサーは照度を送ってくるので、しきい値と比べるだけで点灯・消灯を出せる。
 * しきい値は部屋の作りで妥当な値が変わるため既定値を置かず、`/devices` で設定した
 * デバイスだけが判定の対象になる。設定していないデバイスの見た目は変わらない。
 *
 * **昼間の日射では消灯していても数百 lx になる。** 時間帯や屋外の明るさは見ていないので、
 * しきい値の当て方次第で日中は「点灯」と出る。判定の根拠（いまの照度としきい値）を
 * 画面へ併記しているのは、ずれに気づいて設定を直せるようにするため。
 */

export type LightStatus = "on" | "off";

export interface LightStatusResult {
  status: LightStatus;
  /** 判定に使った照度（lx） */
  illuminance: number;
  /** 判定に使ったしきい値（lx） */
  threshold: number;
}

export const LIGHT_STATUS_LABELS: Record<LightStatus, string> = {
  on: "点灯",
  off: "消灯",
};

/** 詳細パネルに出す一行。「照明は点灯中」「照明は消灯中」 */
export const LIGHT_STATUS_HEADLINES: Record<LightStatus, string> = {
  on: "照明は点灯中",
  off: "照明は消灯中",
};

/**
 * デバイスに設定されたしきい値。未設定・0以下は「判定しない」として `null` を返す。
 * バックエンドが正規化済みの値を返すが、オフラインキャッシュや古い保存値も通るためここでも見る。
 */
export function getLightThreshold(
  thresholds: Record<string, number> | null | undefined,
  deviceId: number
): number | null {
  const raw = thresholds?.[String(deviceId)];
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

/**
 * 照度としきい値から点灯・消灯を決める。
 * 照度が届いていなければ判定せず `null`（「消灯」とは書かない）。
 */
export function resolveLightStatus(
  illuminance: number | null | undefined,
  threshold: number | null | undefined
): LightStatusResult | null {
  if (threshold == null || !Number.isFinite(threshold) || threshold <= 0) return null;
  if (illuminance == null || !Number.isFinite(illuminance)) return null;
  return {
    status: illuminance >= threshold ? "on" : "off",
    illuminance,
    threshold,
  };
}

/** 最新データとUI設定から、そのデバイスの照明の状態を出す */
export function resolveDeviceLightStatus(
  data: LatestData | null | undefined,
  thresholds: Record<string, number> | null | undefined,
  deviceId: number
): LightStatusResult | null {
  return resolveLightStatus(data?.illuminance, getLightThreshold(thresholds, deviceId));
}

/**
 * しきい値の表示。利用者が `/devices` で入力した値なので、`formatMetricNumber` の
 * 「100lx未満は小数1桁」を当てると `80` が `80.0` になって入力と食い違う。
 * 整数ならそのまま、小数が入っているときだけ1桁まで出す。
 */
export function formatLightThreshold(threshold: number): string {
  return Number.isInteger(threshold) ? String(threshold) : threshold.toFixed(1);
}

/**
 * 詳細パネルに出す根拠。「しきい値 80 lx を上回っています」。
 *
 * すぐ上の「いまの値」に照度のセルが出ているので、ここで照度をもう一度書くと同じ数字を
 * 2回言うことになる。しきい値と、それを上回ったか下回ったかだけを添える。
 */
export function formatLightThresholdNote(result: LightStatusResult): string {
  const unit = METRIC_UNIT_SUFFIX.illuminance;
  const threshold = formatLightThreshold(result.threshold);
  const direction = result.status === "on" ? "上回っています" : "下回っています";
  return `しきい値 ${threshold} ${unit} を${direction}`;
}

/**
 * カードのバッジに添える説明。カードは温度・湿度しか出さないため、ここでは照度も併記する。
 * 「照度 312 lx ・ しきい値 80 lx」
 */
export function formatLightStatusDetail(result: LightStatusResult): string {
  const unit = METRIC_UNIT_SUFFIX.illuminance;
  const now = formatMetricNumber("illuminance", result.illuminance);
  const threshold = formatLightThreshold(result.threshold);
  return `照度 ${now} ${unit} ・ しきい値 ${threshold} ${unit}`;
}
