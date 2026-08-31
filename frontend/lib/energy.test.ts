import { describe, expect, it } from "vitest";
import {
  AIRCON_ENERGY_COLOR,
  buildEnergyComparison,
  buildEnergyDailyRows,
  buildEnergyHourlyColumns,
  buildEnergySingleColumns,
  buildEnergySourceColors,
  buildEnergyStackColumns,
  buildEnergyStackSegments,
  energyRowRatio,
  energySourceRatio,
  formatEnergyDate,
  formatEnergyDateWithWeekday,
  formatEnergyHour,
  formatKwh,
  formatWatts,
  formatYen,
  hasEnergyData,
  isEnergyStale,
  shiftEnergyDate,
} from "@/lib/energy";
import type { EnergyBreakdown, EnergyHourly, EnergySourceRow } from "@/lib/types";

function buildSourceRow(overrides: Partial<EnergySourceRow> = {}): EnergySourceRow {
  return {
    source: "aircon",
    label: "エアコン",
    today_kwh: 1.86,
    today_cost_yen: 57.7,
    power_w: null,
    this_month_kwh: 48.2,
    latest_date: "2026-08-22",
    ...overrides,
  };
}

function buildBreakdown(overrides: Partial<EnergyBreakdown> = {}): EnergyBreakdown {
  return {
    unit_price: 31,
    sources: [
      buildSourceRow(),
      buildSourceRow({
        source: "tapo:冷蔵庫",
        label: "冷蔵庫",
        today_kwh: 0.86,
        today_cost_yen: 26.7,
        power_w: 38.2,
        this_month_kwh: 22.4,
      }),
      buildSourceRow({
        source: "tapo:テレビ",
        label: "テレビ",
        today_kwh: 0.31,
        today_cost_yen: 9.6,
        power_w: 72,
        this_month_kwh: 10.2,
      }),
    ],
    today: { date: "2026-08-22", kwh: 3.03, cost_yen: 94, days: 1 },
    this_month: {
      kwh: 80.8,
      cost_yen: 2505,
      days: 22,
      start: "2026-08-01",
      end: "2026-08-22",
    },
    last_month: {
      kwh: 110.2,
      cost_yen: 3416,
      days: 31,
      start: "2026-07-01",
      end: "2026-07-31",
    },
    last_month_to_date: {
      kwh: 71.4,
      cost_yen: 2213,
      days: 22,
      start: "2026-07-01",
      end: "2026-07-22",
    },
    daily: [
      {
        date: "2026-08-20",
        kwh: 5.0,
        cost_yen: 155,
        by_source: { aircon: 3.0, "tapo:冷蔵庫": 1.5, "tapo:テレビ": 0.5 },
      },
      {
        date: "2026-08-21",
        kwh: 4.0,
        cost_yen: 124,
        by_source: { aircon: 2.0, "tapo:冷蔵庫": 1.5, "tapo:テレビ": 0.5 },
      },
      {
        date: "2026-08-22",
        kwh: 3.03,
        cost_yen: 94,
        by_source: { aircon: 1.86, "tapo:冷蔵庫": 0.86, "tapo:テレビ": 0.31 },
      },
    ],
    latest_date: "2026-08-22",
    updated_at: "2026-08-22T04:00:00",
    ...overrides,
  };
}

describe("表示の整形", () => {
  it("金額は円マークと3桁区切りにする", () => {
    expect(formatYen(2505)).toBe("¥2,505");
    expect(formatYen(null)).toBe("—");
  });

  it("使用量は小数第1位まで出す", () => {
    expect(formatKwh(80.84)).toBe("80.8 kWh");
    expect(formatKwh(null)).toBe("—");
  });

  it("いまのWは整数で出し、返さない取得元は「—」にする", () => {
    expect(formatWatts(38.2)).toBe("38 W");
    expect(formatWatts(0)).toBe("0 W");
    // エアコン（AirCloud Home）は瞬時値を返さない
    expect(formatWatts(null)).toBe("—");
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
    const comparison = buildEnergyComparison(
      buildBreakdown({
        this_month: {
          kwh: 60,
          cost_yen: 1860,
          days: 22,
          start: "2026-08-01",
          end: "2026-08-22",
        },
      })
    );
    expect(comparison?.cheaper).toBe(true);
  });

  it("高いときは cheaper が false になる", () => {
    expect(buildEnergyComparison(buildBreakdown())?.cheaper).toBe(false);
  });

  it("先月ぶんが無ければ比較を出さない", () => {
    const comparison = buildEnergyComparison(
      buildBreakdown({
        last_month_to_date: {
          kwh: 0,
          cost_yen: 0,
          days: 0,
          start: "2026-07-01",
          end: "2026-07-22",
        },
      })
    );
    expect(comparison).toBeNull();
  });

  it("breakdown が無ければ null", () => {
    expect(buildEnergyComparison(null)).toBeNull();
  });
});

