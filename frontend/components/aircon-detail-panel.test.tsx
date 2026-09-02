import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AirconDetailPanel } from "@/components/aircon-detail-panel";
import { buildDefaultChartLineVisibility } from "@/lib/chart-line-visibility";
import { AIRCON_CHART_DEVICE_ID, type AirconData } from "@/lib/types";

const noop = () => {};
const lineVisibility = buildDefaultChartLineVisibility([AIRCON_CHART_DEVICE_ID]);
const latest: AirconData = {
  ac_id: 1,
  power: "ON",
  mode: "COOLING",
  target_temperature: 26,
};

function render(props: Partial<Parameters<typeof AirconDetailPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <AirconDetailPanel
      open
      title="リビング"
      acId={1}
      latest={latest}
      controllable
      chartColors={{}}
      lineVisibility={lineVisibility}
      onClose={noop}
      onOpenControl={noop}
      {...props}
    />
  );
}

describe("AirconDetailPanel", () => {
  it("閉じているときは何も描かない", () => {
    expect(render({ open: false })).toBe("");
  });

  it("操作できるときはリモコン操作ボタンと運転状態を出す", () => {
    const html = render();
    expect(html).toContain("エアコンを操作");
    expect(html).toContain("冷房");
    expect(html).toContain("26.0");
  });

  it("操作できないとき（ログイン情報なし・オフライン）はボタンごと出さない", () => {
    const html = render({ controllable: false });
    expect(html).not.toContain("エアコンを操作");
  });

  it("タイトルをそのまま見出しに出す", () => {
    const html = render({ title: "寝室" });
    expect(html).toContain("寝室");
  });
});
