-- Make the FIRST admin. Only someone with access to the Supabase dashboard
-- can run this, so app users can never grant themselves admin.
-- 1) Sign up in the app normally with your email.
-- 2) Replace the email below and run this in Supabase → SQL Editor.
update public.profiles p
   set role = 'admin', coach_status = null
  from public.profile_private pp
 where pp.id = p.id and pp.email = 'YOUR_EMAIL@example.com';
