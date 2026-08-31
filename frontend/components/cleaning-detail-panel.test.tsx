import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CleaningDetailPanel } from "@/components/cleaning-detail-panel";
import type { CleaningHistoryEntry, CleaningTask } from "@/lib/cleaning";

const TODAY = "2026-08-26";

function task(history: CleaningHistoryEntry[] = []): CleaningTask {
  return {
    id: "sink",
    name: "キッチンのシンク",
    interval_days: 3,
    steps: ["排水口のゴミを捨てる"],
    history,
    last_done: history[0]?.date ?? null,
    next_due: "2026-08-28",
    days_until: 2,
    status: "upcoming",
  };
}

const noop = () => {};

function render(history: CleaningHistoryEntry[] = [], busy = false) {
  return renderToStaticMarkup(
    <CleaningDetailPanel
      open
      task={task(history)}
      today={TODAY}
      busy={busy}
      onClose={noop}
      onMarkDone={noop}
      onDeleteDone={noop}
    />
  );
}

describe("CleaningDetailPanel", () => {
  it("掃除した日の初期値は今日で、未来の日は選べない", () => {
    const html = render();
    expect(html).toContain('value="2026-08-26"');
    expect(html).toContain('max="2026-08-26"');
    // 90日前より過去へはさかのぼらせない
    expect(html).toContain('min="2026-05-28"');
  });

  it("初期状態のボタンは今日の記録だと分かる文言になる", () => {
    expect(render()).toContain("今日 掃除した");
  });

  it("記録中はボタンを押せない", () => {
    // Tailwind の disabled: バリアントが class に入るため、属性の形で照合する（#269）
    expect(render([], true)).toContain('disabled=""');
    expect(render([], false)).not.toContain('disabled=""');
  });

  it("後から入れた記録にだけ登録日時を添える", () => {
    const html = render([
      { date: "2026-08-25", recorded_at: "2026-08-26T09:15:00+09:00" },
      { date: "2026-08-22", recorded_at: "2026-08-22T21:40:00+09:00" },
    ]);
    expect(html).toContain("登録: 8/26 9:15");
    expect(html).not.toContain("登録: 8/22");
  });

  it("履歴の各行から記録を取り消せる", () => {
    const html = render([{ date: "2026-08-25", recorded_at: null }]);
    expect(html).toContain("2026-08-25の記録を取り消す");
  });

  it("記録がまだ無いときは履歴の代わりに案内を出す", () => {
    expect(render()).toContain("まだ記録がありません");
  });

  it("選んだ日をすでに記録していたら、もう押せない", () => {
    // 記録した直後の状態。押しても増えないボタンを押せるままにしない
    const html = render([{ date: TODAY, recorded_at: `${TODAY}T09:15:00+09:00` }]);
    expect(html).toContain("この日は記録済み");
    expect(html).toContain('disabled=""');
  });
});
