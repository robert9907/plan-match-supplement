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

---

## 2026-09-20: the offsets are a source disagreement, not a fee

A live HealthSherpa quote settled the open questions above. Anonymous agent
session, ZIP 27713 / Durham County, effective 10/01/2026, male 65, GI No,
non-smoker, no household discount, no EFT, 5'10" 175 lb, born 03/15/1961,
Part A and B 03/01/2026, MACRA Yes — the same parameter set the TX capture
used.

Eleven Plan G products came back, and every one reproduces the stored age-65
male premium **to the cent**, three months after the 2026-06-13 pull:

| HealthSherpa, 2026-09-20 | premium | pm_medsup_rate age 65 M |
|---|---|---|
| AARP Plan G (UnitedHealthcare Insurance Company) — Community Rated | 188.79 | 188.79 |
| AARP Plan G (UnitedHealthcare Insurance Company of America) — Community Rated | 208.57 | 208.57 |
| AARP Select Plan G — Community Rated | 151.28 | 151.28 |
| Blue Medicare Supplement Plan G | 205.50 | 205.50 |
| Plan G from HealthSpring Insurance Company (HIC) | 171.92 | 171.92 |
| Aetna Health Insurance Company (AHIC) Plan G | 208.25 | 208.25 |
| Humana Medicare Supplement Plan G | 191.42 | 191.42 |
| MED SUPP PLAN G 2010 (Aflac) | 179.69 | 179.69 |
| Omaha Insurance Company NM24H | 212.34 | 212.34 |
| PSIC Plan G | 172.72 | 172.72 |
| PSIC Innovative Plan G | 125.70 | 125.70 |

So the NC projection is **not stale**. I had said it was, on the strength of
its 2026-06-13 seed date and 2026-07-01 effective date, and that was wrong.
The rates simply have not moved.

That disposes of the "flat fee" reading of Group B. The +$2.00 / +$4.00 /
+$5.00 gaps are not something the pipeline adds — they are HealthSherpa and
CMS Plan Finder reporting different figures for the same product on the same
day. CMS files AARP/UnitedHealthcare NC at 186.79 male; HealthSherpa quotes
188.79. Both are current. Neither is a defect.

The consequence for the audit is structural, not incidental: the projection is
HealthSherpa-sourced and `pm_supp_carrier_rates` is CMS-sourced, so
`audit-medsup-provenance.mjs` compares two systems that disagree by design.
Every NC carrier with a nonzero offset will fail it forever. That is a question
about what the audit should assert, and it should be settled before anyone
writes a declaration to paper over an individual row.

### Aliases, now written

`carrier-aliases.json` gains five entries. Each is sourced by premium: the same
figure, same portal, same parameter set, so the projection row and the
HealthSherpa row are the same product.

  Cigna National Health Insurance Company   -> HealthSpring Insurance Company
  Blue Medicare Supplement (BCBSNC)         -> BlueCross BlueShield of North Carolina
  Humana Medicare Supplement                -> Humana (Humana Benefit Plan of Illinois, Inc.)
  Humana Achieve Medicare Supplement        -> Humana Achieve (CompBenefits Insurance Company)
  PSIC - Innovative                         -> Physicians Select Insurance Company (Innovative)

Note the limit of that evidence. The premium match sources the projection ->
HealthSherpa half. The HealthSherpa -> CMS half is still matched on name alone,
because those two differ by the offset above and cannot be matched on figures.
The first entry is the one to watch: the stored name says Cigna National Health
Insurance Company, but the row is HealthSherpa's HealthSpring Insurance Company
listing at 171.92. Those are two different NAIC entities under one parent. The
stored label is probably just wrong, and renaming it would beat aliasing it.

### Two things this raised

**Medico is not offered in NC on HealthSherpa.** Its carrier list for 27713
returns twelve carriers and Medico is not among them, yet the projection holds
NC Medico at 128.01 F / 147.21 M. CMS does file Medico in NC. So those two
cells came from somewhere other than the stated source, and their ratio against
the CMS Preferred series is 0.81634 and 0.81633 — one constant, both genders,
which is a discount basis rather than a rate. Worth tracing before step 7.

**AARP reads Community Rated in a third independent place.** CMS returns
COMMUNITY_RATED with one statewide figure across all twelve sampled ZIPs,
pm_medsup_carrier.rating_type says community, and HealthSherpa prints
"Community Rated" on all three AARP entities. The projection still draws them
rising 59% to 105% from 65 to 95. scripts/check-rating-shape.mjs fails on
exactly those six curves and is deliberately not yet in the gate.

