import { describe, expect, it } from "vitest";
import { resolveAuthGate } from "@/lib/use-auth";

describe("resolveAuthGate", () => {
  it("ログイン状態が判定中のあいだはログイン画面を出さない", () => {
    expect(resolveAuthGate(null)).toBe("loading");
    expect(resolveAuthGate(null, true)).toBe("loading");
    expect(resolveAuthGate(null, false)).toBe("loading");
  });

  it("未ログインと確定したらログイン画面を出す", () => {
    expect(resolveAuthGate(false)).toBe("login");
    expect(resolveAuthGate(false, true)).toBe("login");
  });

  it("ログイン済みでも初期読み込みが終わるまでは読み込み画面のまま", () => {
    expect(resolveAuthGate(true, false)).toBe("loading");
  });

  it("ログイン済みで初期読み込みが終わったら本体を出す", () => {
    expect(resolveAuthGate(true, true)).toBe("ready");
    expect(resolveAuthGate(true)).toBe("ready");
  });
});
