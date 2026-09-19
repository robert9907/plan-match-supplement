-- Migration 006: make pm_medsup_rate idempotently seedable.
-- Target project: rpcbrkmvalvdmroqzpaq (consumer plan-match / medsup rates)
--
-- pm_medsup_rate has only a PK on id. Nothing stops the same
-- (carrier, plan, age, gender, tobacco) cell being inserted twice, so a
-- re-run of a seed silently doubles the curve instead of correcting it —
-- and a doubled curve is a wrong premium on a consumer screen, not a
-- cosmetic problem.
--
-- Verified before writing this: zero existing rows violate the key
-- (163 NC rows, 163 distinct tuples), so the index builds clean.
--
-- With this in place scripts/seed-medsup-projection.mjs can upsert with
-- Prefer: resolution=merge-duplicates, the same way
-- scripts/seed-carrier-rates.mjs already does for pm_supp_carrier_rates.

begin;

create unique index if not exists pm_medsup_rate_cell_key
  on public.pm_medsup_rate (carrier_id, plan_letter, age, gender, tobacco);

comment on index public.pm_medsup_rate_cell_key is
  'One premium per carrier/plan/age/gender/tobacco cell. Exists so seeding is idempotent: a re-run corrects a cell rather than adding a second one. Do not drop without replacing the guarantee.';

commit;
