export interface GarbageCategory {
  id: string;
  name: string;
  color: string;
  note: string;
}

/** 日付・曜日・今日からの距離だけを持つ最小の形。品目ごとの次の収集日もこの形で届く */
export interface GarbageDate {
  date: string;
  weekday: string;
  days_until: number;
}

export interface GarbageDay extends GarbageDate {
  categories: GarbageCategory[];
  notes: string[];
}

/** 品目と、その品目が次に収集される日。約2か月先まで無ければ next は null */
export interface GarbageCategoryNext extends GarbageCategory {
  next: GarbageDate | null;
}

export interface GarbageSchedule {
  configured: boolean;
  area: string;
  /** 収集が終わる時刻（"08:30"）。古いバックエンドは返さない */
  collection_time?: string;
  /** 今日の収集が collection_time を過ぎて終わっているか */
  today_done?: boolean;
  today: GarbageDay;
  tomorrow: GarbageDay;
  upcoming: GarbageDay[];
  by_category?: GarbageCategoryNext[];
}

export interface GarbageRow {
  /** 行の左端に出す見出し（"今日" / "明日"） */
  label: string;
  day: GarbageDay;
  /** この日の収集がもう終わっているか（今日の行だけ true になり得る） */
  done: boolean;
}

export interface GarbageHighlight {
  day: GarbageDay;
  /** カード先頭の見出し（例: "8/25(火)・あと3日"・"今日 8/22(土)"） */
  title: string;
  /** 今日または明日の収集（カードを目立たせる） */
  imminent: boolean;
}

/** "2026-08-14" + "金" -> "8/14(金)"。タイムゾーンに左右されないよう文字列のまま組み立てる */
export function formatGarbageDate(day: GarbageDate): string {
  const [, month, date] = day.date.split("-");
  if (!month || !date) return day.date;
  return `${Number(month)}/${Number(date)}(${day.weekday})`;
}

export function formatGarbageCategories(day: GarbageDay): string {
  if (day.categories.length === 0) return "収集なし";
  return day.categories.map((category) => category.name).join("・");
}

/** 収集日までの距離を言葉にする。0=今日 / 1=明日 / それ以降は残り日数 */
export function formatGarbageCountdown(day: GarbageDate): string {
  if (day.days_until <= 0) return "今日";
  if (day.days_until === 1) return "明日";
  return `あと${day.days_until}日`;
}

/** 今日の収集が終わっているか。古いバックエンドは today_done を返さないので false 扱い */
export function isGarbageTodayDone(schedule: GarbageSchedule): boolean {
  return schedule.today_done === true;
}

/** "08:30" -> "8:30"。先頭の0だけ落とす（想定外の形式はそのまま返す） */
export function formatGarbageCollectionTime(time: string | undefined): string {
  if (!time) return "";
  const [hour, minute] = time.split(":");
  if (hour == null || minute == null) return time;
  const hourNumber = Number(hour);
  if (!Number.isFinite(hourNumber)) return time;
  return `${hourNumber}:${minute}`;
}

/**
 * カード先頭に出す「次の収集」。今日・明日・この先の順に、収集がある最初の日を採る。
 * 今日・明日は日付より「今日」「明日」の方が読みやすいので前に置き、
 * それ以降は日付を先に置いて残り日数を添える。
 * 今日の収集が済んでいれば今日は候補から外し、明日以降を指す（#270）。
 */
export function buildGarbageHighlight(
  schedule: GarbageSchedule
): GarbageHighlight | null {
  const candidates = isGarbageTodayDone(schedule)
    ? [schedule.tomorrow, ...schedule.upcoming]
    : [schedule.today, schedule.tomorrow, ...schedule.upcoming];
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
 * カードに並べる行。今日・明日は収集が無くても「収集なし」として必ず出す。
 * 収集が済んだ今日の行も消さずに残し、done で「済んだ」と分かるようにする（#270）。
 * この先の予定は日付順に並べるより品目ごとに見たい（#207）ので、行にはせず
 * buildGarbageCategoryRows() の一覧へ回す。
 */
export function buildGarbageRows(schedule: GarbageSchedule): GarbageRow[] {
  return [
    { label: "今日", day: schedule.today, done: isGarbageTodayDone(schedule) },
    { label: "明日", day: schedule.tomorrow, done: false },
  ];
}

/**
 * 「品目ごとの次の収集」に並べる行。API が by_category を返さない古いバックエンドでは
 * 空になり、カードはこの節ごと出さない。
 */
export function buildGarbageCategoryRows(
  schedule: GarbageSchedule
): GarbageCategoryNext[] {
  return schedule.by_category ?? [];
}

/** 「あと3日」以内かどうか。ここだけオレンジの太字にして、近い品目を見つけやすくする */
export function isGarbageComingSoon(entry: GarbageCategoryNext): boolean {
  return entry.next != null && entry.next.days_until <= 3;
}

/** 年末年始などの注記。今日・明日・この先の予定から重複を除いて集める */
export function collectGarbageNotes(schedule: GarbageSchedule): string[] {
  return [
    ...new Set(
      [schedule.today, schedule.tomorrow, ...schedule.upcoming].flatMap(
        (day) => day.notes
      )
    ),
  ];
}
