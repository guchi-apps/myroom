import { describe, expect, it } from "vitest";
import {
  buildEnergyComparison,
  buildEnergyDailyRows,
  buildEnergySparkline,
  energyRowRatio,
  formatEnergyDate,
  formatEnergyDateWithWeekday,
  formatKwh,
  formatYen,
  hasEnergyData,
  isEnergyStale,
} from "@/lib/energy";
import type { EnergySummary } from "@/lib/types";

function buildSummary(overrides: Partial<EnergySummary> = {}): EnergySummary {
  return {
    source: "aircon",
    unit_price: 31,
    today: { date: "2026-08-22", kwh: 0.8, cost_yen: 24.8 },
    yesterday: { date: "2026-08-21", kwh: 2.4, cost_yen: 74.4 },
    this_month: {
      kwh: 40.1,
      cost_yen: 1243,
      days: 22,
      start: "2026-08-01",
      end: "2026-08-22",
    },
    last_month: {
      kwh: 68.1,
      cost_yen: 2110,
      days: 31,
      start: "2026-07-01",
      end: "2026-07-31",
    },
    last_month_to_date: {
      kwh: 51,
      cost_yen: 1581,
      days: 22,
      start: "2026-07-01",
      end: "2026-07-22",
    },
    daily: [
      { date: "2026-08-20", kwh: 3.2, cost_yen: 99.2 },
      { date: "2026-08-21", kwh: 2.4, cost_yen: 74.4 },
      { date: "2026-08-22", kwh: 0.8, cost_yen: 24.8 },
    ],
    latest_date: "2026-08-22",
    updated_at: "2026-08-22T04:00:00",
    ...overrides,
  };
}

describe("表示の整形", () => {
  it("金額は円マークと3桁区切りにする", () => {
    expect(formatYen(1243)).toBe("¥1,243");
    expect(formatYen(24.8)).toBe("¥25");
    expect(formatYen(null)).toBe("—");
  });

  it("使用量は小数第1位まで出す", () => {
    expect(formatKwh(40.14)).toBe("40.1 kWh");
    expect(formatKwh(null)).toBe("—");
  });

  it("日付はゼロ埋めせず月/日にする", () => {
    expect(formatEnergyDate("2026-08-02")).toBe("8/2");
  });

  it("曜日つきの日付はUTC基準で組み立て、端末のタイムゾーンに寄せない", () => {
    expect(formatEnergyDateWithWeekday("2026-08-22")).toBe("8/22（土）");
  });
});

describe("先月との比較", () => {
  it("先月の同じ時期より安ければ cheaper になる", () => {
    const comparison = buildEnergyComparison(buildSummary());
    expect(comparison).toEqual({ cheaper: true, percent: 21, baseCostYen: 1581 });
  });

  it("高いときは cheaper が false になる", () => {
    const comparison = buildEnergyComparison(
      buildSummary({
        this_month: {
          kwh: 60,
          cost_yen: 1860,
          days: 22,
          start: "2026-08-01",
          end: "2026-08-22",
        },
      })
    );
    expect(comparison?.cheaper).toBe(false);
    expect(comparison?.percent).toBe(18);
  });

  it("先月ぶんが無ければ比較を出さない", () => {
    expect(
      buildEnergyComparison(
        buildSummary({
          last_month_to_date: {
            kwh: 0,
            cost_yen: 0,
            days: 0,
            start: "2026-07-01",
            end: "2026-07-22",
          },
        })
      )
    ).toBeNull();
  });

  it("summary が無ければ null", () => {
    expect(buildEnergyComparison(null)).toBeNull();
  });
});

describe("棒グラフ", () => {
  it("期間内の最大値を1として高さの比を出す", () => {
    const bars = buildEnergySparkline(buildSummary().daily);
    expect(bars.map((bar) => Number(bar.ratio.toFixed(2)))).toEqual([1, 0.75, 0.25]);
    expect(bars[bars.length - 1].isLast).toBe(true);
  });

  it("値が入っていない日は除く", () => {
    const bars = buildEnergySparkline([
      { date: "2026-08-21", kwh: null, cost_yen: null },
      { date: "2026-08-22", kwh: 2, cost_yen: 62 },
    ]);
    expect(bars).toHaveLength(1);
  });

  it("日別一覧は新しい日が先頭に来る", () => {
    const rows = buildEnergyDailyRows(buildSummary());
    expect(rows[0].date).toBe("2026-08-22");
  });

  it("一覧の棒も最大値で正規化する", () => {
    const rows = buildEnergyDailyRows(buildSummary());
    expect(energyRowRatio(rows, rows[0])).toBe(0.25);
  });
});

describe("収集が止まっているかの判定", () => {
  it("昨日ぶんが届いていれば止まっていない（当日ぶんは日中まだ来ない）", () => {
    expect(
      isEnergyStale(buildSummary({ latest_date: "2026-08-21" }), "2026-08-22")
    ).toBe(false);
  });

  it("一昨日で止まっていれば止まっていると見なす", () => {
    expect(
      isEnergyStale(buildSummary({ latest_date: "2026-08-20" }), "2026-08-22")
    ).toBe(true);
  });

  it("月をまたいでも日付の大小で判定できる", () => {
    expect(
      isEnergyStale(buildSummary({ latest_date: "2026-07-30" }), "2026-08-01")
    ).toBe(true);
  });

  it("1件も無ければ止まっている扱いにしない", () => {
    expect(isEnergyStale(buildSummary({ latest_date: null }), "2026-08-22")).toBe(
      false
    );
    expect(hasEnergyData(buildSummary({ daily: [] }))).toBe(false);
    expect(hasEnergyData(null)).toBe(false);
  });
});
