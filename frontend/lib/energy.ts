import { CHART_COLOR_PALETTE } from "@/lib/chart-colors";
import type {
  EnergyBreakdown,
  EnergyBreakdownDay,
  EnergyHourly,
  EnergySourceRow,
  EnergyTotal,
} from "@/lib/types";

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
  summary: {
    this_month: EnergyTotal;
    last_month_to_date: EnergyTotal;
  } | null
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

/** 日別の並びに要るのはこの2つだけ。取得元1つの集計にも家全体の集計にも使う */
interface DailyLike {
  date: string;
  kwh: number | null;
}

/** 詳細パネルの日別一覧。新しい日が上に来るように並べ替える */
export function buildEnergyDailyRows<T extends DailyLike>(daily: readonly T[]): T[] {
  return [...daily].reverse();
}

/** 日別一覧の棒の長さ（期間内の最大値で正規化） */
export function energyRowRatio(rows: readonly DailyLike[], day: DailyLike): number {
  const max = Math.max(...rows.map((row) => row.kwh ?? 0), 0);
  if (max <= 0) return 0;
  return (day.kwh ?? 0) / max;
}

/**
 * 収集が止まっているか。当日ぶんは日中まだ届かないことがあるため、
 * 「昨日ぶんも無い」ときだけ止まっていると見なす。
 */
