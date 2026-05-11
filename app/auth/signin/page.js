"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseReady } from "@/lib/supabaseClient";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11A6.6 6.6 0 0 1 5.48 12c0-.73.13-1.45.36-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.47 1.18 4.95l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabaseReady) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) router.replace("/");
    });
  }, [router]);

  async function signIn() {
    if (!supabaseReady) {
      setError("חסרה הגדרת Supabase. בדקי את .env.local");
      return;
    }
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card p-8 max-w-md w-full space-y-6 text-center">
        <div>
          <div className="text-3xl font-extrabold text-ink-900">בט״ל</div>
          <div className="text-sm text-ink-500 mt-1">ניהול משימות</div>
        </div>

        <p className="text-ink-700 text-sm leading-7">
          כניסה מאובטחת למערכת באמצעות חשבון Google.
          <br />
          רק משתמשים מורשים יוכלו לגשת לנתונים.
        </p>

        <button
          type="button"
          onClick={signIn}
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-3 rounded-md border border-line bg-white px-4 py-3 text-sm font-medium text-ink-900 hover:bg-surface-subtle transition-colors disabled:opacity-60"
        >
          <GoogleIcon />
          {loading ? "מעביר ל-Google..." : "המשך עם Google"}
        </button>

        {error && (
          <p className="text-sm text-red-700">{error}</p>
        )}
      </div>
    </div>
  );
}
