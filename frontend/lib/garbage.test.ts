import { describe, expect, it } from "vitest";
import {
  buildGarbageCategoryRows,
  buildGarbageHighlight,
  buildGarbageRows,
  collectGarbageNotes,
  formatGarbageCategories,
  formatGarbageCollectionTime,
  formatGarbageCountdown,
  formatGarbageDate,
  isGarbageComingSoon,
  type GarbageDay,
  type GarbageSchedule,
} from "@/lib/garbage";

function day(overrides: Partial<GarbageDay> = {}): GarbageDay {
  return {
    date: "2026-08-14",
    weekday: "金",
    days_until: 0,
    categories: [],
    notes: [],
    ...overrides,
  };
}

function schedule(overrides: Partial<GarbageSchedule> = {}): GarbageSchedule {
  return {
    configured: true,
    area: "高槻市 出丸町",
    today: day(),
    tomorrow: day({ date: "2026-08-15", weekday: "土", days_until: 1 }),
    upcoming: [],
    ...overrides,
  };
}

const burnable = { id: "burnable", name: "普通ごみ", color: "#e67e22", note: "" };
const recyclable = { id: "recyclable", name: "リサイクルごみ", color: "#1abc9c", note: "" };

describe("formatGarbageDate", () => {
  it("先頭の0を落として曜日を添える", () => {
    expect(formatGarbageDate(day({ date: "2026-08-04", weekday: "火" }))).toBe("8/4(火)");
  });

  it("日付が想定外の形式ならそのまま返す", () => {
    expect(formatGarbageDate(day({ date: "unknown" }))).toBe("unknown");
  });
});

describe("formatGarbageCategories", () => {
  it("収集が無い日は「収集なし」", () => {
    expect(formatGarbageCategories(day())).toBe("収集なし");
  });

  it("複数の品目は中黒で並べる", () => {
    expect(formatGarbageCategories(day({ categories: [burnable, recyclable] }))).toBe(
      "普通ごみ・リサイクルごみ"
    );
  });
});

describe("formatGarbageCollectionTime", () => {
  it("時の先頭の0を落とす", () => {
    expect(formatGarbageCollectionTime("08:30")).toBe("8:30");
    expect(formatGarbageCollectionTime("11:05")).toBe("11:05");
  });

  it("未設定・想定外の形式では出さない・そのまま返す", () => {
    expect(formatGarbageCollectionTime(undefined)).toBe("");
    expect(formatGarbageCollectionTime("あさ")).toBe("あさ");
  });
});

describe("buildGarbageRows", () => {
  it("今日・明日は収集が無くても行を作る", () => {
    const rows = buildGarbageRows(schedule());
    expect(rows.map((row) => row.label)).toEqual(["今日", "明日"]);
  });

  it("この先の収集予定は行にせず、今日・明日の2行だけを返す", () => {
    const rows = buildGarbageRows(
      schedule({
        upcoming: [
          day({ date: "2026-08-18", weekday: "火", days_until: 4, categories: [burnable] }),
          day({ date: "2026-08-21", weekday: "金", days_until: 7, categories: [burnable] }),
        ],
      })
    );
    expect(rows.map((row) => row.day.date)).toEqual(["2026-08-14", "2026-08-15"]);
  });

  it("収集が済んでいても今日の行は残し、doneを立てる", () => {
    const rows = buildGarbageRows(
      schedule({ today: day({ categories: [burnable] }), today_done: true })
    );
    expect(rows.map((row) => row.done)).toEqual([true, false]);
    expect(rows[0].day.categories).toEqual([burnable]);
  });

  it("today_doneを返さない古いバックエンドではdoneは立たない", () => {
    expect(buildGarbageRows(schedule()).every((row) => !row.done)).toBe(true);
  });
});

describe("buildGarbageCategoryRows", () => {
  it("APIが返した並び順のまま返す", () => {
    const rows = buildGarbageCategoryRows(
      schedule({
        by_category: [
          { ...burnable, next: { date: "2026-08-17", weekday: "月", days_until: 3 } },
          { ...recyclable, next: null },
        ],
      })
    );
    expect(rows.map((row) => row.name)).toEqual(["普通ごみ", "リサイクルごみ"]);
    expect(rows[1].next).toBeNull();
  });

  it("by_categoryを返さない古いバックエンドでは空になる", () => {
    expect(buildGarbageCategoryRows(schedule())).toEqual([]);
  });
});

