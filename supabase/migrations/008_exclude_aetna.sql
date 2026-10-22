-- Migration 008: suppress Aetna Medigap from every consumer surface
-- Target project: rpcbrkmvalvdmroqzpaq (plan-match-prod) — same as 005/007.
-- Rob, 2026-10-22: remove Aetna from Plan Match Supplement (rate chart + quoting)
-- for now. '%Aetna%' covers Aetna Health Insurance Company and Continental Life
-- Insurance Company of Brentwood, Tennessee (Aetna). Reversible by deleting this row.

insert into pm_medsup_carrier_exclusions (match_pattern, carrier_label, reason, notes) values
  ('%Aetna%', 'Aetna (any entity, incl. Continental Life of Brentwood)', 'not_appointing_brokers',
   '2026-10-22. Rob removed Aetna from Plan Match Supplement (chart + quoting) for now. Reversible by deleting this row.')
on conflict (match_pattern) do nothing;
