import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginScreen } from "@/components/login-screen";

describe("LoginScreen", () => {
  it("アプリアイコンとGoogleログインのボタンを出す", () => {
    const html = renderToStaticMarkup(<LoginScreen />);
    expect(html).toContain('alt="MyRoom"');
    expect(html).toContain("Googleでログイン");
  });

  it("読み込み中のプログレスバーは出さない", () => {
    const html = renderToStaticMarkup(<LoginScreen />);
    expect(html).not.toContain('role="progressbar"');
  });

  it("読み込み画面とアイコン・アプリ名の位置を揃える", () => {
    const html = renderToStaticMarkup(<LoginScreen />);
    // 切り替わったときに要素が飛び跳ねないよう、下段のブロックの高さを固定している
    expect(html).toContain("min-h-[96px]");
  });
});
