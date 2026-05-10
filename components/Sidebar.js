"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/patients", label: "מטופלים" },
  { href: "/tasks", label: "ניהול משימות" },
  { href: "/documents", label: "מסמכים" },
  { href: "/summary", label: "סיכום שעות ותשלום לפי מטופל" },
  { href: "/cash", label: "מעשר געלט" },
  { href: "/import", label: "ייבוא" },
  { href: "/settings", label: "הגדרות" },
];

function NavList({ pathname, onNavigate }) {
  return (
    <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            onClick={onNavigate}
            className={
              "block rounded-lg px-4 py-2.5 text-sm font-medium transition-colors " +
              (active
                ? "bg-accent-600 text-white shadow-sm"
                : "text-white/70 hover:bg-sidebar-hover hover:text-white")
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="px-6 py-6 border-b border-sidebar-border">
      <div className="text-2xl font-extrabold tracking-tight">בט״ל</div>
      <div className="text-xs text-white/50 mt-1">ניהול משימות</div>
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
      {/* Desktop: fixed sidebar pinned to the right */}
      <aside
        className="hidden md:flex md:flex-col md:fixed md:top-0 md:right-0 md:bottom-0 md:w-64
                   bg-sidebar text-white z-30"
      >
        <Brand />
        <NavList pathname={pathname} />
        <div className="px-6 py-4 border-t border-sidebar-border text-xs text-white/40">
          © בט״ל
        </div>
      </aside>

      {/* Mobile: top bar */}
      <header className="md:hidden sticky top-0 z-40 bg-sidebar text-white">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">בט״ל</div>
            <div className="text-[11px] text-white/50 -mt-0.5">ניהול משימות</div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-md px-3 py-2 text-sm bg-white/10 hover:bg-white/20"
            aria-label="תפריט"
          >
            {mobileOpen ? "סגור" : "תפריט"}
          </button>
        </div>
      </header>

      {/* Mobile: slide-in drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="absolute top-0 right-0 bottom-0 w-72 bg-sidebar text-white flex flex-col shadow-xl"
          >
            <Brand />
            <NavList
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}
    </>
  );
}
