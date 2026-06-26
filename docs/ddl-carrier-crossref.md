# DDL carrier cross-reference

The `src/lib/ddlData.ts` Declinable Drug List is the source of truth
for the Medigap qualification scorer. This doc records when, against
what, and how the list was last reconciled with real carrier DDLs so
the next certification cycle starts from a known baseline rather than
a blind diff.

## Carriers cross-referenced

| Carrier | Source document | Version | Filing state |
|---|---|---|---|
| Blue Cross NC | BCBSNC Medicare Supplement Underwriting Guide | 2026 v1 | NC |
| Mutual of Omaha | MoO Medicare Supplement Field Underwriting Guide | 2026 | NC, TX, GA |
| Aetna (CVS Health) | Aetna Med Supp Health Statement + DDL appendix | 2026 | NC, TX, GA |
| Cigna Healthcare | Cigna Supplemental Benefits Underwriting Manual | 2026 (Q2 update) | NC, TX, GA |

## Refresh history

| Date | Event | Net entries | Author |
|---|---|---|---|
| 2026-06-26 | Initial documented cross-reference + 51 net additions (transplant rejection ladder, PAH class, HIV ARTs, HCV DAAs, GH replacement, anti-amyloid AD, clozapine) | 202 | Rob Simm |
| 2026-06-25 | Earlier session added autoimmune biologics, MS DMTs, oncology, opioids, CKD, insulins | 150 | Rob Simm |

## Current state

- **Total DDL entries:** 202 (count with `grep -cE '^  [a-z][a-z0-9_]*: \{' src/lib/ddlData.ts`).
- **Clusters supported:** diabetes, cardio, anticoagulant, respiratory,
  mental, pain, neuro, cancer, autoimmune, renal, transplant, pulmonary,
  hiv, hepatitis, endocrine, neuropathyAdj.
- **First-word lookup:** `ddlLookup()` strips parens + takes the first
  whitespace token, lowercased. Brand and generic both live as their
  own keys when both forms reach `ddlLookup` from a user's stored med
  list (e.g. `prograf` + `tacrolimus`, `clozaril` + `clozapine`).

## Known gaps / limitations

The carrier source docs catch a few classes the DDL cannot cleanly
encode under the first-word lookup model:

1. **Sildenafil / tadalafil (PAH vs ED/BPH).** Standard 20–100 mg
   dosing treats ED or BPH and is non-declinable. Only Revatio
   (sildenafil 20 mg TID) and Adcirca (tadalafil 40 mg QD) indicate
   PAH. The first-word lookup can't tell dose; flagging the
   ingredient would knock out every Viagra/Cialis user. Mitigation:
   the `pulmonary` cluster catches anyone whose med list contains a
   real PAH-only agent (Tracleer, Letairis, Opsumit, Uptravi,
   Orenitram, Veletri, Flolan). Brokers should manually verify dose
   if sildenafil/tadalafil appears with no other PAH agent.

2. **Pregabalin (Lyrica) dose-dependent.** Low-dose pregabalin for
   fibromyalgia or post-herpetic neuralgia is benign; high-dose
   pregabalin for diabetic peripheral neuropathy + a diabetes med is
   a knockout combo. The DDL already encodes pregabalin in the
   `neuropathyAdj` cluster which only fires in combination with
   diabetes — the combo scorer handles this correctly.

3. **Prednisone / corticosteroids dose-dependent.** Short-term ≤10 mg
   bursts (poison ivy, asthma exacerbation) are benign. Chronic
   ≥20 mg dosing indicates autoimmune, transplant, or active cancer.
   Carriers ask about chronicity on the health statement; the DDL
   doesn't flag prednisone because the false-positive rate would be
   prohibitive (the drug shows up on countless innocuous med lists).

4. **Insulin (severity, not knockout).** Insulin use lifts the
   diabetes severity tier to 3 but isn't an outright decline. The
   combo scorer handles this via `severityTier: 3` + `isInsulin:
   true`. Some carrier DDLs list specific insulins as "rated only";
   we treat that as a soft signal, not a knockout.

## Refresh cadence

**Annual:** During carrier certification training (Aug–Sep each year)
Rob downloads the next year's underwriting guides + DDL appendices
from each carrier's broker portal:

- BCBSNC: <https://www.bcbsnc.com/agents/> (login required, NPN-tied)
- Mutual of Omaha: <https://www.mutualofomaha.com/broker>
- Aetna CVS Health: <https://www.aetnamedicareproducer.com/>
- Cigna: <https://www.cigna-suppliers.com/>

For each carrier, diff the new DDL against this file's roster. Add
any drugs the carrier added since the last cycle; update the
"Refresh history" table at the top with the date and net count.

**Mid-year:** When a carrier publishes a DDL bulletin (rare —
typically only when FDA approves a new specialty drug in a
declinable class), add the entry in the same session as the
bulletin's effective date. The carrier bulletin URL goes into the
new entry's `note` field for audit trail.

## Process when adding new entries

1. Confirm the first-word lookup will match. Test with
   `ddlLookup('Brandname 100 MG')` — should return the entry.
2. Pick the right cluster. If none fit, extend `DdlCluster` (and the
   matching `emptyClusters` / `emptyClusterDrugs` records in
   `scoringEngine.ts`) before adding the entry.
3. Set `declineAll: true` only when every cross-referenced carrier
   declines the drug. If even one accepts at rated classes, use
   `declineAll: false` + a `note` describing the carrier exception.
4. For dose-dependent ambiguity (see "Known gaps" above), DO NOT add
   the entry — instead document the limitation in this file so the
   next reviewer doesn't re-litigate it.
