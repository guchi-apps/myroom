/**
 * 掃除カードの表示ロジック。
 *
 * 「次にやる日」の計算そのものはバックエンド（`backend/cleaning.py`）が済ませて
 * `next_due` / `days_until` / `status` として返す。ここでやるのは並べ替えと言葉づかいだけ。
 * 日付の計算をブラウザ側でやり直すと、端末の時計とサーバー（JST）でずれる。
 */

/** 掃除の状態。overdue=期限を過ぎた / today=今日が期限 / upcoming=まだ先 */
export type CleaningStatus = "overdue" | "today" | "upcoming";

/**
 * 実施履歴の1件。
 *
 * **掃除した日（date）とアプリへ登録した日時（recorded_at）は別の値**（#294）。
 * 予定の計算・一覧・最終掃除日はすべて date を見る。recorded_at は「いつ入力したか」を
 * 後から辿るためだけに持ち、`date` の文字列だけで保存されていた古い記録では null になる。
 */
export interface CleaningHistoryEntry {
  /** 掃除した日（YYYY-MM-DD） */
  date: string;
  /** アプリへ登録した日時（ISO8601・JST）。古い記録では null */
  recorded_at: string | null;
}

export interface CleaningTask {
  id: string;
  name: string;
  /** 何日に1回やるか */
  interval_days: number;
  /** やることの手順。空でもよい */
  steps: string[];
  /** 実施履歴。掃除した日の新しい順。最大10件 */
  history: CleaningHistoryEntry[];
  /** 最後にやった日。一度もやっていなければ null */
  last_done: string | null;
  next_due: string;
  /** 次にやる日まであと何日か。マイナスは遅れている日数 */
  days_until: number;
  status: CleaningStatus;
}

export interface CleaningSchedule {
  /** サーバー（JST）の今日。端末の時計は使わない */
  today: string;
  /** 掃除が1件でも登録されているか */
  configured: boolean;
  tasks: CleaningTask[];
}

/** 画面から保存するときに送る形。実施履歴はサーバー側で引き継がれる */
export interface CleaningTaskInput {
  id?: string;
  name: string;
  interval_days: number;
  steps: string[];
}

export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 365;

/** 項目シートに出す実施履歴の件数。これ以上は間隔を見直すときにしか要らない */
export const VISIBLE_HISTORY_COUNT = 3;

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-08-26" -> "8/26"。タイムゾーンに左右されないよう文字列のまま組み立てる */
export function formatCleaningDate(date: string): string {
  const [, month, day] = date.split("-");
  if (!month || !day) return date;
  return `${Number(month)}/${Number(day)}`;
}

/** "2026-08-26" -> "8/26(水)"。曜日は UTC 正午で数えて日付ずれを避ける */
export function formatCleaningDateWithWeekday(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return formatCleaningDate(date);
  return `${formatCleaningDate(date)}(${WEEKDAY_LABELS[parsed.getUTCDay()]})`;
}

/** 期限までの距離を言葉にする。遅れているときは何日遅れかを出す */
export function formatCleaningCountdown(task: CleaningTask): string {
  if (task.days_until < 0) return `${-task.days_until}日遅れ`;
  if (task.days_until === 0) return "今日";
  if (task.days_until === 1) return "明日";
  return `あと${task.days_until}日`;
}

/** "3日に1回" のような言い方。1日ごとだけ「毎日」にする */
export function formatCleaningInterval(intervalDays: number): string {
  return intervalDays === 1 ? "毎日" : `${intervalDays}日に1回`;
}

/** 一覧の各行に添える短い表記 */
export function formatCleaningIntervalShort(intervalDays: number): string {
  return intervalDays === 1 ? "毎日" : `${intervalDays}日ごと`;
}

/**
 * 最後にやった日からの経過。カード上部ではなく項目シートに出す。
 * サーバーが返す today を基準にする（端末の時計は使わない）。
 */
export function formatLastDone(task: CleaningTask, today: string): string {
  if (!task.last_done) return "まだ記録がありません";
  const days = diffDays(task.last_done, today);
  if (days === null) return formatCleaningDateWithWeekday(task.last_done);
  const suffix = days <= 0 ? "今日" : days === 1 ? "昨日" : `${days}日前`;
  return `${formatCleaningDateWithWeekday(task.last_done)}（${suffix}）`;
}

