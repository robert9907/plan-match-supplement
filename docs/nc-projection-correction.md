# NC projection chart — correction table

**Status: actions 1, 2 and the relabel half of 6 applied. Actions 3–5 and the re-quote half of 6 are still proposals.**

> **Applied.** `active = false` on GPM Health and Life (id 6), AHIC (id 12) and
> Aflac (id 14) in `pm_medsup_carrier`, NC. `pm_medsup_rate_public` filters
> `c.active = true`, so all three are off the projection chart. No rate rows
> were touched and nothing was deleted. Reverse with:
> `update pm_medsup_carrier set active=true where id in (6,12,14);`
>
> Side effect worth recording: those three were the only NC carriers with zero
> female rows. NC now shows 9 carriers and **every one of them has female
> rates**, so the class of defect that put "Lowest 20yr total $0" under a real
> carrier's name is now structurally absent from NC as well as guarded against
> in code.

> **Applied (action 2).** `rating_type` corrected on four carriers: the three
> AARP rows to `community`, Medico Insurance Company to `attained_age`, both
> matching the CMS filings.
>
> **With a correction to what this document originally claimed.** The entry in
> E1 below said Medico's label "tells a 65-year-old their premium does not rise
> with age". That was wrong, and I should have traced the render path before
> writing it. `pm_medsup_carrier.rating_type` reaches the projection widget as
> `ra` — and `ra` is typed in `medsupRates.ts`, carried through
> `api/medsup-rates.ts`, and **never rendered anywhere**. The rate type a
> consumer actually sees on /results comes from `pm_supp_carrier_rates`, which
> was already correct. So action 2 was data hygiene against a field that is one
> line away from being displayed, not a fix to anything a consumer was reading.
> Worth doing; not worth the alarm this document raised about it.

`audit-medsup-provenance.mjs` fails on NC: age-65 premiums that cannot be tied
to the carrier they are shown under. This is the cross-map it asked for —
every NC projection carrier against the company that actually filed that
figure, with a recommended disposition for each.

Sources: `pm_medsup_carrier` + `pm_medsup_rate` (the projection, 15 carriers,
163 of 196 cells, all loaded 2026-06-13, all `source = healthsherpa`, none
carrying a NAIC code) against `pm_supp_carrier_rates` (the CMS Plan Finder
scrape, 12 reference ZIPs, one age-65 figure per company/gender — `rate_min`
equals `rate_max` on every row). Filed figures below are ZIP 27713 unless the
carrier's range varies, in which case the range is given.

## The headline

The audit's framing — "21 rows don't reconcile" — reads as though most of NC
is wrong. It is not. **Eleven of the fourteen carriers with data are fine**,
and the reason they trip the audit is the same thing I hit seeding TX: the
CMS scrape carries one figure per *company*, and HealthSherpa quotes a
*policy form*, sometimes with a membership fee added. Three carriers are
genuinely wrong, and they are the three that also have no female rows at all.

Separately, four carriers carry the **wrong rate type**, which is a disclosure
defect independent of any premium, and one of those four is inverted in the
direction that misleads.

---

> **Applied 2026-09-20 (action 6a — relabel).** The three carriers taken off
> the chart in action 1 are back on it, under the right names.
> `pm_medsup_rate` was never touched: the curves were always correct, each was
> simply wearing another's name.
>
> | id | was | is |
> |---|---|---|
> | 6 | GPM Health and Life | **Aflac** |
> | 14 | Aflac | **GPM Health and Life** |
> | 12 | AHIC | **Mutual of Omaha (Omaha Insurance Company)** |
>
> Confirmed at age 65 *and* age 80, by HealthSherpa and by CMS independently:
> Aflac 179.69 / 293.22, Omaha 212.34 / 318.41, GPM 312.66 / 476.15. Nine of
> the other eleven NC rows match today's quote exactly under their own names,
> which is what makes three exceptions a finding rather than a guess.
>
> **This retires the "half right" hedge below.** Aflac and GPM *are*
> straightforwardly transposed. The 65-cell discrepancy that made me doubt it —
> 318.83 against a filed 312.66 — was staleness in `pm_supp_carrier_rates`, the
> same staleness that produced two false policy-form declarations in
> `carrier-aliases.json`. One stale reference table, three wrong conclusions.
>
> NC shows twelve carriers again, up from nine.
>
> **What it does not fix:** all three return male-only. A man comparing NC
> carriers now sees twelve; a woman still sees nine. Twenty-one cells, and the
> gap is gendered. `projectionStats` renders them absent rather than as $0, so
> nothing lies — but nothing fills them either until the refresh runs. GPM's
> own age-65 cell also reads 318.83 against CMS's current 312.66, about 2%
> stale; same refresh.

