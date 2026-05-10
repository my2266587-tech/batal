"use client";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">הגדרות</h1>
        <p className="page-subtitle">
          הגדרות מערכת ופרופיל משתמש — בקרוב.
        </p>
      </header>

      <div className="card p-10 text-center">
        <p className="text-ink-700 font-medium">אין כרגע מודולי הגדרות זמינים.</p>
        <p className="text-ink-500 text-sm mt-2">
          חיבור ל-Supabase מוגדר דרך קובץ <code>.env.local</code> בשורש הפרויקט.
        </p>
      </div>
    </div>
  );
}
