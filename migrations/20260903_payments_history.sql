-- מיגרציה: היסטוריית תשלומים (בטוח להרצה חוזרת).
-- כל לחיצה על "רישום תשלום" בכרטיס מטופל יוצרת כאן שורה אחת — תאריך, סכום,
-- ותמונת מצב (snapshot) של אילו משימות הסכום כיסה ובאיזה חלק. זו רשומה
-- נפרדת מהמשימות עצמן, כך שהתשלום נשאר גלוי גם כשהוא כיסה רק חלק ממשימה.
--
-- הרצה: בעמוד SQL Editor של פרויקט ה-Supabase שלך (אחרי migrations/20260903_task_paid_amount.sql).

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  amount numeric(10,2) not null,
  paid_at date not null default current_date,
  -- מערך תמונות-מצב: [{ "task_id", "task_definition", "date_gregorian", "amount", "fully_paid" }, ...]
  allocations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payments_patient_idx on payments (patient_id);
create index if not exists payments_paid_at_idx on payments (paid_at desc);

alter table payments enable row level security;

drop policy if exists "payments_all" on payments;
create policy "payments_all" on payments for all using (true) with check (true);
