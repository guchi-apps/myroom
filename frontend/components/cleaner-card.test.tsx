import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CleanerCard } from "@/components/cleaner-card";
import type { CleanerRun, CleanerSummary } from "@/lib/types";

function run(startedAt: string, minutes: number, running = false): CleanerRun {
  return {
    started_at: startedAt,
    ended_at: running ? null : startedAt,
    duration_minutes: minutes,
    running,
  };
}

const summary: CleanerSummary = {
  current: {
    event: "charging",
    label: "充電中",
    since: "2026-08-22T15:04:00",
    battery: 92,
  },
  last_run: run("2026-08-22T14:32:00", 32),
  recent_runs: [
    run("2026-08-22T14:32:00", 32),
    run("2026-08-20T09:05:00", 41),
    run("2026-08-18T14:10:00", 28),
  ],
  this_month: { count: 12, average_minutes: 34, start: "2026-08-01" },
  days_since_previous_run: 2,
  last_seen_at: "2026-08-22T15:35:00",
  stale: false,
  now: "2026-08-22T15:35:00",
};

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("CleanerCard", () => {
  it("最終起動・状態・電池・直近の稼働を出す", () => {
    const html = render(
      <CleanerCard summary={summary} loading={false} error={false} />
    );
    expect(html).toContain("お掃除ロボット");
    expect(html).toContain("最終起動");
    expect(html).toContain("今日 14:32");
    expect(html).toContain("充電中");
    expect(html).toContain("92%");
    expect(html).toContain("8/20 (木)");
    expect(html).toContain("今月 12回 ・ 平均 34分");
    expect(html).toContain("2日");
  });

  it("掃除中は経過時間を出す", () => {
    const html = render(
      <CleanerCard
        summary={{
          ...summary,
          current: {
            event: "cleaning",
            label: "掃除中",
            since: "2026-08-22T14:32:00",
            battery: 78,
          },
          last_run: run("2026-08-22T14:32:00", 12, true),
          recent_runs: [run("2026-08-22T14:32:00", 12, true)],
        }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("掃除中");
    expect(html).toContain("12分経過");
  });

  it("受信が途絶えていたら履歴の代わりに知らせる", () => {
    const html = render(
      <CleanerCard
        summary={{ ...summary, stale: true }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("受信が途絶えています");
    expect(html).toContain("不明");
    // 古い履歴を「いまの状態」として並べない
    expect(html).not.toContain("8/20 (木)");
  });

  it("まだ受け取っていなければ何をすれば埋まるかを出す", () => {
    const html = render(
      <CleanerCard
        summary={{
          ...summary,
          current: null,
          last_run: null,
          recent_runs: [],
        }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("まだ稼働を受け取っていません");
  });

  it("読み込み中と失敗をそれぞれ出す", () => {
    expect(
      render(<CleanerCard summary={null} loading error={false} />)
    ).toContain("animate-pulse");
    expect(render(<CleanerCard summary={null} loading={false} error />)).toContain(
      "読み込めませんでした"
    );
  });
});
