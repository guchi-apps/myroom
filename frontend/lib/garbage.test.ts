import { describe, expect, it } from "vitest";
import {
  buildGarbageRows,
  formatGarbageCategories,
  formatGarbageDate,
  hasImminentCollection,
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

  it("この先の収集予定があれば1件だけ添える", () => {
    const rows = buildGarbageRows(
      schedule({
        upcoming: [
          day({ date: "2026-08-18", weekday: "火", days_until: 4, categories: [burnable] }),
          day({ date: "2026-08-21", weekday: "金", days_until: 7, categories: [burnable] }),
        ],
      })
    );
    expect(rows).toHaveLength(3);
    expect(rows[2].label).toBe("次の収集");
    expect(rows[2].day.date).toBe("2026-08-18");
  });
});

describe("hasImminentCollection", () => {
  it("今日に収集があれば true", () => {
    expect(hasImminentCollection(schedule({ today: day({ categories: [burnable] }) }))).toBe(
      true
    );
  });

  it("明日に収集があれば true", () => {
    expect(
      hasImminentCollection(
        schedule({ tomorrow: day({ days_until: 1, categories: [recyclable] }) })
      )
    ).toBe(true);
  });

  it("どちらにも無ければ false", () => {
    expect(hasImminentCollection(schedule())).toBe(false);
  });
});
