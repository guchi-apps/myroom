import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EnergySourceNameSheet,
  buildEnergyNameDrafts,
  buildEnergyNameUpdate,
} from "@/components/energy-source-name-sheet";
import { pickRenamableEnergySources } from "@/lib/energy";
import type { EnergySourceRow } from "@/lib/types";

function row(overrides: Partial<EnergySourceRow> = {}): EnergySourceRow {
  return {
    source: "tapo:冷蔵庫",
    label: "冷蔵庫",
    default_label: "冷蔵庫",
    today_kwh: 0.46,
    today_cost_yen: 14.3,
    power_w: 38.2,
    this_month_kwh: 12.4,
    latest_date: "2026-08-22",
    ...overrides,
  };
}

function render(sources: EnergySourceRow[]) {
  return renderToStaticMarkup(
    <EnergySourceNameSheet
      sources={sources}
      colors={{ "tapo:冷蔵庫": "#3498db", "tapo:テレビ": "#9b59b6" }}
      onClose={() => {}}
      onSave={async () => {}}
    />
  );
}

describe("buildEnergyNameDrafts", () => {
  it("既定の名前のままなら空にする", () => {
    expect(buildEnergyNameDrafts([row()])).toEqual({ "tapo:冷蔵庫": "" });
  });

  it("別名が付いていればその名前を入れる", () => {
    const drafts = buildEnergyNameDrafts([row({ label: "キッチンの冷蔵庫" })]);
    expect(drafts).toEqual({ "tapo:冷蔵庫": "キッチンの冷蔵庫" });
  });
});

describe("buildEnergyNameUpdate", () => {
  it("空欄の取得元はキーごと落とす", () => {
    const update = buildEnergyNameUpdate({
      "tapo:冷蔵庫": "キッチンの冷蔵庫",
      "tapo:テレビ": "",
      "tapo:デスク": "   ",
    });
    expect(update).toEqual({ "tapo:冷蔵庫": "キッチンの冷蔵庫" });
  });
});

describe("pickRenamableEnergySources", () => {
  it("スマートプラグだけを残す", () => {
    const sources = [
      row({ source: "aircon", label: "エアコン", default_label: "エアコン" }),
      row(),
      row({ source: "kepco_other", label: "その他", default_label: "その他" }),
    ];
    expect(pickRenamableEnergySources(sources).map((item) => item.source)).toEqual([
      "tapo:冷蔵庫",
    ]);
  });
});

describe("EnergySourceNameSheet", () => {
  it("取得元ごとに、既定の名前と source を出す", () => {
    const html = render([row(), row({ source: "tapo:テレビ", label: "テレビ", default_label: "テレビ" })]);
    expect(html).toContain("Tapoの名前: 冷蔵庫");
    expect(html).toContain("tapo:テレビ");
    expect(html).toContain("スマートプラグ 2 台");
  });

  it("別名が付いている行にだけ「既定に戻す」を出す", () => {
    const overridden = render([row({ label: "キッチンの冷蔵庫" })]);
    expect(overridden).toContain("既定に戻す");
    expect(render([row()])).not.toContain("既定に戻す");
  });

  it("取得元が無ければ案内を出し、保存を押せなくする", () => {
    const html = render([]);
    expect(html).toContain("名前を変えられるスマートプラグがありません");
    // Tailwind のバリアント（disabled:opacity-50）が class に入るため、属性の形で照合する（#269）
    expect(html).toContain('disabled=""');
  });
});