## Group A — exact, no correction needed

Reproduces the filing to the cent on both genders. These only trip the audit
because the two tables use different names for the same company.

| shown as | filed as | M 65 | F 65 |
|---|---|---|---|
| Medico Insurance Company | Medico Insurance Company (Preferred) | 147.21 | 128.01 |
| Cigna National Health Insurance Company | HealthSpring Insurance Company | 171.92 | 149.50 |
| Blue Medicare Supplement (BCBSNC) | BlueCross BlueShield of North Carolina | 205.50 | 179.50 |
| Aetna Health Insurance Company | Aetna Health Insurance Company | 208.25 | 181.01 |

**Action:** three alias entries in `carrier-aliases.json`. Confirm each against
the filing rather than against the matching number — Cigna/HealthSpring and
BCBSNC are both already named in the audit's own header as known-good name
pairs, so those two are safe. Medico needs a look: CMS lists Preferred,
Standard I and Standard II, and the projection carries only one unqualified
"Medico Insurance Company". Its figure is Preferred's exactly, but the name on
the screen does not say which series the consumer is being quoted.

## Group B — a flat membership fee, identical to the cent on both genders

| shown as | filed as | M 65 shown / filed | F 65 shown / filed | fee |
|---|---|---|---|---|
| PSIC - Innovative | Physicians Select Insurance Company (Innovative) | 125.70 / 120.70 | 114.22 / 109.22 | **+$5.00** |
| PSIC | Physicians Select Insurance Company | 172.72 / 167.72 | 156.75 / 151.75 | **+$5.00** |
| AARP/UnitedHealthcare Insurance Company | AARP - UnitedHealthcare Insurance Company (Standard) | 188.79 / 186.79 | 167.44 / 165.44 | **+$2.00** |
| AARP/UHC Insurance Company of America | AARP - UHC Insurance Company of America (Standard) | 208.57 / 204.57 | 184.95 / 180.95 | **+$4.00** |
| Humana Medicare Supplement | Humana (Humana Benefit Plan of Illinois, Inc.) | 191.42 / 189.42 | 169.63 / 167.63 | **+$2.00** |

The offset is the same dollar amount on both genders, to the cent, five times
over. A transcription error does not do that.

**It also replicates across states.** In the TX capture taken 2026-09-19 —
different session, different ZIP, three months later — Physicians Select's two
products are again exactly +$5.00 on both genders, and Humana is again exactly
+$2.00 on both genders. Two independent captures agreeing to the cent on the
same fee is about as good as this gets without a rate manual.

**Action:** declared forms, per the mechanism added in `9cf48c7`, with
allowances sized to the offset. Note that Physicians Select is on the
migration-005 suppression list, so neither PSIC row reaches a consumer screen
regardless; they still need declaring so the audit runs clean.

**One thing to check:** why is AARP/UHC +$2.00 and AARP/UHC *of America*
+$4.00? Both are UnitedHealthcare AARP entities. The offsets are internally
consistent but the difference between them is not explained.

## Group C — a consistent ratio, form not yet identified

| shown as | nearest own-name filing | M ratio | F ratio |
|---|---|---|---|
| AARP/UnitedHealthcare Insurance Company (Select) | AARP - UHC Insurance Company (Standard) 186.79 / 165.44 | 0.8098 | 0.8112 |
| Humana Achieve Medicare Supplement | Humana Achieve (CompBenefits Insurance Company) 170.27 / 148.06 | 1.3118 | 1.3135 |

