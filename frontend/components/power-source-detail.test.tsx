import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PowerSourceDetail } from "@/components/power-source-detail";
import type { EnergySourceSummary } from "@/lib/types";

const summary: EnergySourceSummary = {
  source: "tapo:冷蔵庫",
  unit_price: 31,
  today: { date: "2026-08-22", kwh: 0.86, cost_yen: 26.7 },
  yesterday: { date: "2026-08-21", kwh: 0.9, cost_yen: 27.9 },
  this_month: {
    kwh: 22.4,
    cost_yen: 694,
    days: 22,
    start: "2026-08-01",
    end: "2026-08-22",
  },
  last_month: {
    kwh: 30.1,
    cost_yen: 933,
    days: 31,
    start: "2026-07-01",
    end: "2026-07-31",
  },
  last_month_to_date: {
    kwh: 21.2,
    cost_yen: 657,
    days: 22,
    start: "2026-07-01",
    end: "2026-07-22",
  },
  daily: [
    { date: "2026-08-21", kwh: 0.9, cost_yen: 27.9 },
    { date: "2026-08-22", kwh: 0.86, cost_yen: 26.7 },
  ],
  latest_date: "2026-08-22",
  updated_at: "2026-08-22T04:00:00",
};

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("PowerSourceDetail", () => {
  it("タイル・日別一覧を出す", () => {
    const html = render(
      <PowerSourceDetail
        label="冷蔵庫"
        color="#e67e22"
        summary={summary}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("¥694");
    expect(html).toContain("22.4 kWh");
    expect(html).toContain("¥933");
    expect(html).toContain("¥657");
    expect(html).toContain("冷蔵庫の日別（直近2日）");
    expect(html).toContain("0.9 kWh");
  });

  it("記録が無ければ案内を出す", () => {
    const html = render(
      <PowerSourceDetail
        label="冷蔵庫"
        color="#e67e22"
        summary={{ ...summary, daily: [] }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("まだ使用量を受け取っていません");
  });

  it("読み込み中と失敗を出し分ける", () => {
    const loading = render(
      <PowerSourceDetail
        label="冷蔵庫"
        color="#e67e22"
        summary={null}
        loading
        error={false}
      />
    );
    expect(loading).toContain("animate-pulse");

    const failed = render(
      <PowerSourceDetail
        label="冷蔵庫"
        color="#e67e22"
        summary={null}
        loading={false}
        error
      />
    );
    expect(failed).toContain("使用量の推移を読み込めませんでした");
  });

  it("読み込み中は実データと同じ骨格を出す（#329）", () => {
    const loading = render(
      <PowerSourceDetail
        label="冷蔵庫"
        color="#e67e22"
        summary={null}
        loading
        error={false}
        placeholderRows={12}
      />
    );
    // 遅らせて出すためのクラスと、タイル・棒グラフ・一覧の枠が揃っていること
    expect(loading).toContain("skeleton-delayed");
    expect(loading).toContain("h-[88px]");
    expect(loading).toContain("h-[110px]");
    expect(loading.split("h-[19px]").length - 1).toBe(12);
  });

  it("読み込み表示の行数は上下限に収める（#329）", () => {
    const few = render(
      <PowerSourceDetail
        label="冷蔵庫"
        color="#e67e22"
        summary={null}
        loading
        error={false}
        placeholderRows={0}
      />
    );
    expect(few.split("h-[19px]").length - 1).toBe(4);

    const many = render(
      <PowerSourceDetail
        label="冷蔵庫"
        color="#e67e22"
        summary={null}
        loading
        error={false}
        placeholderRows={200}
      />
    );
    expect(many.split("h-[19px]").length - 1).toBe(30);
  });

  it("取り直しに失敗しても、取れている内容は出し続ける（#329）", () => {
    const html = render(
      <PowerSourceDetail
        label="冷蔵庫"
        color="#e67e22"
        summary={summary}
        loading={false}
        error
      />
    );
    expect(html).toContain("¥694");
    expect(html).not.toContain("使用量の推移を読み込めませんでした");
  });

  it("失敗し、かつ内容が無ければ案内を出す", () => {
    const failed = render(
      <PowerSourceDetail
        label="冷蔵庫"
        color="#e67e22"
        summary={null}
        loading={false}
        error
      />
    );
    expect(failed).toContain("使用量の推移を読み込めませんでした");
  });
});
