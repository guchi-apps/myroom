import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LightHistorySection } from "@/components/light-history-section";
import type { LightHistory, LightHistoryEvent } from "@/lib/light-history";

function event(
  datetime: string,
  status: "on" | "off",
  minutes: number,
  extra: Partial<LightHistoryEvent> = {}
): LightHistoryEvent {
  return {
    datetime,
    status,
    duration_minutes: minutes,
    continuing: false,
    daylight: false,
    ...extra,
  };
}

function history(overrides: Partial<LightHistory> = {}): LightHistory {
  return {
    device_id: 1,
    start: "2026-09-06T00:00:00",
    end: "2026-09-06T23:12:00",
    source: { kind: "illuminance", name: "", threshold: 80 },
    segments: [],
    events: [
      event("2026-09-06T17:20:00", "on", 352, { continuing: true }),
      event("2026-09-06T13:40:00", "off", 220),
      event("2026-09-06T11:30:00", "on", 130, { daylight: true }),
    ],
    summary: { on_count: 2, on_minutes: 482 },
    ...overrides,
  };
}

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("LightHistorySection", () => {
  it("照明を紐付けていない場所には何も出さない", () => {
    expect(render(<LightHistorySection history={history({ source: null })} />)).toBe("");
  });

  it("点灯・消灯の時刻と続いた長さを出す", () => {
    const html = render(<LightHistorySection history={history()} />);
    expect(html).toContain("17:20");
    expect(html).toContain("5時間52分");
    expect(html).toContain("点灯");
    expect(html).toContain("消灯");
  });

  it("日中に収まる区間には日射の可能性を添える", () => {
    expect(render(<LightHistorySection history={history()} />)).toContain("日射の可能性");
  });

  it("Nature Remo から読む場合は日射の断りを出さず、操作の経路を案内する", () => {
    const html = render(
      <LightHistorySection
        history={history({
          source: { kind: "remo", name: "洋室照明", threshold: null },
          events: [event("2026-09-06T18:35:00", "on", 277, { continuing: true })],
        })}
      />
    );
    expect(html).toContain("洋室照明");
    expect(html).toContain("アレクサ");
    expect(html).not.toContain("日射");
  });

  it("表示中の範囲に入る行だけを出す", () => {
    const domain: [number, number] = [
      new Date("2026-09-06T15:00:00").getTime(),
      new Date("2026-09-06T23:12:00").getTime(),
    ];
    const html = render(<LightHistorySection history={history()} visibleDomain={domain} />);
    expect(html).toContain("17:20");
    expect(html).not.toContain("11:30");
  });

  it("範囲内に記録が無ければ、その旨を出す", () => {
    const domain: [number, number] = [
      new Date("2026-09-06T01:00:00").getTime(),
      new Date("2026-09-06T02:00:00").getTime(),
    ];
    const html = render(<LightHistorySection history={history()} visibleDomain={domain} />);
    expect(html).toContain("この期間には記録がありません");
  });

  it("期間が日をまたぐときは時刻に日付を添える", () => {
    const html = render(
      <LightHistorySection
        history={history({
          start: "2026-09-05T00:00:00",
          end: "2026-09-06T23:12:00",
          events: [event("2026-09-05T18:10:00", "on", 350)],
        })}
      />
    );
    expect(html).toContain("9/5 18:10");
  });
});
