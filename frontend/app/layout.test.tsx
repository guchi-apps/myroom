import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8");

describe("iOS PWAの安全領域", () => {
  it("viewportを画面端まで広げて透過ステータスバーを使う", () => {
    expect(source).toContain('statusBarStyle: "black-translucent"');
    expect(source).toContain('viewportFit: "cover"');
  });

  it("上端をヘッダー色で覆い、コンテンツを安全領域の下へ配置する", () => {
    expect(source).toContain("bg-header-band pt-[env(safe-area-inset-top)]");
    expect(source).toContain("min-h-[calc(100vh-env(safe-area-inset-top))]");
  });
});