**AARP Select** is about 19% *below* the Standard form on both genders.
UnitedHealthcare does sell a network-based AARP Select Medigap that is
genuinely cheaper than Standard, and CMS Plan Finder does not list it for NC.
This is very likely real, and 151.28 matches nothing else anywhere in
`pm_supp_carrier_rates`.

**Humana Achieve** is about 31% *above* the company CMS lists under that
product name. That is a large gap, and the two genders agree less tightly than
Group B (0.13% apart rather than to the cent). 223.35 matches nothing in NC.
I would not declare this one without a second quote.

**Action:** declare AARP Select at a ~22% allowance. Re-quote Humana Achieve
before deciding.

## Group D — genuinely wrong

All three are male-only rows. These are the **only** three carriers in NC with
zero female rows, which is unlikely to be coincidence: whatever went wrong in
the 2026-06-13 capture for these three went wrong for both the label and the
female pass.

| shown as | shows | its own filing | error |
|---|---|---|---|
| GPM Health and Life Insurance Company | **179.69** M | 312.66 M / 271.87 F | shows **57.5%** of its own rate — understated by $132.97/mo |
| Aflac | **318.83** M | 171.79–179.69 M / 149.97–156.87 F | shows **177%** of its own rate — overstated by $139.14/mo |
| AHIC | **212.34** M | no company named AHIC filed Plan G in NC | label matches nothing |

What the figures actually are:

- **GPM's 179.69 is AFLAC's filed NC figure**, exactly, at ZIP 27713 — the top
  of AFLAC's 171.79–179.69 range.
- **AHIC's 212.34 is Mutual of Omaha (Omaha Insurance Company)'s** filed NC
  figure, exactly, at all twelve ZIPs, and it matches nothing else in the
  entire table, any state, any plan. So Mutual of Omaha is not missing from the
  NC chart — it is on it, under an abbreviation that is not its name.
- **Aflac's 318.83 matches nothing**, anywhere in `pm_supp_carrier_rates`. It
  is 1.97% above GPM's 312.66.

So the obvious reading — Aflac and GPM transposed — is only half right. GPM's
cell is exactly Aflac's. Aflac's cell is *not* exactly GPM's, and I cannot say
what it is. Its whole male curve runs 318.83 → 738.03 (2.315x), which is a
plausible shape for a real curve belonging to somebody.

**Action: these three rows should come out of the chart now**, before any
re-quote. A 68-year-old comparing carriers is currently being shown a GPM
premium 42.5% below what GPM charges and an Aflac premium 77.4% above what
Aflac charges — in a tool whose entire purpose is that comparison. Setting
`active = false` on the three carriers removes them without deleting anything,
and is reversible. Then re-quote all three from HealthSherpa, both genders,
and re-seed through `seed-medsup-projection.mjs`, whose age-65 range check
would have caught GPM and Aflac on the way in.

## Group E — defects that have nothing to do with the premiums

### E1. Rate type is wrong on four carriers

NAIC Medigap Model Act §13 makes rate type a disclosed item, and `/results`
shows it per carrier.

| carrier | projection says | CMS says |
|---|---|---|
| AARP/UnitedHealthcare Insurance Company | attained_age | COMMUNITY_RATED |
| AARP/UnitedHealthcare Insurance Company (Select) | attained_age | COMMUNITY_RATED |
| AARP/UHC Insurance Company of America | attained_age | COMMUNITY_RATED |
| **Medico Insurance Company** | **community** | **ATTAINED_AGE** |

Medico's is the one that matters. A community-rated label tells a 65-year-old
their premium does not rise with age. Medico's does: its own curve in this
same table runs 147.21 at 65 to 354.07 at 95. The label contradicts the chart
directly beneath it.

### E2. Flat tops — a premium that stops rising

