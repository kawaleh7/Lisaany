-- ============================================================
-- Lisaany — School portal, Step 3 DB: which course a class uses
-- Kids in this class land straight in this course after tapping their name.
-- Run ONCE in Supabase → SQL Editor → New query → Run. Safe to re-run.
-- ============================================================

alter table public.teachers add column if not exists course text default 'arabic';

-- existing classes (e.g. your test ones) default to the Arabic course
update public.teachers set course = 'arabic' where course is null;
