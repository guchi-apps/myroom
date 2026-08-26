import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RemoteButtonSettingsSheet } from "@/components/remote-button-settings-sheet";
import type { RemoteButtons } from "@/lib/remote";

const buttons: RemoteButtons = {
  configured: true,
  groups: [
    {
      id: "d-light",
      name: "リビングの照明",
      buttons: [
        { id: "l-on", label: "つける", default_label: "点ける" },
        { id: "l-off", label: "消す", default_label: "消す", hidden: true },
      ],
    },
    {
      id: "d-tv",
      name: "テレビ",
      buttons: [{ id: "s-power", label: "電源", default_label: "電源" }],
    },
  ],
};

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

const noop = () => {};
const noopSave = async () => {};

describe("RemoteButtonSettingsSheet", () => {
  it("登録の入り口と、グループごとの編集を出す", () => {
    const html = render(
      <RemoteButtonSettingsSheet onClose={noop} buttons={buttons} onSave={noopSave} />
    );

    expect(html).toContain("Nature Remo から選ぶ");
    // グループ名は書き換えられるので、見出しではなく入力欄に入る
    expect(html).toContain('value="リビングの照明"');
    expect(html).toContain('value="テレビ"');
    // 付けた名前は入力欄、もとの名前はプレースホルダ
    expect(html).toContain('value="つける"');
    expect(html).toContain('placeholder="点ける"');
  });

  it("隠したボタンも一覧に残す（設定画面からしか戻せないため）", () => {
    const html = render(
      <RemoteButtonSettingsSheet onClose={noop} buttons={buttons} onSave={noopSave} />
    );
    expect(html).toContain("消すをダッシュボードに出す");
    expect(html).toContain("ダッシュボードには2件出ます（全3件中）");
  });

  it("登録を外すボタンと、グループの並び替えを出す", () => {
    const html = render(
      <RemoteButtonSettingsSheet onClose={noop} buttons={buttons} onSave={noopSave} />
    );
    expect(html).toContain("点けるを登録から外す");
    expect(html).toContain("テレビを上へ");
    expect(html).toContain("リビングの照明を下へ");
  });

  it("1つも登録が無いときは、登録の仕方だけを案内する", () => {
    const html = render(
      <RemoteButtonSettingsSheet
        onClose={noop}
        buttons={{ configured: false, groups: [] }}
        onSave={noopSave}
      />
    );
    expect(html).toContain("まだボタンがありません");
    expect(html).toContain("Nature Remo から選ぶ");
    // 手編集ファイルの案内はもう出さない（#262）
    expect(html).not.toContain("data/remote.json");
  });
});
