import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppLoadingScreen } from "@/components/app-loading-screen";

describe("AppLoadingScreen", () => {
  it("アプリアイコンとプログレスバーを出す", () => {
    const html = renderToStaticMarkup(<AppLoadingScreen />);
    expect(html).toContain('alt="MyRoom"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("読み込み中");
  });

  it("ログインを促す文言は出さない", () => {
    const html = renderToStaticMarkup(<AppLoadingScreen />);
    expect(html).not.toContain("Googleでログイン");
  });

  it("表示する文言を差し替えられる", () => {
    const html = renderToStaticMarkup(<AppLoadingScreen label="ログインしています" />);
    expect(html).toContain("ログインしています");
  });
});
