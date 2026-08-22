import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GarbageCard } from "@/components/garbage-card";
import type { GarbageSchedule } from "@/lib/garbage";

const burnable = { id: "burnable", name: "普通ごみ", color: "#e67e22", note: "" };
const bulky = { id: "bulky_burnable", name: "大型可燃ごみ", color: "#9b59b6", note: "" };

const schedule: GarbageSchedule = {
  configured: true,
  area: "高槻市 出丸町",
  today: {
    date: "2026-08-18",
    weekday: "火",
    days_until: 0,
    categories: [burnable],
    notes: [],
  },
  tomorrow: {
    date: "2026-08-19",
    weekday: "水",
    days_until: 1,
    categories: [],
    notes: [],
  },
  upcoming: [
    {
      date: "2026-08-21",
      weekday: "金",
      days_until: 3,
      categories: [burnable],
      notes: ["振替収集"],
    },
  ],
  by_category: [
    { ...burnable, next: { date: "2026-08-18", weekday: "火", days_until: 0 } },
    { ...bulky, next: { date: "2026-09-18", weekday: "金", days_until: 31 } },
  ],
};

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("GarbageCard", () => {
  it("今日・明日・次の収集を並べる", () => {
    const html = render(<GarbageCard schedule={schedule} loading={false} error={false} />);
    expect(html).toContain("ゴミの日");
    expect(html).toContain("8/18(火)");
    expect(html).toContain("普通ごみ");
    expect(html).toContain("8/19(水)");
    expect(html).toContain("収集なし");
    expect(html).toContain("次の収集");
    expect(html).toContain("振替収集");
  });

  it("次の収集を見出しに出し、品目は設定した色で示す", () => {
    const html = render(<GarbageCard schedule={schedule} loading={false} error={false} />);
    expect(html).toContain("今日 8/18(火)");
    expect(html).toContain("#e67e22");
  });

  it("地区名は出さない", () => {
    const html = render(<GarbageCard schedule={schedule} loading={false} error={false} />);
    expect(html).not.toContain("高槻市");
  });

  it("品目ごとの次の収集を設定した順に並べる", () => {
    const html = render(<GarbageCard schedule={schedule} loading={false} error={false} />);
    expect(html).toContain("品目ごとの次の収集");
    expect(html).toContain("大型可燃ごみ");
    expect(html).toContain("9/18(金)");
    expect(html).toContain("あと31日");
    expect(html.indexOf("普通ごみ")).toBeLessThan(html.indexOf("大型可燃ごみ"));
  });

  it("この先に収集が見つからない品目は「予定なし」と出す", () => {
    const html = render(
      <GarbageCard
        schedule={{ ...schedule, by_category: [{ ...bulky, next: null }] }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("予定なし");
  });

  it("by_categoryを返さない古いバックエンドでは品目ごとの節を出さない", () => {
    const html = render(
      <GarbageCard
        schedule={{ ...schedule, by_category: undefined }}
        loading={false}
        error={false}
      />
    );
    expect(html).not.toContain("品目ごとの次の収集");
  });

  it("未設定なら書き換え先を案内する", () => {
    const html = render(
      <GarbageCard
        schedule={{ ...schedule, configured: false, area: "" }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("data/garbage.json");
    expect(html).not.toContain("8/18(火)");
  });

  it("取得に失敗したらエラーを出す", () => {
    const html = render(<GarbageCard schedule={null} loading={false} error />);
    expect(html).toContain("収集日を読み込めませんでした");
  });

  it("読み込み中は読み込み中と出す", () => {
    const html = render(<GarbageCard schedule={null} loading error={false} />);
    expect(html).toContain("読み込み中");
  });
});