/** 実施履歴の1行に添える「◯日前」 */
export function formatHistoryAge(date: string, today: string): string {
  const days = diffDays(date, today);
  if (days === null) return "";
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  return `${days}日前`;
}

function diffDays(from: string, to: string): number | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

/**
 * カード先頭の「今日やること」。期限を過ぎたものと今日が期限のものだけを、
 * 遅れが大きい順に並べる。1件も無ければ空配列を返し、カードはブロックごと出さない。
 */
export function buildCleaningTodo(schedule: CleaningSchedule): CleaningTask[] {
  return schedule.tasks
    .filter((task) => task.status !== "upcoming")
    .sort((a, b) => a.days_until - b.days_until);
}

/**
 * 一覧の並び。保存された順ではなく「次にやる日が近い順」にする。
 * 同じ日なら名前順にして、押すたびに行が入れ替わらないようにする。
 */
export function buildCleaningRows(schedule: CleaningSchedule): CleaningTask[] {
  return [...schedule.tasks].sort(
    (a, b) => a.days_until - b.days_until || a.name.localeCompare(b.name, "ja")
  );
}

/** 項目シートに出す直近の実施履歴 */
export function visibleHistory(task: CleaningTask): CleaningHistoryEntry[] {
  return task.history.slice(0, VISIBLE_HISTORY_COUNT);
}

/**
 * 履歴の行に添える「登録: 8/31 9:15」。
 *
 * 掃除した日と登録した日が同じ行には出さない。その場で押した記録に「登録: 今日」と
 * 書いても何も足さず、後から入れた記録だけが目立たなくなる。
 */
export function formatRecordedAt(entry: CleaningHistoryEntry): string | null {
  if (!entry.recorded_at) return null;
  // "2026-08-31T09:15:00+09:00" -> ["2026-08-31", "09:15"]。端末の時計で解釈すると
  // タイムゾーンで日付がずれるので、サーバーが返した JST の文字列をそのまま切る
  const [day, rest] = entry.recorded_at.split("T");
  if (!day || !rest || day === entry.date) return null;
  const [hour, minute] = rest.split(":");
  if (!hour || !minute) return null;
  return `登録: ${formatCleaningDate(day)} ${Number(hour)}:${minute}`;
}

/**
 * 「掃除した日」に選べる日の下限。カレンダーを無限にさかのぼれても意味が無いので、
 * 履歴に残る件数と同じだけ過去（`HISTORY_LIMIT` 相当）より広めの90日で止める。
 */
export const MAX_BACKDATE_DAYS = 90;

/** today から days 日前の YYYY-MM-DD。UTC 正午で数えて日付ずれを避ける */
export function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** 記録ボタンの文言。今日なら日付を出さず、過去日なら「いつの記録か」を出す */
export function formatMarkDoneLabel(date: string, today: string): string {
  return date === today ? "今日 掃除した" : `${formatCleaningDate(date)} に掃除した`;
}

/** 掃除した日として受け付けられる範囲かどうか（未来と、さかのぼりすぎを弾く） */
export function isSelectableDoneDate(date: string, today: string): boolean {
  const days = diffDays(date, today);
  return days !== null && days >= 0 && days <= MAX_BACKDATE_DAYS;
}

/** 入力欄の値を保存できる形へ寄せる。間隔は範囲外を丸め、空の手順は落とす */
export function toCleaningTaskInput(draft: {
  id?: string;
  name: string;
  interval_days: number | string;
  steps: string[];
}): CleaningTaskInput {
  // 入力欄を空にしたときの `Number("")` は 0 なので、そのままだと最小値へ丸められる。
  // 「未入力」と「0 と入力した」を分けて、未入力は既定の7日へ倒す。
  const raw =
    typeof draft.interval_days === "string" ? draft.interval_days.trim() : draft.interval_days;
  const interval = raw === "" ? Number.NaN : Number(raw);
  return {
    id: draft.id,
    name: draft.name.trim(),
    interval_days: Number.isFinite(interval)
      ? Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, Math.round(interval)))
      : 7,
    steps: draft.steps.map((step) => step.trim()).filter((step) => step.length > 0),
  };
}
