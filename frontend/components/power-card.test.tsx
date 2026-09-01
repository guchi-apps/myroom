import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PowerCard } from "@/components/power-card";
import type { EnergyBreakdown } from "@/lib/types";

const breakdown: EnergyBreakdown = {
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
    {
      source: "tapo:冷蔵庫",
      label: "冷蔵庫",
      default_label: "冷蔵庫",
      today_kwh: 0.86,
      today_cost_yen: 26.7,
      power_w: 38.2,
      this_month_kwh: 22.4,
      latest_date: "2026-08-22",
    },
  ],
  today: { date: "2026-08-22", kwh: 2.72, cost_yen: 84, days: 1 },
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
      date: "2026-08-22",
      kwh: 2.72,
      cost_yen: 84,
      by_source: { aircon: 1.86, "tapo:冷蔵庫": 0.86 },
    },
  ],
  latest_date: "2026-08-22",
  updated_at: "2026-08-22T04:00:00",
};

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("PowerCard", () => {
  it("今日の合計・取得元ごとの行・今月の合計を出す", () => {
    const html = render(
      <PowerCard
        breakdown={breakdown}
        loading={false}
        error={false}
        onOpenDetail={() => {}}
      />
    );
    expect(html).toContain("消費電力");
    expect(html).toContain("2.72");
    expect(html).toContain("エアコン");
    expect(html).toContain("冷蔵庫");
    expect(html).toContain("80.8 kWh");
    expect(html).toContain("¥2,505");
    expect(html).toContain("31 円/kWh");
  });

  it("いまのWはプラグにだけ出し、エアコンは「—」にする", () => {
    const html = render(
      <PowerCard
        breakdown={breakdown}
        loading={false}
        error={false}
        onOpenDetail={() => {}}
      />
    );
    expect(html).toContain("38 W");
    expect(html).toContain("—");
  });

  it("先月の同じ時期との差を出す", () => {
    const html = render(
      <PowerCard
        breakdown={breakdown}
        loading={false}
        error={false}
        onOpenDetail={() => {}}
      />
    );
    // 2,505円 と 2,213円 の差は 13%
    expect(html).toContain("13%");
    expect(html).toContain("多い");
  });

  it("収集が止まっていれば取得元の行ではなく停止を伝える", () => {
    const html = render(
      <PowerCard
        breakdown={{ ...breakdown, latest_date: "2026-08-20" }}
        loading={false}
        error={false}
        onOpenDetail={() => {}}
      />
    );
    expect(html).toContain("以降のデータが届いていません");
    expect(html).not.toContain("38 W");
  });

  it("1件も無ければ案内だけ出し、タップできないようにする", () => {
    const html = render(
      <PowerCard
        breakdown={{ ...breakdown, daily: [] }}
        loading={false}
        error={false}
        onOpenDetail={() => {}}
      />
    );
    expect(html).toContain("まだ使用量を受け取っていません");
    expect(html).not.toContain("<button");
  });

  it("読み込み中と失敗を出し分ける", () => {
    const loading = render(
      <PowerCard breakdown={null} loading error={false} onOpenDetail={() => {}} />
    );
    expect(loading).toContain("animate-pulse");

    const failed = render(
      <PowerCard breakdown={null} loading={false} error onOpenDetail={() => {}} />
    );
    expect(failed).toContain("消費電力を読み込めませんでした");
  });
});
