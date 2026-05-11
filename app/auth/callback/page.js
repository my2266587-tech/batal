"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseReady } from "@/lib/supabaseClient";

export default function CallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("מתחבר...");

  useEffect(() => {
    if (!supabaseReady) {
      setMessage("חסרה הגדרת Supabase.");
      return;
    }

    let cancelled = false;

    async function go() {
      // After OAuth redirect, Supabase JS exchanges the token automatically
      // (detectSessionInUrl=true). We just wait until the session lands.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data?.session) {
        router.replace("/");
      }
    }

    go();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        router.replace("/");
      }
    });

    // Safety fallback: if nothing happened after 5s, send to sign-in
    const fallback = setTimeout(() => {
      if (!cancelled) {
        setMessage("ההתחברות לא הושלמה. ננסה שוב...");
        router.replace("/auth/signin");
      }
    }, 5000);

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
      clearTimeout(fallback);
    };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-ink-500 text-sm">{message}</div>
    </div>
  );
}
