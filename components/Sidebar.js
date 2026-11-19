"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";

// Ordered by how often she uses them; rarely used pages sit apart at the bottom.
const links = [
  { href: "/patients", label: "מטופלים" },
  { href: "/tasks", label: "משימות" },
  { href: "/calendar", label: "יומן" },
  { href: "/phone-tasks", label: "טלפונים ממתינים" },
  { href: "/documents", label: "מסמכים" },
  { href: "/contacts", label: "אנשי קשר" },
  { href: "/summary", label: "סיכום לפי מטופל" },
  { href: "/cash", label: "מעשר געלט" },
];

const moreLinks = [
  { href: "/import", label: "ייבוא מאקסל" },
  { href: "/settings", label: "הגדרות" },
];

function NavLink({ l, pathname, onNavigate, small }) {
  const active = pathname === l.href || pathname.startsWith(l.href + "/");
  return (
    <Link
      href={l.href}
      onClick={onNavigate}
      className={
        "flex items-center rounded-lg px-4 min-h-[44px] font-medium transition-colors " +
        (small ? "text-sm " : "text-base ") +
        (active
          ? "bg-accent-600 text-white shadow-sm"
          : small
            ? "text-white/70 hover:bg-sidebar-hover hover:text-white"
            : "text-white/90 hover:bg-sidebar-hover hover:text-white")
      }
    >
      {l.label}
    </Link>
  );
}

function NavList({ pathname, onNavigate }) {
  return (
    <nav className="flex-1 p-3 overflow-y-auto flex flex-col">
      <div className="space-y-1">
        {links.map((l) => (
          <NavLink key={l.href} l={l} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="mt-auto pt-4 border-t border-sidebar-border space-y-1">
        {moreLinks.map((l) => (
          <NavLink key={l.href} l={l} pathname={pathname} onNavigate={onNavigate} small />
        ))}
      </div>
    </nav>
  );
}

function Brand() {
  return (
    <div className="px-6 py-6 border-b border-sidebar-border">
      <div className="text-2xl font-extrabold tracking-tight">בט״ל</div>
      <div className="text-xs text-white/70 mt-1">ניהול משימות</div>
    </div>
  );
}

function UserFooter() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabaseReady) return;
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data?.user?.email || "");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email || "");
    });
    return () => sub?.subscription?.unsubscribe();
  }, []);

  async function signOut() {
    setBusy(true);
    await supabase.auth.signOut();
    setBusy(false);
    router.replace("/auth/signin");
  }

  if (!email) {
    return (
      <div className="px-6 py-4 border-t border-sidebar-border text-xs text-white/60">
        © בט״ל
      </div>
    );
  }

  return (
    <div className="px-4 py-4 border-t border-sidebar-border space-y-2">
      <div className="text-xs text-white/60 px-2">מחוברת כ:</div>
      <div className="text-xs text-white/90 px-2 break-all leading-5">
        {email}
      </div>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="w-full rounded-md px-3 py-2 text-xs font-medium bg-white/5 text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
      >
        {busy ? "מתנתק..." : "התנתקות"}
      </button>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <aside
        className="hidden md:flex md:flex-col md:fixed md:top-0 md:right-0 md:bottom-0 md:w-64
                   bg-sidebar text-white z-30"
      >
        <Brand />
        <NavList pathname={pathname} />
        <UserFooter />
      </aside>

      <header className="md:hidden sticky top-0 z-40 bg-sidebar text-white">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">בט״ל</div>
            <div className="text-[11px] text-white/70 -mt-0.5">ניהול משימות</div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-lg px-4 min-h-[44px] text-base bg-white/10 hover:bg-white/20"
            aria-label="תפריט"
          >
            {mobileOpen ? "✕ סגירה" : "☰ תפריט"}
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute top-0 right-0 bottom-0 w-72 bg-sidebar text-white flex flex-col shadow-xl">
            <Brand />
            <NavList
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
            <UserFooter />
          </aside>
        </div>
      )}
    </>
  );
}
