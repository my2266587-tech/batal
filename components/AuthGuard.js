"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase, supabaseReady } from "@/lib/supabaseClient";

export default function AuthGuard({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    if (!supabaseReady) {
      setStatus("ok");
      return;
    }

    let cancelled = false;

    async function check() {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      if (cancelled) return;

      if (!session) {
        router.replace("/auth/signin");
        return;
      }

      const { data: allowed, error } = await supabase.rpc("is_authorized");
      if (cancelled) return;

      if (error || !allowed) {
        router.replace("/auth/no-access");
        return;
      }

      setStatus("ok");
    }

    check();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      check();
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, [pathname, router]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-24 text-ink-500">
        טוען...
      </div>
    );
  }

  return children;
}
