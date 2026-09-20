# Medigap rate scraper — spec

**Status: contract found 2026-09-20. Scraper not yet written.**

Today the Plan G projection chart is built by hand, from HealthSherpa, one
quote form at a time. This spec is for replacing that with a scraper against
medicare.gov, and it exists because the manual route has three limits that
cannot be fixed by doing it more carefully.

## Why the current source is not good enough

**1. HealthSherpa carries twelve NC carriers. CMS lists about thirty-eight.**

Confirmed 2026-09-20 from HealthSherpa's own carrier filter for ZIP 27713:
AARP (UHC of America), AARP (UnitedHealthcare), AHIC, Aflac, Blue Medicare
Supplement, GPM, HIC, Humana Achieve, Humana, Omaha Insurance Company,
Physicians Mutual, Physicians Select. No carriers filter was applied and
default filters were off, so nothing was being hidden.

Absent, and all filed with CMS in NC:

| carrier | M 65 | F 65 |
|---|---|---|
| Atlantic Capital Life (Preferred) — Bankers Fidelity | 116.86 | 101.84 |
| LifeShield National | 142.13 | 123.59 |
| Atlantic Capital Life (Standard) | 145.75 | 126.97 |
| Medico (Preferred) | 147.21 | 128.01 |
| Nassau Life | 151.20 | 131.54 |
| New Era Life of the Midwest | 158.41 | 144.00 |
| WoodmenLife | 175.57 | 152.66 |

The cheapest product HealthSherpa quotes is Physicians Select at $125.70, and
Physicians Select is on the migration-005 suppression list — so the cheapest
figure a consumer actually sees is $151.28. Atlantic Capital files $116.86.
**The chart implies a market floor about 30% above the real one.** That is a
rate-representation problem in the same family as the $0 total fixed in
`dad1c79`: not a wrong number, but a chart that reads as "this is the market"
when it is one distributor's slice of it.

**2. It costs fourteen hand-filled forms per state.** Seven ages x two
genders, through six custom dropdowns each, with a 30-minute CMS session
timeout partway through. TX took a full session. NC is still unfinished.

**3. It goes stale silently.** Humana and Humana Achieve are both ~3.9% below
the June NC capture as of 2026-09-20 (297.29 vs 309.10; 334.01 vs 347.49).
Nothing flagged that. A scrape that can be re-run makes staleness a schedule
instead of a discovery.

## Why CMS is the right source and the current CMS export is not enough

`pm_supp_carrier_rates` already holds every carrier — that is what /results
prices from, which is why Bankers Fidelity appears there and not on the
chart. But it holds **one premium per company/zip/gender, at one age**.
Verified across every row:

| state | plan | rows | rate_min = rate_max | widest ratio |
|---|---|---|---|---|
| NC | G | 912 | 912 | 1.000 |
| TX | G | 740 | 740 | 1.000 |
| GA | G | 648 | 642 | 1.049 |

`rate_min`/`rate_max` being two columns is an artifact of the export format,
not two ages. An age curve runs 2x to 4x.

The table also has **no `age` column** (`id, state, zip, plan, gender,
company, rate_type, rate_min, rate_max, hhd_*, phone, website, address,
scraped_at`). So an age-varying scrape cannot extend it. It must write
`pm_medsup_rate`, which already carries `age` — meaning this scraper
**replaces** the HealthSherpa capture rather than supplementing the CMS one.

## What to build

`scripts/scrape-medigap-rates.ts`, modelled on
`~/Code/plan-match/scripts/scrape-medicare-gov.ts` (1,264 lines, in
production, MA/MAPD/PDP). That script solved the hard part already.

### Bootstrap constraints — carried over, all load-bearing

From the sibling script and `qa/helpers/cms-plan-finder.ts`:

- `channel: 'chrome'` — **not** bundled Chromium. Akamai fingerprints its
  HTTP/2 TLS handshake and drops requests with `ERR_HTTP2_PROTOCOL_ERROR`.
- A real Chrome user-agent string.
- A ~12s warm-up (`SPA_WARMUP_MS`) after first load, before any API call, so
  Akamai's sensor JS can set the `_abck` cookie.
- Every API call fired from inside the page via `page.evaluate` + `fetch`,
  never from Node — the cookie and TLS context have to match.
- Treat HTTP 403 or a body matching `/Access Denied/i` as `AkamaiBlocked`:
  tear the browser down, back off, rotate, retry. IP-level blocks are real;
  typical cooldown 5–30 minutes.
- Rate limit between calls (the MA scraper uses 3.5s).

### The contract — FOUND 2026-09-20

