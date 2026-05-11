"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import AuthGuard from "./AuthGuard";

export default function AppShell({ children }) {
  const pathname = usePathname();
  const isAuthRoute = pathname?.startsWith("/auth/");

  if (isAuthRoute) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <>
      <Sidebar />
      <main className="md:mr-64 px-5 md:px-10 py-6 md:py-10 min-h-screen">
        <div className="max-w-6xl">
          <AuthGuard>{children}</AuthGuard>
        </div>
      </main>
    </>
  );
}
