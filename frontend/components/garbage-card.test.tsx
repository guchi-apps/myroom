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

  /** 収集時刻を過ぎた後のペイロード。品目ごとの次の収集も繰り上がって届く（#270） */
  const afterCollection: GarbageSchedule = {
    ...schedule,
    collection_time: "08:30",
    today_done: true,
    by_category: [
      { ...burnable, next: { date: "2026-08-21", weekday: "金", days_until: 3 } },
      { ...bulky, next: { date: "2026-09-18", weekday: "金", days_until: 31 } },
    ],
  };

  it("収集が済んだら「次の収集」は次の収集日を指す", () => {
    const html = render(<GarbageCard schedule={afterCollection} loading={false} error={false} />);
    expect(html).toContain("8/21(金)・あと3日");
    expect(html).not.toContain("今日 8/18(火)");
  });

  it("収集が済んでも今日の行は残し、収集時刻を添えて済んだと分かるようにする", () => {
    const html = render(<GarbageCard schedule={afterCollection} loading={false} error={false} />);
    expect(html).toContain("8/18(火)");
    expect(html).toContain("普通ごみ");
    expect(html).toContain("8:30 収集済み");
    expect(html).toContain("line-through");
  });

  it("収集時刻を返さない古いバックエンドでは時刻を添えない", () => {
    const html = render(
      <GarbageCard
        schedule={{ ...afterCollection, collection_time: undefined }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("収集済み");
    expect(html).not.toContain("8:30 収集済み");
  });

  it("today_doneを返さない古いバックエンドでは今日を指したまま", () => {
    const html = render(
      <GarbageCard
        schedule={{ ...afterCollection, today_done: undefined }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("今日 8/18(火)");
    expect(html).not.toContain("収集済み");
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
