"use client";

import "./globals.css";
import { useEffect, useState } from "react";
import { AppEntryScreen } from "@/components/app-entry-screen";
import { AppLoadingScreen } from "@/components/app-loading-screen";
import { canAutoReloadForChunkError, reloadForChunkError } from "@/lib/chunk-reload";

/** 自動で読み込み直したのに画面が変わらないとき、ボタンへ切り替えるまでの時間 */
const RETRY_FALLBACK_MS = 8000;

/**
 * 描画中の例外を受け止める最後の境界（#450）。
 *
 * これが無いと、Next.js 既定の「Application error: a client-side exception has occurred」の
 * 白い画面になり、PWA では再読み込みの手段も無い。デプロイの途中に開いて
 * JSチャンクが404になったときに実際に出ていた。
 *
 * - チャンクの読み込み失敗なら、読み込み画面を出して1回だけ読み込み直す
 * - それ以外・読み込み直しても失敗したときは、起動画面と同じ配置で再読み込みボタンを出す
 *
 * ルートレイアウトごと差し替わるため `<html>`・`<body>` とCSSをここで持つ。
 * `ThemeProvider` の外なのでダークテーマは効かない（ライトの配色で出る）。
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  // 判定は最初の描画で1度だけ行う（読み込み直す時刻の書き込みは effect 側）
  const [autoReload] = useState(() => canAutoReloadForChunkError(error));
  const [showRetry, setShowRetry] = useState(!autoReload);

  useEffect(() => {
    console.error(error);
    if (!autoReload) return;
    reloadForChunkError();
    // 読み込み直せなかった・戻ってこないときに読み込み画面のまま止まらないよう、
    // しばらく待ってボタンへ切り替える
    const timer = window.setTimeout(() => setShowRetry(true), RETRY_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [error, autoReload]);

  return (
    <html lang="ja">
      <body className="min-h-screen">
        {!showRetry ? (
          <AppLoadingScreen label="新しいバージョンを読み込んでいます" />
        ) : (
          <AppEntryScreen>
            <p className="text-[13px] tracking-wide text-muted-foreground">
              画面を表示できませんでした
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-full bg-foreground px-5 py-2 text-[13px] font-bold text-background"
            >
              再読み込み
            </button>
          </AppEntryScreen>
        )}
      </body>
    </html>
  );
}