describe("isGarbageComingSoon", () => {
  it("3日以内なら近いとみなす", () => {
    const next = { date: "2026-08-17", weekday: "月", days_until: 3 };
    expect(isGarbageComingSoon({ ...burnable, next })).toBe(true);
    expect(isGarbageComingSoon({ ...burnable, next: { ...next, days_until: 4 } })).toBe(
      false
    );
  });

  it("予定が無ければ近くはない", () => {
    expect(isGarbageComingSoon({ ...burnable, next: null })).toBe(false);
  });
});

describe("collectGarbageNotes", () => {
  it("今日・明日・この先の注記を重複なく集める", () => {
    const notes = collectGarbageNotes(
      schedule({
        today: day({ notes: ["年末年始のため収集なし"] }),
        tomorrow: day({
          date: "2026-08-15",
          weekday: "土",
          days_until: 1,
          notes: ["年末年始のため収集なし"],
        }),
        upcoming: [day({ date: "2026-08-18", weekday: "火", days_until: 4, notes: ["振替収集"] })],
      })
    );
    expect(notes).toEqual(["年末年始のため収集なし", "振替収集"]);
  });
});

describe("formatGarbageCountdown", () => {
  it("今日・明日は日数ではなく言葉で出す", () => {
    expect(formatGarbageCountdown(day({ days_until: 0 }))).toBe("今日");
    expect(formatGarbageCountdown(day({ days_until: 1 }))).toBe("明日");
  });

  it("それ以降は残り日数", () => {
    expect(formatGarbageCountdown(day({ days_until: 4 }))).toBe("あと4日");
  });
});

describe("buildGarbageHighlight", () => {
  it("今日の収集が済んでいれば明日以降を採る", () => {
    const highlight = buildGarbageHighlight(
      schedule({
        today: day({ categories: [burnable] }),
        today_done: true,
        upcoming: [
          day({ date: "2026-08-18", weekday: "火", days_until: 4, categories: [recyclable] }),
        ],
      })
    );
    expect(highlight?.title).toBe("8/18(火)・あと4日");
    expect(highlight?.imminent).toBe(false);
  });

  it("今日の収集が済んでいても明日に収集があればそちらを採る", () => {
    const highlight = buildGarbageHighlight(
      schedule({
        today: day({ categories: [burnable] }),
        today_done: true,
        tomorrow: day({
          date: "2026-08-15",
          weekday: "土",
          days_until: 1,
          categories: [recyclable],
        }),
      })
    );
    expect(highlight?.title).toBe("明日 8/15(土)");
    expect(highlight?.imminent).toBe(true);
  });

  it("今日に収集があれば今日を採り、目立たせる", () => {
    const highlight = buildGarbageHighlight(
      schedule({ today: day({ categories: [burnable] }) })
    );
    expect(highlight?.title).toBe("今日 8/14(金)");
    expect(highlight?.imminent).toBe(true);
    expect(highlight?.day.categories).toEqual([burnable]);
  });

  it("明日に収集があれば明日を採り、目立たせる", () => {
    const highlight = buildGarbageHighlight(
      schedule({
        tomorrow: day({
          date: "2026-08-15",
          weekday: "土",
          days_until: 1,
          categories: [recyclable],
        }),
      })
    );
    expect(highlight?.title).toBe("明日 8/15(土)");
    expect(highlight?.imminent).toBe(true);
  });

  it("この先の収集は日付と残り日数を並べ、目立たせない", () => {
    const highlight = buildGarbageHighlight(
      schedule({
        upcoming: [
          day({ date: "2026-08-18", weekday: "火", days_until: 4, categories: [burnable] }),
        ],
      })
    );
    expect(highlight?.title).toBe("8/18(火)・あと4日");
    expect(highlight?.imminent).toBe(false);
  });

  it("収集予定が1件も無ければ null", () => {
    expect(buildGarbageHighlight(schedule())).toBeNull();
  });
});
