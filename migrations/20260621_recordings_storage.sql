-- מיגרציה: דלי אחסון פרטי להקלטות טלפון שנמשכות מימות.
-- בטוח להרצה חוזרת. הרצה ב-SQL Editor של Supabase.
--
-- ההקלטות נמשכות מימות (GetIVR2Dir/DownloadFile) ונשמרות כאן באופן פרטי.
-- הצפייה/האזנה נעשית דרך Signed URL זמני (אין גישה ציבורית לדלי).
-- דורש גם את המיגרציה 20260621_phone_recordings.sql (טבלת הביניים).

-- דלי פרטי (public=false)
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- הרשאות: בפרויקט זה ה-RLS פתוח ל-anon (ראה schema.sql). מתירים ל-anon
-- להעלות/לקרוא/לעדכן אך ורק בתוך דלי ה-recordings. אין גישה ציבורית —
-- האזנה מתבצעת רק דרך Signed URL.
drop policy if exists "recordings_rw" on storage.objects;
create policy "recordings_rw" on storage.objects
  for all
  using (bucket_id = 'recordings')
  with check (bucket_id = 'recordings');