describe("取得元ごとの色", () => {
  it("エアコンは固定色で、プラグには別の色が割り当たる", () => {
    const colors = buildEnergySourceColors(buildBreakdown().sources);
    expect(colors["aircon"]).toBe(AIRCON_ENERGY_COLOR);
    expect(colors["tapo:冷蔵庫"]).not.toBe(AIRCON_ENERGY_COLOR);
    expect(colors["tapo:冷蔵庫"]).not.toBe(colors["tapo:テレビ"]);
  });

  it("エアコンが無くてもプラグの色が重ならない", () => {
    const colors = buildEnergySourceColors([
      buildSourceRow({ source: "tapo:A", label: "A" }),
      buildSourceRow({ source: "tapo:B", label: "B" }),
    ]);
    expect(colors["tapo:A"]).not.toBe(colors["tapo:B"]);
  });
});

describe("積み上げ", () => {
  it("1日ぶんを取得元ごとの割合に分ける", () => {
    const breakdown = buildBreakdown();
    const colors = buildEnergySourceColors(breakdown.sources);
    const segments = buildEnergyStackSegments(
      breakdown.daily[0],
      breakdown.sources,
      colors
    );
    expect(segments.map((segment) => segment.source)).toEqual([
      "aircon",
      "tapo:冷蔵庫",
      "tapo:テレビ",
    ]);
    expect(segments[0].share).toBeCloseTo(0.6);
    expect(segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1);
  });

  it("その日に値が無い取得元は入れない", () => {
    const breakdown = buildBreakdown();
    const colors = buildEnergySourceColors(breakdown.sources);
    const segments = buildEnergyStackSegments(
      { date: "2026-08-22", kwh: 1.86, cost_yen: 58, by_source: { aircon: 1.86 } },
      breakdown.sources,
      colors
    );
    expect(segments).toHaveLength(1);
  });

  it("棒の高さは期間内の最大値で正規化する", () => {
    const columns = buildEnergyStackColumns(buildBreakdown());
    expect(columns.map((column) => Number(column.ratio.toFixed(2)))).toEqual([
      1, 0.8, 0.61,
    ]);
  });

  it("記録の無い日は棒を作らない（0kWhとして描かない）", () => {
    const columns = buildEnergyStackColumns(
      buildBreakdown({
        daily: [
          { date: "2026-08-21", kwh: 0, cost_yen: 0, by_source: {} },
          {
            date: "2026-08-22",
            kwh: 3.03,
            cost_yen: 94,
            by_source: { aircon: 3.03 },
          },
        ],
      })
    );
    expect(columns.map((column) => column.date)).toEqual(["2026-08-22"]);
  });
});

describe("単一デバイスの棒", () => {
  it("記録が無ければ空配列になる", () => {
    expect(buildEnergySingleColumns([])).toEqual([]);
    expect(
      buildEnergySingleColumns([
        { date: "2026-08-21", kwh: null },
        { date: "2026-08-22", kwh: 0 },
      ])
    ).toEqual([]);
  });

  it("0kWhの日は除外される", () => {
    const columns = buildEnergySingleColumns([
      { date: "2026-08-20", kwh: 0 },
      { date: "2026-08-21", kwh: 1.5 },
    ]);
    expect(columns.map((column) => column.date)).toEqual(["2026-08-21"]);
  });

  it("棒の高さは期間内の最大値で正規化する", () => {
    const columns = buildEnergySingleColumns([
      { date: "2026-08-20", kwh: 1.0 },
      { date: "2026-08-21", kwh: 2.0 },
      { date: "2026-08-22", kwh: 0.5 },
    ]);
    expect(columns.map((column) => column.ratio)).toEqual([0.5, 1, 0.25]);
  });
});

