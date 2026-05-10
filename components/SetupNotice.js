"use client";

export default function SetupNotice() {
  return (
    <div className="card p-6 border-amber-200 bg-amber-50">
      <h2 className="section-title text-amber-900">חסרה הגדרת Supabase</h2>
      <p className="mt-2 text-amber-900 text-sm leading-7">
        צור קובץ <code className="bg-white px-1.5 py-0.5 rounded border border-amber-200">.env.local</code> בתיקיית הפרויקט עם הערכים:
      </p>
      <pre className="mt-3 bg-white border border-amber-200 rounded-lg p-3 text-xs text-ink-700 overflow-x-auto" dir="ltr">
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-key
      </pre>
      <p className="mt-3 text-amber-900 text-sm">
        לאחר מכן הרץ מחדש את שרת הפיתוח (<code>npm run dev</code>).
      </p>
    </div>
  );
}
