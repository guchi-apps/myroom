"use client";

import { useCallback, useEffect, useState } from "react";
import { loginWithGoogle } from "@/lib/api";
import { isAuthenticated as hasStoredAuthToken } from "@/lib/auth";

export function useAuthState() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (hasStoredAuthToken()) {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = useCallback(async (credential: string) => {
    const ok = await loginWithGoogle(credential);
    if (ok) {
      setIsAuthenticated(true);
      return true;
    }
    return false;
  }, []);

  return { isAuthenticated, setIsAuthenticated, handleLogin };
}
