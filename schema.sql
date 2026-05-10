-- מערכת בט"ל — סכמה לבסיס נתונים ב-Supabase
-- הרצה: בעמוד SQL Editor של פרויקט ה-Supabase שלך

-- הפעלת תוסף ליצירת UUID (ברירת מחדל בפרויקטים חדשים)
create extension if not exists "pgcrypto";

-- =========================================
-- מטופלים
-- =========================================
create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  status text default 'פעיל',
  notes text,
  treatment_type text,
  hourly_rate numeric(10,2),
  hourly_rate_discounted numeric(10,2),
  created_at timestamptz not null default now()
);

create index if not exists patients_created_at_idx on patients (created_at desc);

-- מיגרציה לעדכון התקנות קיימות (בטוח להרצה חוזרת)
alter table patients add column if not exists treatment_type text;
alter table patients add column if not exists hourly_rate numeric(10,2);
alter table patients add column if not exists hourly_rate_discounted numeric(10,2);

-- =========================================
-- משימות / פגישות
-- =========================================
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete set null,
  date_gregorian date,
  date_hebrew text,
  hours numeric(6,2) default 0,
  task_definition text,
  meeting_details text,
  meeting_type text,
  travel text,
  travel_payment numeric(10,2) default 0,
  call_details text,
  email_details text,
  other_details text,
  attendance text,
  documents_url text,
  total_before_discount numeric(10,2) default 0,
  total_after_discount numeric(10,2) default 0,
  status text default 'פתוח',
  created_at timestamptz not null default now()
);

create index if not exists tasks_patient_idx on tasks (patient_id);
create index if not exists tasks_date_idx on tasks (date_gregorian desc);

-- =========================================
-- קופה / רישום כספים
-- =========================================
create table if not exists cash_records (
  id uuid primary key default gen_random_uuid(),
  date date,
  amount numeric(10,2),
  purpose text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists cash_records_date_idx on cash_records (date desc);

-- =========================================
-- RLS — לגרסה הבסיסית: גישה פתוחה לקריאה/כתיבה דרך anon
-- בייצור יש להחליף במדיניות מבוססת auth.uid()
-- =========================================
alter table patients enable row level security;
alter table tasks enable row level security;
alter table cash_records enable row level security;

drop policy if exists "patients_all" on patients;
create policy "patients_all" on patients for all using (true) with check (true);

drop policy if exists "tasks_all" on tasks;
create policy "tasks_all" on tasks for all using (true) with check (true);

drop policy if exists "cash_all" on cash_records;
create policy "cash_all" on cash_records for all using (true) with check (true);
