-- Expire overdue requests every minute, even when nobody is logged in.
-- Run in Supabase → SQL Editor after 001_schema.sql.
create extension if not exists pg_cron;
select cron.schedule('expire-analysis-requests', '* * * * *', $$select public.expire_requests()$$);
