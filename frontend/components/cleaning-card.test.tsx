import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CleaningCard } from "@/components/cleaning-card";
import type { CleaningSchedule, CleaningTask } from "@/lib/cleaning";

function task(overrides: Partial<CleaningTask> & { id: string; name: string }): CleaningTask {
  return {
    interval_days: 7,
    steps: [],
    history: [],
    last_done: null,
    next_due: "2026-08-26",
    days_until: 0,
    status: "today",
    ...overrides,
  };
}

const schedule: CleaningSchedule = {
  today: "2026-08-26",
  configured: true,
  tasks: [
    task({
      id: "fan",
      name: "換気扇まわり",
      interval_days: 30,
      next_due: "2026-08-24",
      days_until: -2,
      status: "overdue",
      last_done: "2026-07-25",
      history: ["2026-07-25"],
    }),
    task({ id: "sink", name: "キッチンのシンク", interval_days: 3 }),
    task({
      id: "bath",
      name: "お風呂",
      next_due: "2026-08-31",
      days_until: 5,
      status: "upcoming",
    }),
  ],
};

const noop = () => {};

function render(schedule: CleaningSchedule | null, extra?: { loading?: boolean; error?: boolean }) {
  return renderToStaticMarkup(
    <CleaningCard
      schedule={schedule}
      loading={extra?.loading ?? false}
      error={extra?.error ?? false}
      busyTaskId={null}
      onOpenTask={noop}
      onOpenSettings={noop}
      onMarkDone={noop}
    />
  );
}

describe("CleaningCard", () => {
  it("期限が来たものだけを「今日やること」に出す", () => {
    const html = render(schedule);
    const todo = html.slice(0, html.indexOf("場所ごとの次の掃除"));

    expect(todo).toContain("今日やること");
    expect(todo).toContain("換気扇まわり");
    expect(todo).toContain("キッチンのシンク");
    expect(todo).not.toContain("お風呂");
  });

  it("遅れている日数と残り日数を出す", () => {
    const html = render(schedule);
    expect(html).toContain("2日遅れ");
    expect(html).toContain("あと5日");
  });

  it("一覧は次にやる日が近い順に並ぶ", () => {
    const html = render(schedule);
    const rows = html.slice(html.indexOf("場所ごとの次の掃除"));
    expect(rows.indexOf("換気扇まわり")).toBeLessThan(rows.indexOf("キッチンのシンク"));
    expect(rows.indexOf("キッチンのシンク")).toBeLessThan(rows.indexOf("お風呂"));
  });

  it("やることが1件も無ければ「今日やること」は出さない", () => {
    const html = render({
      ...schedule,
      tasks: schedule.tasks.filter((entry) => entry.status === "upcoming"),
    });
    expect(html).not.toContain("今日やること");
    expect(html).toContain("お風呂");
  });

  it("1件も登録されていなければ設定への案内を出す", () => {
    const html = render({ today: "2026-08-26", configured: false, tasks: [] });
    expect(html).toContain("掃除の予定がまだありません");
    // 入口は文字ではなくアイコンになったので、案内文もそれに合わせる（#277）
    expect(html).toContain("設定アイコン");
  });

  it("設定への入口は共通の設定アイコンで出す", () => {
    // 文字の「設定」ではなく、他のセクションと同じ歯車ボタン（#277）
    const html = render(schedule);
    expect(html).toContain('aria-label="掃除の設定"');
    expect(html).toContain('title="掃除の設定"');
  });

  it("読み込み中と失敗はメッセージだけを出す", () => {
    expect(render(null, { loading: true })).toContain("読み込み中");
    expect(render(null, { error: true })).toContain("読み込めませんでした");
  });
});