Two endpoints, both under the same `plan-compare` namespace the MA scraper
already uses. Observed live, not guessed; the three guesses recorded in the
first draft of this spec were all near-misses.

    GET /api/v1/data/plan-compare/medigap/plans
        ?state=NC&zipcode=27713&age=65&gender=GENDER_MALE&tobacco=false

      → { request_id, plans: [ 12 plan letters ] }
        each: plan_type, medigap_plan_type, monthly_rate_min,
              monthly_rate_max, monthly_rate_hhd_standard_min/max,
              monthly_rate_hhd_roommate_min/max
        No company names — this is the range across carriers per plan letter.

    GET /api/v1/data/plan-compare/medigap/policies
        ?medigap_plan_type=MEDIGAP_PLAN_TYPE_G
        &state=NC&zipcode=27713&age=65&gender=GENDER_MALE&tobacco=false

      → 37 carriers for NC Plan G, each:
        company, rate_type, monthly_rate_min, monthly_rate_max,
        address, phone_number, website,
        monthly_rate_hhd_standard_min/max, monthly_rate_hhd_roommate_min/max

Parameters: `state` two-letter, `zipcode` five-digit, `age` integer,
`gender` = `GENDER_MALE` | `GENDER_FEMALE`, `tobacco` boolean,
`medigap_plan_type` = `MEDIGAP_PLAN_TYPE_<letter>`. The page also carries a
`fips` in its own URL but the policies call does not take one.

**Not verified:** the household-discount parameter name (the UI has a
selector; the default "No household discount" call omits it), and whether
`year` is accepted.

### This is where medigap_G_N_all.csv came from

The `policies` record maps onto `pm_supp_carrier_rates` field for field —
company, rate_type, rate_min, rate_max, hhd_std_*, hhd_rm_*, phone, website,
address. That settles the question nobody could answer: the CSV was a
by-hand export of this endpoint, at age 65, and the reason the table has no
age column is that whoever ran it only ever ran it once.

### It agrees with HealthSherpa to the cent

Same NC ZIP, same day, both sources:

| | age 65 M | age 80 M |
|---|---|---|
| AFLAC | 179.69 | 293.22 |
| GPM Health and Life | 312.66 | 476.15 |

Those are also the figures sitting in `pm_medsup_rate` — under each other's
names. Two independent sources confirming the transposition recorded in
`docs/nc-projection-correction.md`.

### pm_supp_carrier_rates is stale, and it is live

Comparing the same query against what the table holds for NC Plan G, male 65:

| carrier | in the table | CMS 2026-09-20 | |
|---|---|---|---|
| Atlantic Capital Life (Preferred) | 116.86 | 131.94 | +12.9% |
| LifeShield National | 142.13 | 170.56 | +20.0% |
| Medico Insurance Company (Preferred) | 147.21 | 180.33 | +22.5% |
| New Era Life of the Midwest | 158.41 | 190.09 | +20.0% |
| WoodmenLife | 175.57 | 175.57 | — |
| AFLAC | 179.69 | 179.69 | — |

Some carriers unchanged and others not rules out a query mismatch: these are
real filings that moved. **/results is quoting several carriers up to 22.5%
below what CMS publishes today**, and that is the main carrier list, not the
projection chart. Refreshing it is the same scrape.

Note also that CMS files Medico as three series — Preferred, Standard I,
Standard II. `pm_medsup_carrier` carries one unqualified "Medico Insurance
Company", which is the ambiguity flagged in the correction doc.

### Inputs

- **ZIPs**: the twelve reference ZIPs per state already in
  `pm_supp_carrier_rates`. `select distinct state, zip`.
- **Ages**: 65, 70, 75, 80, 85, 90, 95 — matching `pm_medsup_rate`.
- **Genders**: M, F.
- **Plan**: G first; N is the same shape and can follow.

That is 3 states x 12 zips x 7 ages x 2 genders = **504 queries**. At 3.5s,
about 30 minutes of wall clock per plan letter, unattended.

### Output

Write `pm_medsup_carrier` + `pm_medsup_rate` through the existing
`seed-medsup-projection.mjs` contract — emit `<state>-rates.csv` and
`<state>-carriers.json`, then let that script validate and apply. Do not
write the tables directly. Its checks are the ones that catch a bad scrape:
the age-65 cross-check against the CMS filing, monotonicity on attained-age
curves, and the band-ratio bounds added in `33abae5`.

A scrape covering thirty-eight carriers instead of twelve also makes the
provenance audit close to trivially true — most rows would match their own
company's filing by name, and the policy-form declarations added in `9cf48c7`
would be needed for few or none.

### What this does not solve

- Household-discount and EFT variants, if the Medigap tool exposes them.
- Underwriting status. HealthSherpa distinguishes "Underwriting/With Medical
  Conditions" pricing; CMS may not. If it does not, the projection is
  standard-rate only and should say so.
- Carriers that file with the state but are absent from CMS Plan Finder.

## Next step

The contract above is the thing that was blocking. `scripts/discover-medigap-api.ts`
found its answer and is superseded — kept for the record, not for running.

Build `scripts/scrape-medigap-rates.ts`:

1. `select distinct state, zip from pm_supp_carrier_rates` for the ZIP list.
2. For each state x zip x age {65,70,75,80,85,90,95} x gender x plan {G,N},
   call `medigap/policies` with the bootstrap constraints above.
3. Emit `<state>-rates.csv` + `<state>-carriers.json`, then run them through
   `seed-medsup-projection.mjs --apply <STATE>` so the age-65 cross-check,
   the monotonicity check and the band-ratio bounds all still apply.
