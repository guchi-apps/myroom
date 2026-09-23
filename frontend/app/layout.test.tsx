import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8");
const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
const manifest = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "public/manifest.json"), "utf8"),
) as { theme_color: string };

describe("iOS PWAの安全領域", () => {
  it("viewportを画面端まで広げて透過ステータスバーを使う", () => {
    expect(source).toContain('statusBarStyle: "black-translucent"');
    expect(source).toContain('viewportFit: "cover"');
  });

  it("上端をヘッダー色で覆い、コンテンツを安全領域の下へ配置する", () => {
    expect(source).toContain("bg-header-band pt-[env(safe-area-inset-top)]");
    expect(source).toContain("min-h-[calc(100vh-env(safe-area-inset-top))]");
  });

  it("スクロールしても動かない帯で安全領域を塞ぐ（#478）", () => {
    expect(source).toContain(
      "pointer-events-none fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)] bg-header-band",
    );
  });

  it("ページの下地をヘッダー色にして、上端のぼかしに灰色を混ぜない（#478）", () => {
    expect(source).toContain("min-h-screen bg-header-band`}");
    expect(css).toMatch(/html\s*\{\s*@apply bg-header-band;/);
  });

  it("背景の描画されない要素でWebKitに固定ヘッダーの実在を認識させる（#482）", () => {
    expect(source).toContain(
      "pointer-events-none fixed inset-x-0 top-0 z-40 h-[11px] bg-header-band [background-clip:text]",
    );
  });

  it("theme-colorとマニフェストをヘッダーの帯の色に揃える（#478）", () => {
    const light = css.match(/:root\s*\{[^}]*--header-band:\s*(#[0-9a-f]{6})/)?.[1];
    const dark = css.match(/\.dark\s*\{[^}]*--header-band:\s*(#[0-9a-f]{6})/)?.[1];
    expect(light).toBeDefined();
    expect(dark).toBeDefined();
    expect(source).toContain(`media: "(prefers-color-scheme: light)", color: "${light}"`);
    expect(source).toContain(`media: "(prefers-color-scheme: dark)", color: "${dark}"`);
    expect(manifest.theme_color).toBe(light);
  });
});
