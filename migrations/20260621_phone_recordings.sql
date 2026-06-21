-- מיגרציה: טבלת ביניים להקלטות טלפון הממתינות לאישור.
-- בטוח להרצה חוזרת (idempotent). הרצה ב-SQL Editor של Supabase.
--
-- שינוי זרימה: הקלטה מהטלפון כבר אינה יוצרת מיד משימה בטבלת tasks.
-- היא נשמרת כאן ("טלפונים ממתינים"), והמשתמשת עוברת עליה, מתקנת ומשייכת
-- מטופלת. רק בלחיצה על "אשרי והעבירי לניהול משימות" נוצרת שורה בטבלת tasks.
--
-- אינה נוגעת בתשלומים / תיקים / לוגיקה קיימת.

create table if not exists phone_recordings (
  id uuid primary key default gen_random_uuid(),
  call_external_id text,                 -- ApiCallId — מזהה שיחה ייחודי (מניעת כפילויות)
  caller_phone text,                     -- המספר שממנו התקשרו
  recording_url text,                    -- קישור/נתיב להקלטה (להאזנה)
  transcription text,                    -- תמלול ההקלטה (ניתן לעריכה)
  spoken_patient_name text,              -- השם שנאמר בהקלטה (לעולם לא נדרס ע"י שיוך ידני)
  patient_id uuid references patients(id) on delete set null, -- המטופלת ששויכה בפועל
  hours numeric(6,2),                    -- משך שעות שחולץ/נערך
  task_definition text,                  -- הגדרת המשימה שחולצה/נערכה
  -- סטטוס: ready (מוכן לאישור) / needs_patient (צריך שיוך מטופלת) /
  --         failed (נכשל) / approved (אושר והועבר למשימות)
  status text not null default 'needs_patient',
  task_id uuid references tasks(id) on delete set null, -- נקבע לאחר ההעברה למשימות
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- מזהה שיחה ייחודי — מונע יצירת אותה הקלטה פעמיים מאותה שיחה.
create unique index if not exists phone_recordings_call_key
  on phone_recordings (call_external_id)
  where call_external_id is not null;

create index if not exists phone_recordings_status_idx on phone_recordings (status);
create index if not exists phone_recordings_created_idx on phone_recordings (created_at desc);

alter table phone_recordings enable row level security;
drop policy if exists "phone_recordings_all" on phone_recordings;
create policy "phone_recordings_all" on phone_recordings for all using (true) with check (true);