4. Separately refresh `pm_supp_carrier_rates` from the age-65 pass, which
   fixes the staleness above.

504 queries per plan letter. At 3.5s between calls that is about half an
hour, unattended.

---

## The age-banded scrape is only valid for attained-age carriers

Found 2026-09-20, after the spec above was written. It invalidates part of it.

### The tell

Across all 4,408 rows in `pm_supp_carrier_rates`, `rate_min` differs from
`rate_max` exactly twelve times — and all twelve are `ISSUE_AGE`. Never once
on an attained-age or community-rated row:

| rate_type | rows | companies | rows with a range |
|---|---|---|---|
| ATTAINED_AGE | 2,800 | 43 | 0 |
| ISSUE_AGE | 1,320 | 29 | 12 |
| COMMUNITY_RATED | 288 | 4 | 0 |

**Georgia is entirely issue-age.** It has no attained-age or community-rated
rows at all.

### Why it matters

The projection chart answers: *what will I pay at 70, 75, 80 as I get older?*

For an **attained-age** carrier, asking CMS for the premium at age 80 answers
that question. The premium is a function of your current age, so a 65-year-old
buyer will be paying the age-80 figure when they turn 80. Walking 65→95 is
exactly right, and it is what the TX seed did.

For an **issue-age** carrier it answers a different question entirely. The
premium is fixed by the age you bought at and does not climb as you age. Asking
CMS for the age-80 figure returns *what a new 80-year-old buyer pays* — not
what a 65-year-old buyer pays at 80, which is much closer to their original
65 rate.

Community-rated is the same trap: everyone pays the same regardless of age, so
an age-varying series is meaningless for them.

So a naive 65→95 walk would plot **29 issue-age and 4 community-rated
companies as though their premiums climb steeply with age, when they do not.**
It would make the carriers whose whole selling point is a stable premium look
like the expensive long-term choice. That is backwards, it is the exact
inverse of what the chart exists to help someone decide, and for Georgia it
would be every single carrier on the screen.

### It separates by state, which makes this much smaller

The counts above are distinct company *names* across all three states, and
that framing overstated the problem badly. Rate type is a property of the
(company, state) pair, not the company — 23 companies file under different
types in different states. Per state:

| | companies | attained-age | exceptions |
|---|---|---|---|
| NC | 38 | 33 | 4 AARP entries (community-rated) + Old Surety (issue-age) |
| TX | 32 | 29 | 2 AARP entries (community-rated) + Old Surety (issue-age) |
| GA | 28 | **0** | all 28 issue-age |

So it is not "two thirds of carriers". It is **AARP and Old Surety, plus the
whole of Georgia.**

That changes the shape of the work:

- **NC and TX** — walk 65→95 as specced. It is correct for 33 of 38 and 29 of
  32. Two named exceptions each, both already identifiable from `rate_type`
  before a single query is made.
- **Georgia** — do not build an age-varying projection at all. Every carrier
  in the state is issue-age, so there is no age curve to build. Georgia gets
  an age-65 comparison or it gets nothing; a rising chart there would be
  wrong for every row on the screen.

The Georgia case is worth stating plainly because it is not a data gap to be
filled later. It is a fact about how Medigap is sold in that state, and a
projection chart of the kind NC and TX have cannot honestly exist for it.

### What the scraper must do instead

Branch on `rate_type`, which the `policies` response already returns:

- **ATTAINED_AGE** — walk 65→95 as specced. Correct as written.
- **ISSUE_AGE** — one query at 65. The curve is that figure held flat, or the
  carrier is shown at 65 only. It must not be plotted as rising.
- **COMMUNITY_RATED** — one query. Flat by definition.

Flat is not perfectly true either: issue-age and community-rated premiums do
rise over time with filed rate increases, they just do not rise *because you
aged*. A flat line understates the real 20-year cost; a rising attained-age
line overstates it badly. Flat is much closer, and the difference belongs in a
disclosure rather than in invented numbers.

**This needs a decision before the age-banded scrape runs**, because it
changes what gets stored, not just what gets drawn:

1. Flat curve at the issue-age-65 rate, with a disclosure that the figure
   holds only until the carrier files an increase.
2. Age-65 cell only, every other band left empty. `projectionStats` already
   renders absent bands as gaps and excludes such carriers from the 20-year
   total, so this is honest and needs no new code — but it drops most
   carriers out of the comparison, and all of Georgia.
3. Store the real filed trend if it can be sourced, which nothing available
   here provides today.

### What already half-anticipates this

`seed-medsup-projection.mjs` warns when a `COMMUNITY_RATED` carrier's premium
varies across ages. Nothing handles `ISSUE_AGE`, and the monotonicity check
only errors on a curve that *dips* — a wrongly-rising issue-age curve passes
every check in the file.

### What this does not affect

The TX projection already seeded. All eight of those carriers are
attained-age, so walking the ages was the right thing for every one of them.
NC's twelve are attained-age or community-rated; the three community-rated
AARP rows already carry a rise, which is its own question, recorded in
`docs/nc-projection-correction.md`.
