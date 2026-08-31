import { describe, expect, it } from "vitest";

import {
  buildCleaningRows,
  buildCleaningTodo,
  formatCleaningCountdown,
  formatCleaningDateWithWeekday,
  formatCleaningInterval,
  formatHistoryAge,
  formatLastDone,
  formatMarkDoneLabel,
  formatRecordedAt,
  isSelectableDoneDate,
  shiftDate,
  toCleaningTaskInput,
  visibleHistory,
  type CleaningHistoryEntry,
  type CleaningSchedule,
  type CleaningTask,
} from "@/lib/cleaning";

const TODAY = "2026-08-26";

/** 履歴の1件。登録日時を指定しない場合は古い記録（未記録）として扱う */
function entry(date: string, recordedAt: string | null = null): CleaningHistoryEntry {
  return { date, recorded_at: recordedAt };
}

function task(overrides: Partial<CleaningTask> & { id: string; name: string }): CleaningTask {
  return {
    interval_days: 7,
    steps: [],
    history: [],
    last_done: null,
    next_due: TODAY,
    days_until: 0,
    status: "today",
    ...overrides,
  };
}

const SCHEDULE: CleaningSchedule = {
  today: TODAY,
  configured: true,
  tasks: [
    task({ id: "bath", name: "お風呂", next_due: "2026-08-31", days_until: 5, status: "upcoming" }),
    task({ id: "fan", name: "換気扇まわり", next_due: "2026-08-24", days_until: -2, status: "overdue" }),
    task({ id: "sink", name: "キッチンのシンク", next_due: TODAY, days_until: 0, status: "today" }),
    task({ id: "floor", name: "床", next_due: "2026-08-31", days_until: 5, status: "upcoming" }),
  ],
};

describe("buildCleaningTodo", () => {
  it("期限を過ぎたものと今日が期限のものだけを、遅れが大きい順に返す", () => {
    expect(buildCleaningTodo(SCHEDULE).map((entry) => entry.id)).toEqual(["fan", "sink"]);
  });

  it("やることが無ければ空になる", () => {
    const none = { ...SCHEDULE, tasks: SCHEDULE.tasks.filter((entry) => entry.status === "upcoming") };
    expect(buildCleaningTodo(none)).toEqual([]);
  });
});

describe("buildCleaningRows", () => {
  it("次にやる日が近い順に並べ、同じ日は名前順にする", () => {
    expect(buildCleaningRows(SCHEDULE).map((entry) => entry.id)).toEqual([
      "fan",
      "sink",
      "bath",
      "floor",
    ]);
  });

  it("元の配列を書き換えない", () => {
    const before = SCHEDULE.tasks.map((entry) => entry.id);
    buildCleaningRows(SCHEDULE);
    expect(SCHEDULE.tasks.map((entry) => entry.id)).toEqual(before);
  });
});

describe("formatCleaningCountdown", () => {
  it("遅れているときは何日遅れかを出す", () => {
    expect(formatCleaningCountdown(task({ id: "a", name: "a", days_until: -2 }))).toBe("2日遅れ");
  });

  it("今日・明日・それ以降で言い方を変える", () => {
    expect(formatCleaningCountdown(task({ id: "a", name: "a", days_until: 0 }))).toBe("今日");
    expect(formatCleaningCountdown(task({ id: "a", name: "a", days_until: 1 }))).toBe("明日");
    expect(formatCleaningCountdown(task({ id: "a", name: "a", days_until: 9 }))).toBe("あと9日");
  });
});

describe("日付の表示", () => {
  it("曜日を添える", () => {
    expect(formatCleaningDateWithWeekday("2026-08-26")).toBe("8/26(水)");
  });

  it("間隔は1日だけ「毎日」にする", () => {
    expect(formatCleaningInterval(1)).toBe("毎日");
    expect(formatCleaningInterval(3)).toBe("3日に1回");
  });

  it("最後にやった日は経過を添える", () => {
    const done = task({ id: "a", name: "a", last_done: "2026-08-23" });
    expect(formatLastDone(done, TODAY)).toBe("8/23(日)（3日前）");
  });

  it("一度もやっていなければその旨を出す", () => {
    expect(formatLastDone(task({ id: "a", name: "a" }), TODAY)).toBe("まだ記録がありません");
  });

  it("履歴の経過は今日・昨日を言葉にする", () => {
    expect(formatHistoryAge(TODAY, TODAY)).toBe("今日");
    expect(formatHistoryAge("2026-08-25", TODAY)).toBe("昨日");
    expect(formatHistoryAge("2026-08-20", TODAY)).toBe("6日前");
  });
});

describe("visibleHistory", () => {
  it("直近3件だけを出す", () => {
    const withHistory = task({
      id: "a",
      name: "a",
      history: ["2026-08-23", "2026-08-20", "2026-08-17", "2026-08-14"].map((date) =>
        entry(date)
      ),
    });
    expect(visibleHistory(withHistory).map((item) => item.date)).toEqual([
      "2026-08-23",
      "2026-08-20",
      "2026-08-17",
    ]);
  });
});

describe("formatRecordedAt", () => {
  it("掃除した日と登録した日が違う行にだけ出す", () => {
    expect(
      formatRecordedAt({ date: "2026-08-25", recorded_at: "2026-08-26T09:15:00+09:00" })
    ).toBe("登録: 8/26 9:15");
  });

  it("その場で押した記録には出さない", () => {
    expect(
      formatRecordedAt({ date: "2026-08-26", recorded_at: "2026-08-26T09:15:00+09:00" })
    ).toBeNull();
  });

  it("登録日時が残っていない古い記録には出さない", () => {
    expect(formatRecordedAt({ date: "2026-08-25", recorded_at: null })).toBeNull();
  });
});

describe("shiftDate", () => {
  it("月をまたいでも1日ずれない", () => {
    expect(shiftDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("formatMarkDoneLabel", () => {
  it("今日なら日付を出さず、過去日なら日付を出す", () => {
    expect(formatMarkDoneLabel(TODAY, TODAY)).toBe("今日 掃除した");
    expect(formatMarkDoneLabel("2026-08-25", TODAY)).toBe("8/25 に掃除した");
  });
});

describe("isSelectableDoneDate", () => {
  it("今日と過去は選べる", () => {
    expect(isSelectableDoneDate(TODAY, TODAY)).toBe(true);
    expect(isSelectableDoneDate("2026-08-25", TODAY)).toBe(true);
  });

  it("未来と、さかのぼりすぎは選べない", () => {
    expect(isSelectableDoneDate("2026-08-27", TODAY)).toBe(false);
    expect(isSelectableDoneDate("2026-01-01", TODAY)).toBe(false);
  });
});

describe("toCleaningTaskInput", () => {
  it("間隔を範囲へ丸め、空の手順を落とす", () => {
    expect(
      toCleaningTaskInput({ id: "a", name: " トイレ ", interval_days: "0", steps: ["洗う", "  "] })
    ).toEqual({ id: "a", name: "トイレ", interval_days: 1, steps: ["洗う"] });
  });

  it("数値でない間隔は7日に倒す", () => {
    expect(toCleaningTaskInput({ name: "床", interval_days: "", steps: [] }).interval_days).toBe(7);
  });
});