describe("日別一覧とカードの棒", () => {
  it("日別一覧は新しい日が先頭に来る", () => {
    const rows = buildEnergyDailyRows(buildBreakdown().daily);
    expect(rows[0].date).toBe("2026-08-22");
  });

  it("一覧の棒は最大値で正規化する", () => {
    const rows = buildEnergyDailyRows(buildBreakdown().daily);
    expect(Number(energyRowRatio(rows, rows[0]).toFixed(2))).toBe(0.61);
  });

  it("カードの行はその日いちばん使った取得元を1とする", () => {
    const { sources } = buildBreakdown();
    expect(energySourceRatio(sources, sources[0])).toBe(1);
    expect(Number(energySourceRatio(sources, sources[1]).toFixed(2))).toBe(0.46);
  });
});

describe("時間ごと（#300）", () => {
  function buildHourly(overrides: Partial<EnergyHourly> = {}): EnergyHourly {
    const emptyHours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      kwh: null,
      cost_yen: null,
      by_source: {},
    }));
    return {
      date: "2026-08-31",
      unit_price: 31,
      sources: ["aircon", "tapo:冷蔵庫"],
      has_data: true,
      hours: emptyHours,
      ...overrides,
    };
  }

  it("日付を日単位でずらす（UTC正午基準）", () => {
    expect(shiftEnergyDate("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftEnergyDate("2026-08-31", -1)).toBe("2026-08-30");
  });

  it("時間帯は「7時」のように出す", () => {
    expect(formatEnergyHour(7)).toBe("7時");
  });

  it("記録の無い時間帯はセグメントを作らない", () => {
    const columns = buildEnergyHourlyColumns(
      buildHourly(),
      buildBreakdown().sources,
      buildEnergySourceColors(buildBreakdown().sources)
    );
    expect(columns).toHaveLength(24);
    expect(columns.every((column) => column.segments.length === 0)).toBe(true);
  });

  it("取得元ごとの内訳にラベルと色、割合を付ける", () => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      kwh: null as number | null,
      cost_yen: null as number | null,
      by_source: {} as Record<string, number>,
    }));
    hours[8] = {
      hour: 8,
      kwh: 0.6,
      cost_yen: 19,
      by_source: { aircon: 0.5, "tapo:冷蔵庫": 0.1 },
    };
    const breakdown = buildBreakdown();
    const columns = buildEnergyHourlyColumns(
      buildHourly({ hours }),
      breakdown.sources,
      buildEnergySourceColors(breakdown.sources)
    );

    const hour8 = columns[8];
    expect(hour8.kwh).toBe(0.6);
    expect(hour8.segments.map((segment) => segment.source)).toEqual([
      "aircon",
      "tapo:冷蔵庫",
    ]);
    expect(hour8.segments[0].label).toBe("エアコン");
    expect(hour8.segments[0].share).toBeCloseTo(0.5 / 0.6);
    expect(hour8.ratio).toBe(1);
  });

  it("hourly が無ければ空配列", () => {
    expect(buildEnergyHourlyColumns(null, [], {})).toEqual([]);
  });
});

describe("収集が止まっているかの判定", () => {
  it("昨日ぶんが届いていれば止まっていない（当日ぶんは日中まだ来ない）", () => {
    expect(
      isEnergyStale(buildBreakdown({ latest_date: "2026-08-21" }), "2026-08-22")
    ).toBe(false);
  });

  it("一昨日で止まっていれば止まっていると見なす", () => {
    expect(
      isEnergyStale(buildBreakdown({ latest_date: "2026-08-20" }), "2026-08-22")
    ).toBe(true);
  });

  it("月をまたいでも日付の大小で判定できる", () => {
    expect(
      isEnergyStale(buildBreakdown({ latest_date: "2026-07-30" }), "2026-08-01")
    ).toBe(true);
  });

  it("1件も無ければ止まっている扱いにしない", () => {
    expect(isEnergyStale(buildBreakdown({ latest_date: null }), "2026-08-22")).toBe(
      false
    );
    expect(hasEnergyData(buildBreakdown({ daily: [] }))).toBe(false);
    expect(hasEnergyData(null)).toBe(false);
  });
});
