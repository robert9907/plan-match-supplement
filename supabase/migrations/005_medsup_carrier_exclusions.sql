-- Migration 005: Medigap carrier suppression (exclusion table + consumer-safe views)
-- Target project: rpcbrkmvalvdmroqzpaq (consumer plan-match / medsup rates)
-- Note: 001/002/004 target agentbase (wyyasqvouvdcovttzfnv); 003 and 005 target
-- rpcbrkmvalvdmroqzpaq. Supabase CLI in this repo is linked to agentbase, so this
-- migration is applied by hand via psql / node pg against DATABASE_URL for the
-- correct project (see docs/ops notes).
--
-- Goal: suppress carriers Generation Health cannot broker (not appointing / closed block)
-- from every consumer-facing surface, without deleting rate rows (scraper re-imports
-- them, and internal analysis wants the competitive data retained).
--
-- Mechanism: exclusion table with ILIKE match patterns; two definer-owned views
-- (pm_medsup_rate_public, pm_supp_carrier_rates_public) filter out matched carriers.
-- Base-table SELECT is revoked from anon/authenticated so consumer clients can only
-- reach the filtered views. Service role still reads base tables for admin/analysis.

begin;

-- ============================================================
-- 1.1 Exclusion table + seeds
-- ============================================================
create table if not exists pm_medsup_carrier_exclusions (
  id             bigserial primary key,
  match_pattern  text not null unique,
  carrier_label  text not null,
  reason         text not null check (reason in ('not_appointing_brokers','closed_block','pending_verification')),
  excluded_on    date not null default current_date,
  excluded_by    text not null default 'rob',
  notes          text
);

comment on table pm_medsup_carrier_exclusions is
  'Carriers suppressed from all consumer-facing Medigap rate displays. match_pattern is an ILIKE pattern applied to pm_medsup_carrier.carrier_name and pm_supp_carrier_rates.company. Rate rows are retained in the base tables for internal competitive reference. Consumer surfaces must read only the _public views.';

alter table pm_medsup_carrier_exclusions enable row level security;
-- No policies. Service-role reads only.

insert into pm_medsup_carrier_exclusions (match_pattern, carrier_label, reason, notes) values
  ('Physicians Select Insurance Company%', 'Physicians Select Insurance Company (PSIC)', 'not_appointing_brokers',
   'Verified 2026-07-30. Physicians Mutual family. Not appointing brokers. Prefix pattern intentionally covers all product variants incl. Innovative and With Preventive and Fitness Benefits.'),
  ('MedMutual Protect%', 'MedMutual Protect', 'not_appointing_brokers',
   'Verified 2026-07-30. Medical Mutual of Ohio brand. Contract freeze on new agents plus reported $0 med supp comp. Underwritten by United Insurance Co of America / Reserve National / MedMutual Life.'),
  ('Physicians Life Insurance Company%', 'Physicians Life Insurance Company', 'closed_block',
   'Verified 2026-07-30. Separate NAIC entity from PSIC but same Physicians Mutual group. Carrier UW guide describes the Physicians Life Medigap block as closed. Suppressed pending FMO confirmation - independently reversible, delete this row only.')
on conflict (match_pattern) do nothing;

-- ============================================================
-- 1.2 Views (definer semantics -- do NOT set security_invoker)
-- ============================================================
create or replace view pm_medsup_rate_public as
select r.*, c.carrier_name, c.state as carrier_state, c.rating_type
from pm_medsup_rate r
join pm_medsup_carrier c on c.id = r.carrier_id
where c.active = true
  and not exists (
    select 1 from pm_medsup_carrier_exclusions e
    where c.carrier_name ilike e.match_pattern
  );

create or replace view pm_supp_carrier_rates_public as
select r.*
from pm_supp_carrier_rates r
where not exists (
  select 1 from pm_medsup_carrier_exclusions e
  where r.company ilike e.match_pattern
);

comment on view pm_medsup_rate_public is
  'Consumer-safe. Excludes suppressed carriers and inactive carriers. All consumer reads use this, never pm_medsup_rate.';
comment on view pm_supp_carrier_rates_public is
  'Consumer-safe. Excludes suppressed carriers. All consumer reads use this, never pm_supp_carrier_rates.';

-- ============================================================
-- 1.3 Lock the base tables
-- ============================================================
drop policy if exists "Public read access" on pm_supp_carrier_rates;

revoke select on pm_medsup_rate, pm_medsup_carrier, pm_supp_carrier_rates from anon, authenticated;
grant  select on pm_medsup_rate_public, pm_supp_carrier_rates_public to anon, authenticated;

-- ============================================================
-- 1.5 Drift detection view
-- ============================================================
create or replace view pm_medsup_suppression_audit as
select 'pm_supp_carrier_rates' as src, r.company as carrier, e.carrier_label, e.reason, count(*) as rows_suppressed
from pm_supp_carrier_rates r join pm_medsup_carrier_exclusions e on r.company ilike e.match_pattern
group by 1,2,3,4
union all
select 'pm_medsup_carrier', c.carrier_name, e.carrier_label, e.reason, count(*)
from pm_medsup_carrier c join pm_medsup_carrier_exclusions e on c.carrier_name ilike e.match_pattern
group by 1,2,3,4;

comment on view pm_medsup_suppression_audit is
  'Drift detection for medsup carrier suppression. Run after every scraper refresh. Unexpected new rows -> pattern over-reach. Known carrier missing -> scraper renamed it.';

commit;
