"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AppLoadingScreen } from "@/components/app-loading-screen";
import { authHeaders } from "@/lib/auth";
import { supabase } from "@/lib/supabase-client";

export default function AuthCallbackPage() {
  const router = useRouter();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    (async () => {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          router.replace("/?authError=forbidden");
          return;
        }
      }

      const res = await fetch("/api/auth/me", { headers: await authHeaders() });
      if (!res.ok) {
        await supabase.auth.signOut();
        router.replace("/?authError=forbidden");
        return;
      }

      router.replace("/");
    })();
  }, [router]);

  // 何も描かないと真っ白な画面になる。ホームと同じ読み込み画面でつなぐ（#250）
  return <AppLoadingScreen label="ログインしています" />;
}
