import type { EnergyDay, EnergySummary } from "@/lib/types";

/** 電気を表すアンバー。温度・湿度・CO2 の色とは重ねない（globals.css の --energy-color と対） */
export const ENERGY_ACCENT_VAR = "var(--energy-color)";

/** カードの棒グラフに出す日数 */
export const ENERGY_SPARKLINE_DAYS = 14;

export function formatYen(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

export function formatKwh(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} kWh`;
}

/** `2026-08-22` → `8/22` */
export function formatEnergyDate(date: string): string {
  const [, month, day] = date.split("-");
  if (!month || !day) return date;
  return `${Number(month)}/${Number(day)}`;
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** `2026-08-22` → `8/22（金）`。日付文字列だけで組み立て、タイムゾーンに寄らせない */
export function formatEnergyDateWithWeekday(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}（${weekday}）`;
}

export interface EnergyComparison {
  /** 今月が先月の同じ時期より少なければ true */
  cheaper: boolean;
  /** 差の割合（%、絶対値） */
  percent: number;
  /** 比較対象の金額 */
  baseCostYen: number;
}

/**
 * 今月ぶんを「先月の同じ日まで」と比べる。
 * 月をまたいだ直後や先月ぶんが無いときは比較そのものを出さない（null）。
 */
export function buildEnergyComparison(
  summary: EnergySummary | null
): EnergyComparison | null {
  if (!summary) return null;
  const base = summary.last_month_to_date;
  const current = summary.this_month;
  if (!base || !current) return null;
  if (base.days === 0 || base.cost_yen <= 0) return null;
  if (current.days === 0) return null;

  const diff = current.cost_yen - base.cost_yen;
  return {
    cheaper: diff <= 0,
    percent: Math.round((Math.abs(diff) / base.cost_yen) * 100),
    baseCostYen: base.cost_yen,
  };
}

export interface EnergySparkBar {
  date: string;
  kwh: number;
  /** 期間内の最大値を 1 とした高さの比 */
  ratio: number;
  isLast: boolean;
}

/** カード下部の棒グラフ。直近 `days` 日ぶんを、期間内の最大値で正規化して返す */
export function buildEnergySparkline(
  daily: readonly EnergyDay[],
  days: number = ENERGY_SPARKLINE_DAYS
): EnergySparkBar[] {
  const recent = daily.slice(-days).filter((day) => day.kwh != null);
  if (recent.length === 0) return [];

  const max = Math.max(...recent.map((day) => day.kwh ?? 0));
  return recent.map((day, index) => ({
    date: day.date,
    kwh: day.kwh ?? 0,
    ratio: max > 0 ? (day.kwh ?? 0) / max : 0,
    isLast: index === recent.length - 1,
  }));
}

/** 詳細パネルの日別一覧。新しい日が上に来るように並べ替える */
export function buildEnergyDailyRows(summary: EnergySummary | null): EnergyDay[] {
  if (!summary) return [];
  return [...summary.daily].reverse();
}

/** 日別一覧の棒の長さ（期間内の最大値で正規化） */
export function energyRowRatio(rows: readonly EnergyDay[], day: EnergyDay): number {
  const max = Math.max(...rows.map((row) => row.kwh ?? 0), 0);
  if (max <= 0) return 0;
  return (day.kwh ?? 0) / max;
}

/**
 * 収集が止まっているか。当日ぶんは日中まだ届かないことがあるため、
 * 「昨日ぶんも無い」ときだけ止まっていると見なす。
 */
export function isEnergyStale(
  summary: EnergySummary | null,
  todayIso: string
): boolean {
  if (!summary || !summary.latest_date) return false;
  const yesterday = new Date(`${todayIso}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return summary.latest_date < yesterday.toISOString().slice(0, 10);
}

export function hasEnergyData(summary: EnergySummary | null): boolean {
  return Boolean(summary && summary.daily.length > 0);
}
