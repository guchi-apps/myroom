"use client";

import { useState } from "react";
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google";
import { Lock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

interface LoginScreenProps {
  onLogin: (credential: string) => Promise<boolean>;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [error, setError] = useState("");

  const handleSuccess = async (credential: string) => {
    setError("");
    if (!(await onLogin(credential))) {
      setError("このGoogleアカウントではログインできません");
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
            {GOOGLE_CLIENT_ID ? (
              <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
                <GoogleLogin
                  onSuccess={(response) => {
                    if (response.credential) {
                      void handleSuccess(response.credential);
                    }
                  }}
                  onError={() => setError("Googleログインに失敗しました")}
                />
              </GoogleOAuthProvider>
            ) : (
              <p className="text-sm text-muted-foreground">
                Googleログインが設定されていません
              </p>
            )}
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
