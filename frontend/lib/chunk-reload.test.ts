import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  canAutoReloadForChunkError,
  isChunkLoadError,
  reloadForChunkError,
  shouldAutoReload,
} from "./chunk-reload";

describe("isChunkLoadError", () => {
  it("Turbopackのチャンク読み込み失敗を拾う", () => {
    const error = new Error(
      "Failed to load chunk /_next/static/chunks/045c83caa4d15373.js from runtime for chunk"
    );
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("webpackのChunkLoadErrorを拾う", () => {
    const error = new Error("Loading chunk 123 failed.");
    error.name = "ChunkLoadError";
    expect(isChunkLoadError(error)).toBe(true);
    expect(isChunkLoadError(new Error("Loading CSS chunk 4 failed."))).toBe(true);
  });

  it("causeに包まれていても拾う", () => {
    const error = new Error("render failed", {
      cause: new Error("Failed to load chunk /_next/static/chunks/a.js"),
    });
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("ほかの例外は拾わない", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError("Failed to load chunk")).toBe(false);
  });
});

describe("shouldAutoReload", () => {
  const now = 1_000_000_000;

  it("まだ読み込み直していなければ読み込み直す", () => {
    expect(shouldAutoReload(null, now)).toBe(true);
  });

  it("直前に読み込み直していたら止める", () => {
    expect(shouldAutoReload(String(now - 5_000), now)).toBe(false);
  });

  it("しばらく経っていればもう一度読み込み直す", () => {
    expect(shouldAutoReload(String(now - CHUNK_RELOAD_COOLDOWN_MS), now)).toBe(true);
  });

  it("読めない値は無かったものとして扱う", () => {
    expect(shouldAutoReload("abc", now)).toBe(true);
  });
});

describe("canAutoReloadForChunkError / reloadForChunkError", () => {
  const chunkError = new Error("Failed to load chunk /_next/static/chunks/a.js");

  function stubWindow(storage: Partial<Storage>) {
    const reload = vi.fn();
    vi.stubGlobal("window", { sessionStorage: storage, location: { reload } });
    return reload;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("1回読み込み直したら、続けて失敗しても2回目は読み込み直さない", () => {
    const store = new Map<string, string>();
    const reload = stubWindow({
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
    });

    expect(canAutoReloadForChunkError(chunkError)).toBe(true);
    expect(reloadForChunkError()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(canAutoReloadForChunkError(chunkError)).toBe(false);
  });

  it("時刻を残せなければ読み込み直さない（止まらなくなるのを防ぐ）", () => {
    const reload = stubWindow({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });

    expect(reloadForChunkError()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("チャンク以外の例外では読み込み直さない", () => {
    stubWindow({ getItem: () => null });
    expect(canAutoReloadForChunkError(new Error("boom"))).toBe(false);
  });
});
