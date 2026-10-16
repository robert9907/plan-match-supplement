-- Migration 007: suppress AARP / UnitedHealthcare Medigap from every consumer surface
-- Target project: rpcbrkmvalvdmroqzpaq (plan-match-prod) — same as 005.
-- Rob, 2026-10-16: remove AARP and anything UnitedHealthcare from Plan Match
-- Supplement (rate chart + quoting). Uses the 005 exclusion mechanism, so the
-- pm_medsup_rate_public / pm_supp_carrier_rates_public views drop them; base
-- rate rows are kept. Reversible by deleting these two rows.
--
-- 'AARP%' covers all 8 AARP/UHC entity names currently in pm_medsup_carrier and
-- pm_supp_carrier_rates. '%UnitedHealthcare%' catches any non-AARP-branded UHC
-- name a future scrape introduces. Neither matches United American Insurance
-- Company (a separate, non-UHC carrier).

begin;

insert into pm_medsup_carrier_exclusions (match_pattern, carrier_label, reason, notes) values
  ('AARP%', 'AARP / UnitedHealthcare', 'not_appointing_brokers',
   '2026-10-16. Rob removed AARP/UnitedHealthcare from Plan Match Supplement (chart + quoting).'),
  ('%UnitedHealthcare%', 'UnitedHealthcare (any entity)', 'not_appointing_brokers',
   '2026-10-16. Catch-all for non-AARP-branded UnitedHealthcare entities.')
on conflict (match_pattern) do nothing;

commit;
