"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase-client";

function getInitialError(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("authError") === "forbidden"
    ? "このGoogleアカウントではログインできません"
    : "";
}

export function LoginScreen() {
  const [error, setError] = useState(getInitialError);

  const handleClick = async () => {
    setError("");
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (signInError) {
      setError("Googleログインに失敗しました");
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm rounded-[20px] border-0 bg-card shadow-none">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted">
            <Lock className="size-6 text-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold">MyRoom</CardTitle>
          <CardDescription>お部屋の状態をモニタリング</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center">
            <Button onClick={handleClick}>Googleでログイン</Button>
          </div>
          {error && (
            <p className={cn("rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive")}>
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
