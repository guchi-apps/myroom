export interface GarbageCategory {
  id: string;
  name: string;
  color: string;
  note: string;
}

export interface GarbageDay {
  date: string;
  weekday: string;
  days_until: number;
  categories: GarbageCategory[];
  notes: string[];
}

export interface GarbageSchedule {
  configured: boolean;
  area: string;
  today: GarbageDay;
  tomorrow: GarbageDay;
  upcoming: GarbageDay[];
}

export interface GarbageRow {
  /** 行の左端に出す見出し。同じ区分が続く2行目以降は空文字 */
  label: string;
  day: GarbageDay;
}

export interface GarbageHighlight {
  day: GarbageDay;
  /** カード先頭の見出し（例: "8/25(火)・あと3日"・"今日 8/22(土)"） */
  title: string;
  /** 今日または明日の収集（カードを目立たせる） */
  imminent: boolean;
}

/** "2026-08-14" + "金" -> "8/14(金)"。タイムゾーンに左右されないよう文字列のまま組み立てる */
export function formatGarbageDate(day: GarbageDay): string {
  const [, month, date] = day.date.split("-");
  if (!month || !date) return day.date;
  return `${Number(month)}/${Number(date)}(${day.weekday})`;
}

export function formatGarbageCategories(day: GarbageDay): string {
  if (day.categories.length === 0) return "収集なし";
  return day.categories.map((category) => category.name).join("・");
}

/** 収集日までの距離を言葉にする。0=今日 / 1=明日 / それ以降は残り日数 */
export function formatGarbageCountdown(day: GarbageDay): string {
  if (day.days_until <= 0) return "今日";
  if (day.days_until === 1) return "明日";
  return `あと${day.days_until}日`;
}

/**
 * カード先頭に出す「次の収集」。今日・明日・この先の順に、収集がある最初の日を採る。
 * 今日・明日は日付より「今日」「明日」の方が読みやすいので前に置き、
 * それ以降は日付を先に置いて残り日数を添える。
 */
export function buildGarbageHighlight(
  schedule: GarbageSchedule
): GarbageHighlight | null {
  const candidates = [schedule.today, schedule.tomorrow, ...schedule.upcoming];
  const day = candidates.find((entry) => entry.categories.length > 0);
  if (!day) return null;

  const countdown = formatGarbageCountdown(day);
  const date = formatGarbageDate(day);
  return {
    day,
    title: day.days_until <= 1 ? `${countdown} ${date}` : `${date}・${countdown}`,
    imminent: day.days_until <= 1,
  };
}

/**
 * カードに並べる行。今日・明日は収集が無くても「収集なし」として必ず出し、
 * その先は API が返す予定（最大3件）をすべて添える。
 * 「この先」の見出しは最初の1行にだけ付け、以降は日付だけを縦にそろえる。
 */
export function buildGarbageRows(schedule: GarbageSchedule): GarbageRow[] {
  const rows: GarbageRow[] = [
    { label: "今日", day: schedule.today },
    { label: "明日", day: schedule.tomorrow },
  ];

  schedule.upcoming.forEach((day, index) => {
    rows.push({ label: index === 0 ? "この先" : "", day });
  });
  return rows;
}
