import { supabase } from "@/lib/supabase-client";

export class AuthError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthError";
  }
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * このアプリのセッションだけを破棄する（他アプリ・他端末には影響しない）。
 *
 * **Supabase の `signOut` を scope なしで呼ばないこと（#426）。** Supabase Auth の既定 scope は
 * `global` で、同じユーザーの全セッション（同じSupabaseプロジェクトを共有する他アプリ・他端末）の
 * refresh token まで失効させる。このアプリのログアウトや401時の破棄は `local` で足りる。
 */
export async function signOutThisApp(): Promise<void> {
  await supabase.auth.signOut({ scope: "local" });
}

export async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
