import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EnergyCard } from "@/components/energy-card";
import type { EnergySummary } from "@/lib/types";

const summary: EnergySummary = {
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
};

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("EnergyCard", () => {
  it("今月の目安・使用量・単価を出す", () => {
    const html = render(
      <EnergyCard summary={summary} loading={false} error={false} onOpenDetail={() => {}} />
    );
    expect(html).toContain("エアコンの電気代");
    expect(html).toContain("¥1,243");
    expect(html).toContain("40.1 kWh");
    expect(html).toContain("31 円/kWh");
    expect(html).toContain("8/1〜8/22");
  });

  it("先月の同じ時期との差を出す", () => {
    const html = render(
      <EnergyCard summary={summary} loading={false} error={false} onOpenDetail={() => {}} />
    );
    expect(html).toContain("¥1,581");
    expect(html).toContain("21% 少ない");
  });

  it("収集が止まっていれば比較ではなく停止を伝える", () => {
    const stale = { ...summary, latest_date: "2026-08-19" };
    const html = render(
      <EnergyCard summary={stale} loading={false} error={false} onOpenDetail={() => {}} />
    );
    expect(html).toContain("8/19 以降のデータが届いていません");
    expect(html).not.toContain("少ない");
  });

  it("1件も無ければ案内だけ出し、タップできないようにする", () => {
    const empty = { ...summary, daily: [] };
    const html = render(
      <EnergyCard summary={empty} loading={false} error={false} onOpenDetail={() => {}} />
    );
    expect(html).toContain("まだ使用量を受け取っていません");
    expect(html).not.toContain("<button");
  });

  it("読み込み中と失敗を出し分ける", () => {
    expect(
      render(
        <EnergyCard summary={null} loading error={false} onOpenDetail={() => {}} />
      )
    ).toContain("animate-pulse");
    expect(
      render(
        <EnergyCard summary={null} loading={false} error onOpenDetail={() => {}} />
      )
    ).toContain("電気代を読み込めませんでした");
  });
});
