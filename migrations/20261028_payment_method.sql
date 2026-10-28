-- מיגרציה: אופן תשלום והערה לכל תשלום (בטוח להרצה חוזרת).
-- מאפשרת לרשום איך התקבל תשלום — מזומן, העברה, ברטר וכו' — ולהוסיף הערה
-- (למשל "פדיקור" בתשלום ברטר). העמודות אופציונליות; תשלומים קיימים לא משתנים.
--
-- הרצה: בעמוד SQL Editor של פרויקט ה-Supabase שלך (אחרי migrations/20260903_payments_history.sql).

alter table payments add column if not exists method text;
alter table payments add column if not exists note text;