### Correction, same day: the offset is carrier-specific and fee-shaped

Applying the five aliases resolves four of the ten age-65 NC cells outright,
and the four that resolve are the informative ones:

| stated | g | premium | CMS filed | offset |
|---|---|---|---|---|
| Blue Medicare Supplement (BCBSNC) | F | 179.50 | 179.50 | **0.00** |
| Blue Medicare Supplement (BCBSNC) | M | 205.50 | 205.50 | **0.00** |
| Cigna National -> HealthSpring | F | 149.50 | 149.50 | **0.00** |
| Cigna National -> HealthSpring | M | 171.92 | 171.92 | **0.00** |
| Humana Medicare Supplement | F / M | 169.63 / 191.42 | 167.63 / 189.42 | +2.00 |
| Humana Achieve | F / M | 194.48 / 223.35 | 192.48 / 221.35 | +2.00 |
| PSIC - Innovative | F / M | 114.22 / 125.70 | 109.22 / 120.70 | +5.00 |

I wrote above that this is a source disagreement rather than a fee. That was
too quick. HealthSherpa and CMS agree to the cent on BCBSNC, HealthSpring,
Aetna, Aflac and Mutual of Omaha — five carriers, zero offset. General source
noise does not land on exactly zero five times and on exactly $2.00, $4.00 and
$5.00 the rest of the time, identically on both genders. A per-carrier charge
that HealthSherpa includes in the quote and CMS excludes from the filed
premium fits the shape; a reporting discrepancy does not.

Per-carrier offsets observed so far, all NC, all Plan G, both genders alike:

  0.00   BCBSNC, HealthSpring, Aetna, Aflac, Mutual of Omaha
  +2.00  AARP/UnitedHealthcare, Humana, Humana Achieve
  +4.00  AARP/UnitedHealthcare of America
  +5.00  Physicians Select, Physicians Select Innovative
  +6.17  GPM (male only on record, so the both-genders test cannot run)

What it is has not been established, and naming it without a carrier document
would be the same mistake as the two fictitious policy forms. What is now
settled is that it is not noise, not staleness, and not something the pipeline
introduces.

Medico does not fit this pattern at all: its gap is multiplicative and
negative, 0.81634 and 0.81633 against the CMS Preferred series. Combined with
its absence from HealthSherpa's NC carrier list, those two cells need their
provenance traced rather than explained.

### Age 70, and the rating-shape guard loses its premise

Second run, identical parameters, male 70 (born 03/15/1956, Part A and B
03/01/2021, MACRA still Yes). Eleven Plan G products; nine reproduce the
stored age-70 male premium to the cent:

  133.80  PSIC Innovative          166.16  AARP Select (Community Rated)
  175.81  HealthSpring (HIC)       183.97  PSIC
  187.48  Aflac                    207.36  AARP/UHC (Community Rated)
  220.91  Aetna (AHIC)             226.48  Omaha Insurance Company
  231.33  AARP/UHC of America (Community Rated)

Two do not, and both are Humana:

  Humana Medicare Supplement   stored 211.08, quoted 204.99   -6.09
  Humana Achieve               stored 239.28, quoted 231.01   -8.27

Both matched exactly at 65 (191.42 and 223.35). So Humana refiled its age
curve since 2026-06-13 while leaving the age-65 rate alone. That is real
staleness, scoped to two carriers at ages 70 and above, and it is the only
staleness this exercise has actually found.

The larger result is about the guard. HealthSherpa quotes all three AARP
entities **rising with age while printing "Community Rated" on the same card**:

  AARP/UHC             188.79 at 65 -> 207.36 at 70   +9.8%
  AARP Select          151.28 at 65 -> 166.16 at 70   +9.8%
  AARP/UHC of America  208.57 at 65 -> 231.33 at 70  +10.9%

The projection is not inventing that climb. It is reproducing the source to
the cent at both ages. So scripts/check-rating-shape.mjs, which I wrote today
on the premise that a community-rated curve must be flat, would fail on a
faithful capture. Its regulatory premise is still right; what is wrong is the
assumption that a failure implicates our data.

The script's header and its failure message now say so, and it stays out of
gate.config.json. It is a reporting check until someone reads AARP's filed NC
rate manual and establishes which is true: a flat community rate carrying an
enrollment discount that declines with age, or a label that does not describe
the product. I am not asserting either. CMS publishing exactly one statewide
figure per AARP entity is consistent with that figure being the age-65 rate
and nothing more.