| carrier | repeated value | ages |
|---|---|---|
| Blue Medicare Supplement (BCBSNC) M | 403.75 | 80, 85, 90, 95 |
| AARP/UnitedHealthcare Insurance Company F | 274.50 | 85, 90, 95 |
| AARP/UHC (Select) M | 309.50 | 85, 90, 95 |
| AARP/UHC of America M / F | 379.23 / 336.29 | 90, 95 |

For the AARP rows this may be genuine — they are community-rated (see E1), and
UnitedHealthcare's age discount phasing out produces exactly this shape.

**On BCBSNC I originally wrote "it is not genuine". I cannot support that,
and it has not been changed.**

Attained-age rate tables frequently have a terminal band — an "80+" that
charges one figure for every year above it. If BlueCross BlueShield of North
Carolina files that way, $403.75 at 80, 85, 90 and 95 is correct, and nulling
those cells would delete real data.

What is suspicious is narrow: the male row has 80–95 all carrying that one
figure while the female row is simply empty from 80 on. A real 80+ band would
show on both genders. That asymmetry points at the capture rather than the
filing — but it is an inference, and it is the same species of reasoning that
produced the "Aflac and GPM are transposed" reading, which turned out to be
half wrong. Either the filing or one re-quote settles it. Until then the
figure stands, because a possibly-correct number beats a deleted real one.

### E3. 33 missing cells

AARP/UHC M has no 85/90/95. AARP Select F has no 85/90/95. BCBSNC M is missing
70; BCBSNC F is missing 80 through 95. Medico M is missing 85. GPM, AHIC and
Aflac have no female rows at all.

These no longer render as `$0` — `projectionStats.ts` (merged in `dad1c79`)
treats an unfiled premium as absent rather than as a number, so they show as
gaps. They are still gaps.

### E4. `CIC` is an empty carrier

`active = true`, zero rate rows, no indication of what it is. Deactivate it or
fill it.

---

## Proposed disposition

Nothing below is a write. Each line needs your approval.

| # | action | scope | reversible |
|---|---|---|---|
| 1 | ~~`active = false` on GPM, Aflac, AHIC~~ **done 2026-09-19** | 3 carrier rows | yes |
| 2 | ~~Fix `rating_type` on the 3 AARP rows and Medico~~ **done 2026-09-20** | 4 carrier rows | yes |
| 3 | Add aliases: Cigna→HealthSpring, BCBSNC→BlueCross BlueShield of NC | aliases file | n/a, no DB |
| 4 | Declare the five Group-B fees and AARP Select | aliases file | n/a, no DB |
| 5 | Deactivate or fill `CIC` | 1 carrier row | yes |
| 6a | ~~Relabel GPM / Aflac / AHIC~~ **done 2026-09-20** | 3 carrier rows | yes |
| 6b | Quote female curves for Aflac, Mutual of Omaha, GPM — 21 cells | CMS refresh | n/a |
| 7 | Re-seed the re-quoted carriers through `seed-medsup-projection.mjs` | after 6 | — |

(1) was the only one I treated as urgent: it was live, wrong by 42% and 77%,
and wrong inside a rate comparison. It is done, and (2) followed.

What (1) did NOT do is repair anything. GPM, Aflac and Mutual of Omaha are real
carriers a Durham shopper should be able to compare, and North Carolina now
shows nine where it showed twelve. Step 6 is what puts them back.

Step 6 is the same 14-run procedure the TX capture used, and the age-65 range
check in `seed-medsup-projection.mjs` would have refused both GPM and Aflac on
the way in — neither is within 0.6x–1.8x of its own filed range.

## What I did not do

No aliases written. Group A's name pairs are safe, but Medico's unqualified
name is a real ambiguity about which rate series a consumer is being quoted,
and that is a question about the screen, not about the audit.

No declarations written for Group B either. The evidence is strong — a flat
fee identical to the cent on both genders, replicated across two independent
state captures — but a declaration is a claim that a premium may appear under
a carrier's name without that carrier having filed it, and those should be
yours to make.
