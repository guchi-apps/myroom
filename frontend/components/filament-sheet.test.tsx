import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilamentSheet } from "@/components/filament-sheet";
import { makePayload, makeSpool } from "@/lib/filament-fixtures";
import type { FilamentPayload } from "@/lib/filament";

const noop = () => {};

function render(payload: FilamentPayload, suggestedNote: string | null = null) {
  return renderToStaticMarkup(
    <FilamentSheet payload={payload} suggestedNote={suggestedNote} onChange={noop} onClose={noop} />
  );
}

const grey = makeSpool({
  id: "s2",
  name: "ELEGOO PLA (グレー)",
  color: "#8C8F94",
  active: false,
  remaining_g: 859,
  percent: 86,
  weighings: [],
  usages: [],
  base: { kind: "weighing", gross_g: 1011, net_g: 859, date: "2026-08-10" },
  used_since_g: 0,
  used_since_count: 0,
});

const charcoal = makeSpool({
  id: "s3",
  name: "Bambu Lab PLA Matte (チャコール)",
  active: false,
  archived: true,
  remaining_g: 0,
  percent: 0,
  level: "empty",
});

describe("FilamentSheet", () => {
  it("題名に使用中のスプールを添え、一覧に残量と割合を出す", () => {
    const html = render(makePayload([makeSpool(), grey]));
    expect(html).toContain("フィラメント在庫");
    expect(html).toContain("使用中: ELEGOO PLA (ホワイト)");
    expect(html).toContain("391 g");
    expect(html).toContain("859 g");
    expect(html).toContain("86%");
    expect(html).toContain("使用中</span>");
  });

  it("使用中のスプールは開いた状態で、残量の内訳と操作を出す", () => {
    const html = render(makePayload([makeSpool(), grey]));
    expect(html).toContain("最後の計量（9/14）全体");
    expect(html).toContain("− 空スプール");
    expect(html).toContain("使用量を記録");
    expect(html).toContain("計量して合わせる");
    expect(html).toContain("benchy");
    expect(html).toContain("−42 g");
    expect(html).toContain("計量に反映済み");
  });

  it("使用中以外には「これを使う」を出し、使用中には出さない", () => {
    const html = render(makePayload([makeSpool(), grey]));
    expect(html.match(/これを使う/g)).toHaveLength(1);
  });

  it("使い切りは折りたたんで本数だけ出す", () => {
    const html = render(makePayload([makeSpool(), charcoal]));
    expect(html).toContain("使い切ったスプール 1本");
    expect(html).not.toContain("Bambu Lab PLA Matte");
  });

  it("スプールが1本も無いときは追加フォームを開いて出す", () => {
    const html = render(makePayload([]));
    expect(html).toContain("使用中のスプールはありません");
    expect(html).toContain("初期フィラメント量（g）");
    expect(html).toContain("空スプールの重さ（g）");
    expect(html).toContain("いまの全体重量");
    expect(html).toContain("追加する");
  });

  it("数値の入力欄は変更のたびに保存しない下書きで、入力中は無効にしない", () => {
    const html = render(makePayload([]));
    expect(html).not.toContain('type="number"');
    expect(html).not.toContain('disabled=""');
  });

  it("閉じる操作がある", () => {
    expect(render(makePayload())).toContain('aria-label="閉じる"');
  });
});
