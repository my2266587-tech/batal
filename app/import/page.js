"use client";

import DataImport from "@/components/DataImport";
import SetupNotice from "@/components/SetupNotice";
import { supabaseReady } from "@/lib/supabaseClient";

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">ייבוא</h1>
        <p className="page-subtitle">בוחרים לאן לייבא, מורידים תבנית ומעלים קובץ.</p>
      </header>
      {supabaseReady ? <DataImport onDone={() => {}} /> : <SetupNotice />}
    </div>
  );
}
