"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";

export function useAuthState() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthenticated(data.session != null);
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
