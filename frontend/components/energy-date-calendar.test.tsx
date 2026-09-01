import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EnergyDateCalendar } from "@/components/energy-date-calendar";

const noop = () => {};

function render(value: string, today: string | null) {
  return renderToStaticMarkup(
    <EnergyDateCalendar value={value} today={today} onSelect={noop} onClose={noop} />
  );
}

/** その日のマスの `<button ...>` だけを取り出す。中身は日にちの数字だけ */
function dayButton(html: string, day: number): string {
  const found = html
    .split("<button")
    .slice(1)
    .map((part) => `<button${part.split("</button>")[0]}`)
    .find((button) => button.endsWith(`>${day}`));
  if (!found) throw new Error(`${day}日のマスが見つからない`);
  return found;
}

function labeledButton(html: string, label: string): string {
  const found = html
    .split("<button")
    .slice(1)
    .map((part) => `<button${part.split("</button>")[0]}`)
    .find((button) => button.includes(`aria-label="${label}"`));
  if (!found) throw new Error(`${label}のボタンが見つからない`);
  return found;
}

describe("EnergyDateCalendar", () => {
  it("選択中の日の月を開き、その月のマスを並べる", () => {
    const html = render("2026-09-02", "2026-09-02");
    expect(html).toContain("2026年9月");
    expect(dayButton(html, 30)).toBeTruthy();
    // 前後の月の日付は出さないので、31日のマスは無い（9月は30日まで）
    expect(() => dayButton(html, 31)).toThrow();
  });

  it("今日より後の日は押せない（`disabled=\"\"` で照合する）", () => {
    const html = render("2026-09-02", "2026-09-02");
    expect(dayButton(html, 3)).toContain('disabled=""');
    expect(dayButton(html, 1)).not.toContain('disabled=""');
    expect(dayButton(html, 2)).toContain('aria-current="date"');
  });

  it("今日を含む月から先へは送れない", () => {
    const sameMonth = render("2026-09-02", "2026-09-02");
    expect(labeledButton(sameMonth, "次の月")).toContain('disabled=""');
    // 過去の月を開いているあいだは送れる
    const pastMonth = render("2026-07-10", "2026-09-02");
    expect(labeledButton(pastMonth, "次の月")).not.toContain('disabled=""');
    expect(pastMonth).toContain("2026年7月");
  });

  it("今日が取れていないときは「今日」を押せず、未来の判定もしない", () => {
    const html = render("2026-09-02", null);
    expect(dayButton(html, 30)).not.toContain('disabled=""');
    const todayButton = html
      .split("<button")
      .slice(1)
      .map((part) => `<button${part.split("</button>")[0]}`)
      .find((button) => button.endsWith(">今日"));
    expect(todayButton).toContain('disabled=""');
  });
});
