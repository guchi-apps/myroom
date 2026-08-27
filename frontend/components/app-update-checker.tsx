"use client";

import { useEffect, useRef, useState } from "react";
import { AppLoadingScreen } from "@/components/app-loading-screen";
import { APP_VERSION } from "@/lib/app-version";

/** 開きっぱなしのセッション向けの定期チェック間隔 */
const POLL_INTERVAL_MS = 10 * 60 * 1000;

/** ビルド時に `out/version.json` へ書き出される（`scripts/sync-sw-cache.mjs`） */
const VERSION_ENDPOINT = "/version.json";

/**
 * 新しいバージョンを自分で見つけて取り込む（#277）。
 *
 * ホーム画面から起動したPWAは、ブラウザで開き直さない限り新しいビルドに気付けない。
 * 以前はフッターの「画面再読み込み」を人が押して解決していたが、押すべきタイミングが
 * 画面から分からなかった。issue-deck の `app-update-checker.tsx` と同じ形にする。
 *
 * - **バックグラウンドから戻った直後**は操作の途中ではないので、聞かずにリロードする。
 *   ただし無言でやると固まったように見えるため、読み込み画面を出してから実行する
 * - **開きっぱなし**のときは操作中かもしれないので、バナーを出して押されるのを待つ
 *
 * `version.json` は Service Worker のキャッシュ対象から外してある（`public/sw.js`）。
 * 外すのを忘れると古い値を返し続け、永久に更新へ気付けない。
 */
export function AppUpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [reloading, setReloading] = useState(false);
  const checkingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchLatestVersion(): Promise<string | null> {
      if (checkingRef.current) return null;
      checkingRef.current = true;
      try {
        const res = await fetch(VERSION_ENDPOINT, { cache: "no-store" });
        if (!res.ok) return null;
        const data = (await res.json()) as { version?: string };
        return data.version ?? null;
      } catch {
        // オフラインや配信漏れでは黙って何もしない（次の機会に拾えばよい）
        return null;
      } finally {
        checkingRef.current = false;
      }
    }

    async function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      const latest = await fetchLatestVersion();
      if (cancelled || !latest || latest === APP_VERSION) return;
      setReloading(true);
      window.location.reload();
    }

    async function checkForUpdate() {
      const latest = await fetchLatestVersion();
      if (cancelled || !latest || latest === APP_VERSION) return;
      setUpdateAvailable(true);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    const intervalId = window.setInterval(checkForUpdate, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, []);

  if (reloading) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col bg-background">
        <AppLoadingScreen label="新しいバージョンを読み込んでいます" />
      </div>
    );
  }

  if (!updateAvailable) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 flex items-center justify-between gap-3 rounded-2xl bg-foreground px-4 py-3 text-background shadow-lg sm:left-1/2 sm:right-auto sm:w-full sm:max-w-md sm:-translate-x-1/2">
      <p className="text-sm font-medium">新しいバージョンがあります</p>
      <button
        type="button"
        onClick={() => {
          setReloading(true);
          window.location.reload();
        }}
        className="shrink-0 rounded-full bg-background px-4 py-1.5 text-[12.5px] font-bold text-foreground"
      >
        更新する
      </button>
    </div>
  );
}
