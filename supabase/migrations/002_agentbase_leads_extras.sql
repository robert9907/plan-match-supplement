-- Run this against the AgentBase Supabase project (not plan-match-supplement's).
-- Adds the two columns the /api/enroll bridge writes on every supplement
-- lead. Safe to run repeatedly — each statement is idempotent.
--
-- AgentBase's leads table already has first_name, last_name, phone, source,
-- product, context. These two are new for the supplement widget:
--   security_pin — the 4-digit PIN the applicant sets on the Details step
--   medicare_id  — the CMS MBI, stripped + uppercased before insert

alter table public.leads add column if not exists security_pin text;
alter table public.leads add column if not exists medicare_id  text;
