import type { CleanerRun, CleanerSummary } from "@/lib/types";

/**
 * お掃除ロボットカードの表示計算。
 *
 * **日時は文字列のまま組み立て、`Date` のタイムゾーン変換に通さない。** サーバーは
 * オフセットを持たない JST の日時（`2026-08-22T14:32:00`）を返すので、端末の時計が
 * どこの地域でも同じ表示になるようにしている（消費電力カードと同じ方針）。
 */

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 掃除している状態。バッジの色を変える判定に使う */
export const CLEANER_EVENT_CLEANING = "cleaning";

interface ParsedDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** `2026-08-22T14:32:00` を数値へ。読めなければ null */
export function parseCleanerDateTime(value: string | null): ParsedDateTime | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
}

function isSameDay(a: ParsedDateTime, b: ParsedDateTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function formatTime(value: ParsedDateTime): string {
  return `${value.hour}:${String(value.minute).padStart(2, "0")}`;
}

/**
 * カードの主役。`今日 14:32` / `昨日 9:05` / `8/20 9:05`。
 * 「いま」はサーバーが返した `now` を使う（端末の時計に寄せない）。
 */
export function formatRunStart(startedAt: string, now: string): string {
  const start = parseCleanerDateTime(startedAt);
  const current = parseCleanerDateTime(now);
  if (!start) return startedAt;
  if (current) {
    if (isSameDay(start, current)) return `今日 ${formatTime(start)}`;
    const yesterday = new Date(
      Date.UTC(current.year, current.month - 1, current.day - 1)
    );
    if (
      start.year === yesterday.getUTCFullYear() &&
      start.month === yesterday.getUTCMonth() + 1 &&
      start.day === yesterday.getUTCDate()
    ) {
      return `昨日 ${formatTime(start)}`;
    }
  }
  return `${start.month}/${start.day} ${formatTime(start)}`;
}

/** 履歴の行の左。`8/22 (金)` */
export function formatRunDay(startedAt: string): string {
  const start = parseCleanerDateTime(startedAt);
  if (!start) return startedAt;
  const weekday =
    WEEKDAY_LABELS[
      new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay()
    ];
  return `${start.month}/${start.day} (${weekday})`;
}

/** 履歴の行の時刻。`14:32` */
export function formatRunTime(startedAt: string): string {
  const start = parseCleanerDateTime(startedAt);
  return start ? formatTime(start) : startedAt;
}

/** `32分` / `1時間5分`。1時間を超える掃除もあるため分だけにはしない */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded}分`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}

/** 動いている最中は「経過」と分かるようにする */
export function formatRunDuration(run: CleanerRun): string {
  return run.running ? `${formatMinutes(run.duration_minutes)}経過` : formatMinutes(run.duration_minutes);
}

/** 履歴の横棒の長さ。並んでいる中でいちばん長い稼働を1とした比 */
export function runRatio(runs: readonly CleanerRun[], run: CleanerRun): number {
  const longest = runs.reduce(
    (max, item) => Math.max(max, item.duration_minutes),
    0
  );
  if (longest <= 0) return 0;
  return Math.min(1, Math.max(0.06, run.duration_minutes / longest));
}

/** カードに出せる中身があるか。1度も受け取っていなければ案内文だけを出す */
export function hasCleanerData(
  summary: CleanerSummary | null | undefined
): summary is CleanerSummary {
  return Boolean(summary && (summary.current || summary.last_run));
}

/** いま掃除している最中か */
export function isCleaning(summary: CleanerSummary | null | undefined): boolean {
  return summary?.current?.event === CLEANER_EVENT_CLEANING;
}

/** 「今月 12回 ・ 平均 34分」。1回も動いていない月は回数だけ出す */
export function formatMonthlyRuns(summary: CleanerSummary): string {
  const { count, average_minutes } = summary.this_month;
  if (count === 0) return "今月はまだ動いていません";
  if (average_minutes == null) return `今月 ${count}回`;
  return `今月 ${count}回 ・ 平均 ${formatMinutes(average_minutes)}`;
}
