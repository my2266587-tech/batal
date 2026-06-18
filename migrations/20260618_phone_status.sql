-- מצב טיפול במשימות שנוצרו מהטלפון (מסך "טלפונים ממתינים").
-- בטוח להרצה חוזרת. אינו נוגע בתשלומים/לוגיקה קיימת.
--
-- phone_status:
--   'pending'       — נקלטה, ממתינה לאישור (מטופלת זוהתה)
--   'needs_patient' — צריך שיוך למטופלת (לא זוהתה)
--   'approved'      — אושרה ידנית (יוצאת מהמסך)
-- ריק (null) למשימות שאינן מהטלפון.

alter table tasks add column if not exists phone_status text;

create index if not exists tasks_phone_status_idx
  on tasks (phone_status) where phone_status is not null;
