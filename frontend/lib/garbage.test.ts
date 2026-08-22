import { describe, expect, it } from "vitest";
import {
  buildGarbageHighlight,
  buildGarbageRows,
  formatGarbageCategories,
  formatGarbageCountdown,
  formatGarbageDate,
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
    area: "茨木市",
    today: day(),
    tomorrow: day({ date: "2026-08-15", weekday: "土", days_until: 1 }),
    upcoming: [],
    ...overrides,
  };
}

const burnable = { id: "burnable", name: "普通ごみ", color: "#e67e22", note: "" };
const recyclable = { id: "recyclable", name: "資源ごみ", color: "#1abc9c", note: "" };

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
      "普通ごみ・資源ごみ"
    );
  });
});

describe("buildGarbageRows", () => {
  it("今日・明日は収集が無くても行を作る", () => {
    const rows = buildGarbageRows(schedule());
    expect(rows.map((row) => row.label)).toEqual(["今日", "明日"]);
  });

  it("この先の収集予定はAPIが返した数だけ並べ、見出しは最初の行にだけ付ける", () => {
    const rows = buildGarbageRows(
      schedule({
        upcoming: [
          day({ date: "2026-08-18", weekday: "火", days_until: 4, categories: [burnable] }),
          day({ date: "2026-08-21", weekday: "金", days_until: 7, categories: [burnable] }),
          day({ date: "2026-09-09", weekday: "水", days_until: 26, categories: [recyclable] }),
        ],
      })
    );
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.label)).toEqual(["今日", "明日", "この先", "", ""]);
    expect(rows.map((row) => row.day.date)).toEqual([
      "2026-08-14",
      "2026-08-15",
      "2026-08-18",
      "2026-08-21",
      "2026-09-09",
    ]);
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
