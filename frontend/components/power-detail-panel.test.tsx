import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PowerDetailPanel } from "@/components/power-detail-panel";
import type { EnergyBreakdown, EnergyBreakdownDay } from "@/lib/types";

const noop = () => {};

function breakdown(daily: EnergyBreakdownDay[]): EnergyBreakdown {
  const total = { kwh: 3.0, cost_yen: 93, days: 1, start: "2026-08-01", end: "2026-08-22" };
  return {
    unit_price: 31,
    sources: [
      {
        source: "aircon",
        label: "エアコン",
        default_label: "エアコン",
        today_kwh: 1.86,
        today_cost_yen: 57.7,
        power_w: null,
        this_month_kwh: 48.2,
        latest_date: "2026-08-22",
      },
    ],
    today: { date: "2026-08-22", kwh: 1.86, cost_yen: 58, days: 1 },
    this_month: total,
    last_month: { ...total, start: "2026-07-01", end: "2026-07-31" },
    last_month_to_date: { ...total, start: "2026-07-01", end: "2026-07-22" },
    daily,
    latest_date: "2026-08-22",
    updated_at: "2026-08-22T09:00:00",
  };
}

function render(daily: EnergyBreakdownDay[]) {
  return renderToStaticMarkup(
    <PowerDetailPanel
      open
      breakdown={breakdown(daily)}
      onClose={noop}
      onUnitPriceSaved={noop}
      onKepcoImported={noop}
      onSourceNamesSaved={noop}
    />
  );
}

const WITHOUT_OTHER: EnergyBreakdownDay[] = [
  { date: "2026-08-21", kwh: 1.5, cost_yen: 47, by_source: { aircon: 1.5 } },
  { date: "2026-08-22", kwh: 1.86, cost_yen: 58, by_source: { aircon: 1.86 } },
];

const WITH_OTHER: EnergyBreakdownDay[] = [
  { date: "2026-08-21", kwh: 4.0, cost_yen: 124, by_source: { aircon: 1.5, kepco_other: 2.5 } },
  { date: "2026-08-22", kwh: 1.86, cost_yen: 58, by_source: { aircon: 1.86 } },
];

describe("PowerDetailPanel", () => {
  it("最初に開くのは日別タブで、そこでもCSVを取り込める（#319）", () => {
    const html = render(WITHOUT_OTHER);
    expect(html).toContain("KEPCOの明細（CSV）を取り込む");
    // 日別が選ばれている側（白いピル）で描かれている
    expect(html).toContain("日別");
    expect(html).toContain("日別（直近2日）");
  });

  it("「その他」がある日は積み上げに出し、説明の注記も添える（#319）", () => {
    const html = render(WITH_OTHER);
    // 「その他」の色は機器の配色とは別に固定してある
    expect(html).toContain("#95a5a6");
    expect(html).toContain("その他 = KEPCO実測（家全体）− エアコン・スマートプラグ実測");
  });

  it("「その他」が1日も無ければ注記を出さない（#319）", () => {
    const html = render(WITHOUT_OTHER);
    expect(html).not.toContain("その他 = KEPCO実測");
  });
});
