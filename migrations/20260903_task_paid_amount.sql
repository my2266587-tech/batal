-- מיגרציה: מעקב תשלום חלקי למשימות (בטוח להרצה חוזרת).
-- מוסיפה עמודת paid_amount לטבלת tasks — כמה שולם בפועל על חשבון המשימה,
-- כך שאפשר לרשום תשלום שמכסה רק חלק מהסכום (למשל 20 ₪ ממשימה של 450 ₪),
-- והיתרה הפתוחה שלה (ושל סך כל המטופל) יורדת בהתאם.
--
-- הרצה: בעמוד SQL Editor של פרויקט ה-Supabase שלך.

alter table tasks add column if not exists paid_amount numeric(10,2) not null default 0;

-- איפוס נתונים קיימים: משימות שכבר סומנו כ"שולם" או "לא לחיוב" נחשבות
-- כמשולמות במלואן. התנאי "paid_amount = 0" הופך את זה לבטוח להרצה חוזרת —
-- לא ידרוס עדכון תשלום חלקי אמיתי שכבר נרשם.
update tasks
set paid_amount = coalesce(total_after_discount, 0)
where payment_status in ('שולם', 'לא לחיוב')
  and paid_amount = 0;