export function isEnergyStale(
  summary: { latest_date: string | null } | null,
  todayIso: string
): boolean {
  if (!summary || !summary.latest_date) return false;
  const yesterday = new Date(`${todayIso}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return summary.latest_date < yesterday.toISOString().slice(0, 10);
}

export function hasEnergyData(
  summary: { daily: readonly unknown[] } | null
): boolean {
  return Boolean(summary && summary.daily.length > 0);
}

// ------------------------------------------------------------ 取得元ごとの色と積み上げ
//
// 消費電力カードはエアコンとスマートプラグを1枚に並べるため、取得元ごとに色が要る。
// センサーのグラフと同じ配色（CHART_COLOR_PALETTE）から採り、画面をまたいで
// 同じ色が同じものを指すようにする。

/** エアコンの色。センサーのグラフで室温に使っているものと同じ */
export const AIRCON_ENERGY_COLOR = "#1abc9c";

/** プラグに割り当てる色。エアコンの色とは重ねない */
const PLUG_COLOR_PALETTE = CHART_COLOR_PALETTE.filter(
  (color) => color !== AIRCON_ENERGY_COLOR
);

export const AIRCON_ENERGY_SOURCE = "aircon";

/**
 * 取得元 → 色。エアコンは固定で、それ以外は `sources` の並び順に配色する。
 *
 * 並び順はサーバーが「エアコン → 今月の使用量が多い順」で決めているため、
 * 機器を足しても既存の機器の色は変わらない……とは限らない（使用量で順が入れ替わる）。
 * 色は凡例と同時に出るので、入れ替わっても読めなくはならない。
 */
export function buildEnergySourceColors(
  sources: readonly EnergySourceRow[]
): Record<string, string> {
  const colors: Record<string, string> = {};
  let plugIndex = 0;
  for (const row of sources) {
    if (row.source === AIRCON_ENERGY_SOURCE) {
      colors[row.source] = AIRCON_ENERGY_COLOR;
      continue;
    }
    colors[row.source] = PLUG_COLOR_PALETTE[plugIndex % PLUG_COLOR_PALETTE.length];
    plugIndex += 1;
  }
  return colors;
}

export interface EnergyStackSegment {
  source: string;
  label: string;
  kwh: number;
  /** その日の合計に対する割合（0〜1） */
  share: number;
  color: string;
}

/** 1日ぶんを取得元ごとのセグメントへ。値の無い取得元は入れない */
export function buildEnergyStackSegments(
  day: EnergyBreakdownDay,
  sources: readonly EnergySourceRow[],
  colors: Record<string, string>
): EnergyStackSegment[] {
  const total = sources.reduce(
    (sum, row) => sum + (day.by_source[row.source] ?? 0),
    0
  );
  if (total <= 0) return [];

  return sources
    .map((row) => ({
      source: row.source,
      label: row.label,
      kwh: day.by_source[row.source] ?? 0,
      share: (day.by_source[row.source] ?? 0) / total,
      color: colors[row.source] ?? "#95a5a6",
    }))
    .filter((segment) => segment.kwh > 0);
}

export interface EnergyStackColumn {
  date: string;
  kwh: number;
  /** 期間内の最大値を 1 とした高さの比 */
  ratio: number;
  segments: EnergyStackSegment[];
}

/**
 * 詳細パネルの積み上げ棒グラフ。
 *
 * **記録の無い日は棒そのものを作らない。** 0 kWh として描くと「その日は使っていない」に
 * 見えるが、実際には収集が止まっていただけのことがある（プラグは停電明けに黙る）。
 */
export function buildEnergyStackColumns(
  breakdown: EnergyBreakdown | null
): EnergyStackColumn[] {
  if (!breakdown) return [];
  const colors = buildEnergySourceColors(breakdown.sources);
  const max = Math.max(...breakdown.daily.map((day) => day.kwh), 0);

  return breakdown.daily
    .filter((day) => day.kwh > 0)
    .map((day) => ({
      date: day.date,
      kwh: day.kwh,
      ratio: max > 0 ? day.kwh / max : 0,
      segments: buildEnergyStackSegments(day, breakdown.sources, colors),
    }));
}

/** いまの消費電力。返さない取得元（エアコン）は「—」 */
export function formatWatts(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value)} W`;
}

/** カードの行に出す棒の長さ。その日いちばん使った取得元を 1 とする */
export function energySourceRatio(
  sources: readonly EnergySourceRow[],
  row: EnergySourceRow
): number {
  const max = Math.max(...sources.map((item) => item.today_kwh ?? 0), 0);
  if (max <= 0) return 0;
  return (row.today_kwh ?? 0) / max;
}

// ------------------------------------------------------------ 時間ごと（#300）

/**
 * `date` を `days` 日ずらす。UTC正午を基準に計算し、タイムゾーンによる日またぎのずれを避ける
 * （`frontend/lib/cleaning.ts` の `shiftDate` と同じ考え方。日付文字列を扱う場所ごとに持つ）。
 */
export function shiftEnergyDate(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export interface EnergyHourlySegment {
  source: string;
  label: string;
  kwh: number;
  /** その時間帯の合計に対する割合（0〜1） */
  share: number;
  color: string;
}

export interface EnergyHourlyColumn {
  hour: number;
  /** `null` はまだ記録が無い時間帯（未来、または記録を始める前の日） */
  kwh: number | null;
  /** その日の最大値を 1 とした高さの比 */
  ratio: number;
  segments: EnergyHourlySegment[];
}

/**
 * 詳細パネル「時間ごと」の積み上げ棒グラフ。
 *
 * ラベルは`EnergyHourly`自体は持たないため、同じ画面で先に取っている`breakdown.sources`
 * （日別の集計）の`label`をそのまま使い回す。取得元が増えても正が2か所に分かれないようにするため。
 */
export function buildEnergyHourlyColumns(
  hourly: EnergyHourly | null,
  sources: readonly EnergySourceRow[],
  colors: Record<string, string>
): EnergyHourlyColumn[] {
  if (!hourly) return [];
  const labels = new Map(sources.map((row) => [row.source, row.label]));
  const max = Math.max(...hourly.hours.map((row) => row.kwh ?? 0), 0);

  return hourly.hours.map((row) => {
    const total = row.kwh ?? 0;
    const segments: EnergyHourlySegment[] =
      row.kwh == null
        ? []
        : Object.entries(row.by_source)
            .filter(([, kwh]) => kwh > 0)
            .map(([source, kwh]) => ({
              source,
              label: labels.get(source) ?? source,
              kwh,
              share: total > 0 ? kwh / total : 0,
              color: colors[source] ?? "#95a5a6",
            }));

    return {
      hour: row.hour,
      kwh: row.kwh,
      ratio: row.kwh != null && max > 0 ? row.kwh / max : 0,
      segments,
    };
  });
}

/** `7` → `7時` */
export function formatEnergyHour(hour: number): string {
  return `${hour}時`;
}
