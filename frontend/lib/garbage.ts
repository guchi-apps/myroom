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
  label: string;
  day: GarbageDay;
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

/**
 * カードに並べる行。今日・明日は収集が無くても「収集なし」として必ず出し、
 * その先の直近の収集日を1件だけ添える。
 */
export function buildGarbageRows(schedule: GarbageSchedule): GarbageRow[] {
  const rows: GarbageRow[] = [
    { label: "今日", day: schedule.today },
    { label: "明日", day: schedule.tomorrow },
  ];

  const next = schedule.upcoming[0];
  if (next) {
    rows.push({ label: "次の収集", day: next });
  }
  return rows;
}

/** 今日・明日に収集がある（カードを目立たせる） */
export function hasImminentCollection(schedule: GarbageSchedule): boolean {
  return schedule.today.categories.length > 0 || schedule.tomorrow.categories.length > 0;
}
