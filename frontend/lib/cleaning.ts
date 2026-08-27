/**
 * 掃除カードの表示ロジック。
 *
 * 「次にやる日」の計算そのものはバックエンド（`backend/cleaning.py`）が済ませて
 * `next_due` / `days_until` / `status` として返す。ここでやるのは並べ替えと言葉づかいだけ。
 * 日付の計算をブラウザ側でやり直すと、端末の時計とサーバー（JST）でずれる。
 */

/** 掃除の状態。overdue=期限を過ぎた / today=今日が期限 / upcoming=まだ先 */
export type CleaningStatus = "overdue" | "today" | "upcoming";

export interface CleaningTask {
  id: string;
  name: string;
  /** 何日に1回やるか */
  interval_days: number;
  /** やることの手順。空でもよい */
  steps: string[];
  /** 実施した日。新しい順。最大10件 */
  history: string[];
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
export function visibleHistory(task: CleaningTask): string[] {
  return task.history.slice(0, VISIBLE_HISTORY_COUNT);
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
