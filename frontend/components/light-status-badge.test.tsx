import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LightStatusBadge,
  LightStatusStrip,
} from "@/components/light-status-badge";
import { resolveDeviceLightStatus } from "@/lib/light-status";
import type { LatestData } from "@/lib/types";

const livingRoom: LatestData = {
  device_id: 1,
  datetime: "2026-08-27 21:34:00",
  temperature: 24.6,
  humidity: 52,
  illuminance: 312,
};

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

/** ダッシュボードと同じ経路で判定結果を作る */
function statusFor(illuminance: number | undefined, threshold: number) {
  const result = resolveDeviceLightStatus(
    { ...livingRoom, illuminance },
    { "1": threshold },
    1
  );
  if (!result) throw new Error("判定できていません");
  return result;
}

describe("LightStatusBadge", () => {
  it("しきい値以上なら点灯と出る", () => {
    const html = render(<LightStatusBadge result={statusFor(312, 80)} />);
    expect(html).toContain("照明 点灯");
    expect(html).not.toContain("照明 消灯");
  });

  it("しきい値を下回れば消灯と出る", () => {
    const html = render(<LightStatusBadge result={statusFor(12, 80)} />);
    expect(html).toContain("照明 消灯");
  });

  it("判定の根拠を title に持たせる（カードには数値を出さない）", () => {
    const html = render(<LightStatusBadge result={statusFor(312, 80)} />);
    expect(html).toContain('title="照度 312 lx ・ しきい値 80 lx"');
    // カードの主役は温度・湿度なので、照度の数値そのものは本文に出さない
    expect(html).not.toContain(">312<");
  });
});

describe("LightStatusStrip", () => {
  it("結論といまの照度・しきい値を並べる", () => {
    const html = render(<LightStatusStrip result={statusFor(312, 80)} />);
    expect(html).toContain("照明は点灯中");
    expect(html).toContain("照度 312 lx ・ しきい値 80 lx");
  });

  it("消灯のときは点灯の色を使わない", () => {
    const html = render(<LightStatusStrip result={statusFor(12, 80)} />);
    expect(html).toContain("照明は消灯中");
    expect(html).not.toContain("--remote-color");
  });
});
