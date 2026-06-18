-- מיגרציה: יצירת משימות דרך הטלפון (ימות המשיח)
-- בטוח להרצה חוזרת (idempotent). הרצה ב-SQL Editor של Supabase.
--
-- אינה נוגעת בתשלומים / תיקים / RLS קיימים — רק מוסיפה עמודות לטבלת tasks
-- וטבלת עזר זמנית למצב השיחה.

-- =========================================
-- עמודות חדשות בטבלת המשימות הקיימת
-- =========================================
alter table tasks add column if not exists priority text default 'רגילה';
alter table tasks add column if not exists source text;            -- 'phone' למשימות שנוצרו בטלפון
alter table tasks add column if not exists caller_phone text;      -- המספר שממנו התקשרו
alter table tasks add column if not exists recording_url text;     -- קישור/נתיב להקלטה
alter table tasks add column if not exists transcription text;     -- תמלול (אם קיים)
alter table tasks add column if not exists call_external_id text;  -- מזהה שיחה ייחודי (מניעת כפילויות)

-- מזהה שיחה ייחודי — מונע יצירת אותה משימה פעמיים מאותה שיחה.
create unique index if not exists tasks_call_external_id_key
  on tasks (call_external_id)
  where call_external_id is not null;

-- =========================================
-- טבלת מצב שיחה זמנית (IVR) — לא טבלת משימות נפרדת,
-- אלא אחסון זמני של השלבים עד לאישור הסופי.
-- שורה כאן אינה משימה; משימה נוצרת רק בעת אישור.
-- =========================================
create table if not exists ivr_sessions (
  call_id text primary key,            -- ApiCallId מימות המשיח
  caller_phone text,
  step int not null default 1,
  attempt int not null default 1,
  data jsonb not null default '{}'::jsonb,
  task_id uuid references tasks(id) on delete set null, -- נקבע לאחר יצירת המשימה (אידמפוטנטיות)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ivr_sessions_updated_idx on ivr_sessions (updated_at desc);

alter table ivr_sessions enable row level security;
drop policy if exists "ivr_sessions_all" on ivr_sessions;
create policy "ivr_sessions_all" on ivr_sessions for all using (true) with check (true);
