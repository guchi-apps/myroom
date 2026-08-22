import { describe, expect, it } from "vitest";
import {
  formatMinutes,
  formatMonthlyRuns,
  formatRunDay,
  formatRunDuration,
  formatRunStart,
  formatRunTime,
  hasCleanerData,
  isCleaning,
  runRatio,
} from "@/lib/cleaner";
import type { CleanerRun, CleanerSummary } from "@/lib/types";

function run(startedAt: string, minutes: number, running = false): CleanerRun {
  return {
    started_at: startedAt,
    ended_at: running ? null : startedAt,
    duration_minutes: minutes,
    running,
  };
}

function summary(overrides: Partial<CleanerSummary> = {}): CleanerSummary {
  return {
    current: {
      event: "charging",
      label: "充電中",
      since: "2026-08-22T15:04:00",
      battery: 92,
    },
    last_run: run("2026-08-22T14:32:00", 32),
    recent_runs: [run("2026-08-22T14:32:00", 32), run("2026-08-20T09:05:00", 41)],
    this_month: { count: 12, average_minutes: 34, start: "2026-08-01" },
    days_since_previous_run: 2,
    last_seen_at: "2026-08-22T15:35:00",
    stale: false,
    now: "2026-08-22T15:35:00",
    ...overrides,
  };
}

describe("formatRunStart", () => {
  it("同じ日なら「今日」と出す", () => {
    expect(formatRunStart("2026-08-22T14:32:00", "2026-08-22T15:35:00")).toBe(
      "今日 14:32"
    );
  });

  it("前日なら「昨日」と出す（月をまたいでも）", () => {
    expect(formatRunStart("2026-07-31T09:05:00", "2026-08-01T10:00:00")).toBe(
      "昨日 9:05"
    );
  });

  it("それより前は日付を出す", () => {
    expect(formatRunStart("2026-08-20T09:05:00", "2026-08-22T15:35:00")).toBe(
      "8/20 9:05"
    );
  });

  it("サーバーの日時はタイムゾーン変換に通さない", () => {
    // JST の naive な日時をそのまま読む。端末の時計が UTC でも 14:32 のまま
    expect(formatRunStart("2026-08-22T00:30:00", "2026-08-22T09:00:00")).toBe(
      "今日 0:30"
    );
  });
});

describe("formatMinutes", () => {
  it("1時間を超える稼働は時間と分に分ける", () => {
    expect(formatMinutes(32)).toBe("32分");
    expect(formatMinutes(60)).toBe("1時間");
    expect(formatMinutes(65)).toBe("1時間5分");
    expect(formatMinutes(null)).toBe("—");
  });
});

describe("formatRunDuration", () => {
  it("動いている最中は経過だと分かるようにする", () => {
    expect(formatRunDuration(run("2026-08-22T14:32:00", 12, true))).toBe("12分経過");
    expect(formatRunDuration(run("2026-08-22T14:32:00", 32))).toBe("32分");
  });
});

describe("formatRunDay / formatRunTime", () => {
  it("曜日つきの日付と時刻を出す", () => {
    expect(formatRunDay("2026-08-22T14:32:00")).toBe("8/22 (土)");
    expect(formatRunTime("2026-08-22T09:05:00")).toBe("9:05");
  });
});

describe("runRatio", () => {
  it("いちばん長い稼働を1とした比になる", () => {
    const runs = [run("a", 40), run("b", 20)];
    expect(runRatio(runs, runs[0])).toBe(1);
    expect(runRatio(runs, runs[1])).toBe(0.5);
  });

  it("0分の稼働でも棒が消えないよう下限を持つ", () => {
    const runs = [run("a", 40), run("b", 0)];
    expect(runRatio(runs, runs[1])).toBeGreaterThan(0);
  });

  it("全部0分なら棒を出さない", () => {
    const runs = [run("a", 0)];
    expect(runRatio(runs, runs[0])).toBe(0);
  });
});

describe("hasCleanerData / isCleaning", () => {
  it("1度も受け取っていなければ中身なしとみなす", () => {
    expect(hasCleanerData(null)).toBe(false);
    expect(
      hasCleanerData(summary({ current: null, last_run: null, recent_runs: [] }))
    ).toBe(false);
    expect(hasCleanerData(summary())).toBe(true);
  });

  it("掃除中かどうかを状態から判定する", () => {
    expect(isCleaning(summary())).toBe(false);
    expect(
      isCleaning(
        summary({
          current: {
            event: "cleaning",
            label: "掃除中",
            since: "2026-08-22T14:32:00",
            battery: 78,
          },
        })
      )
    ).toBe(true);
  });
});

describe("formatMonthlyRuns", () => {
  it("回数と平均を1行にまとめる", () => {
    expect(formatMonthlyRuns(summary())).toBe("今月 12回 ・ 平均 34分");
  });

  it("まだ終わった稼働が無ければ回数だけ出す", () => {
    expect(
      formatMonthlyRuns(
        summary({ this_month: { count: 1, average_minutes: null, start: "2026-08-01" } })
      )
    ).toBe("今月 1回");
  });

  it("1回も動いていない月は言葉で伝える", () => {
    expect(
      formatMonthlyRuns(
        summary({ this_month: { count: 0, average_minutes: null, start: "2026-08-01" } })
      )
    ).toBe("今月はまだ動いていません");
  });
});
