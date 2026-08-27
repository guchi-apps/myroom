import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppSettingsSheet } from "@/components/app-settings-sheet";
import { APP_VERSION } from "@/lib/app-version";

function render(open: boolean) {
  return renderToStaticMarkup(
    <AppSettingsSheet
      open={open}
      onClose={() => {}}
      onReload={() => {}}
      onLogout={() => {}}
      onOpenVersionHistory={() => {}}
    />
  );
}

describe("AppSettingsSheet", () => {
  it("閉じているときは何も出さない", () => {
    expect(render(false)).toBe("");
  });

  it("フッターから移した3つをすべて出す", () => {
    const html = render(true);
    expect(html).toContain("アプリを再読み込み");
    expect(html).toContain("ログアウト");
    expect(html).toContain(`バージョン ${APP_VERSION}`);
    expect(html).toContain("更新履歴");
  });

  it("再読み込みが「表示が崩れたとき用」だと分かる説明を添える", () => {
    // バージョンの取り込みは app-update-checker が自動で行うため、
    // ここを押さないと更新されないと誤解させない（#277）
    expect(render(true)).toContain("新しいバージョンは自動で入ります");
  });

  it("ログアウトの赤はテーマのトークンを使う", () => {
    // 以前はベタ書きの #e74c3c で、ライトテーマと揃っていなかった
    const html = render(true);
    expect(html).toContain("text-destructive");
    expect(html).not.toContain("#e74c3c");
  });
});
