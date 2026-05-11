"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseReady } from "@/lib/supabaseClient";

export default function NoAccessPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabaseReady) return;
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data?.user?.email || "");
    });
  }, []);

  async function signOut() {
    setBusy(true);
    await supabase.auth.signOut();
    router.replace("/auth/signin");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card p-8 max-w-md w-full text-center space-y-4">
        <h1 className="text-2xl font-bold text-ink-900">אין הרשאה</h1>
        <p className="text-ink-700 text-sm leading-7">
          {email ? (
            <>
              המייל <span className="font-semibold">{email}</span> לא נמצא
              ברשימת המשתמשים המורשים במערכת.
            </>
          ) : (
            "המשתמש המחובר אינו מורשה לגשת למערכת."
          )}
        </p>
        <p className="text-sm text-ink-500">
          לקבלת הרשאה יש לפנות למנהל המערכת.
        </p>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="btn-ghost"
        >
          {busy ? "מתנתק..." : "התנתקות"}
        </button>
      </div>
    </div>
  );
}
