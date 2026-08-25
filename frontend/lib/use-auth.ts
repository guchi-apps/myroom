"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";

/** 起動直後に出す画面の種類 */
export type AuthGate = "loading" | "login" | "ready";

/**
 * 表示する画面を決める。
 * `isAuthenticated`が`null`（判定中）のあいだにログイン画面を出すと、ログイン済みでも
 * 起動のたびに一瞬ログイン画面が見えてしまう（#250）。判定中は読み込み画面に倒す。
 *
 * @param isAuthenticated 判定中は`null`
 * @param appReady ログイン後の初期読み込み（デバイス一覧・表示設定）が終わっているか
 */
export function resolveAuthGate(
  isAuthenticated: boolean | null,
  appReady: boolean = true
): AuthGate {
  if (isAuthenticated == null) return "loading";
  if (!isAuthenticated) return "login";
  return appReady ? "ready" : "loading";
}

export function useAuthState() {
  // `null`は判定中。`false`（未ログイン）で始めるとログイン画面が一瞬描かれる（#250）
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setIsAuthenticated(data.session != null);
      })
      // 判定できないまま`null`で固まると、プログレスバーが回り続ける画面から抜けられない。
      // オフライン起動でも踏むため、失敗したら未ログインに倒してログイン画面を出す（#250）
      .catch(() => {
        setIsAuthenticated(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(session != null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { isAuthenticated, setIsAuthenticated };
}
