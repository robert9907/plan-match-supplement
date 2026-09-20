# Medigap rate scraper — spec

**Status: proposal. No code beyond the discovery harness exists yet.**

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

### The one unknown

The MA scraper targets `/api/v1/data/plan-compare/...`. **The Medigap
endpoint is not known.** Three guesses were probed on 2026-09-20 and all
returned 404:

    /api/v1/data/medigap/policies
    /api/v1/data/medigap-compare/policies
    /medigap-supplemental-insurance-plans/api/policies

Do not guess a fourth. `cms-plan-finder.ts` records what guessing costs:

> the SPA lays out the plan list across a multi-step wizard that's hard to
> drive programmatically (see git history — 4 rounds of blind iteration
> didn't clear the wizard past the drug entry step)

An attempt to drive the wizard from the Chrome extension on 2026-09-20 hit
exactly that: the ZIP went in, Next did nothing, no API call fired. Find the
contract by observation, once, with `scripts/discover-medigap-api.ts` (below),
and write it into this document before any scraper code is written.

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

## Step 1 — find the contract

`scripts/discover-medigap-api.ts` opens the Medigap tool in real Chrome with
the bootstrap above, drives the wizard **with a human watching** (`MG_HEADFUL=1`
is the default), and logs every XHR to `data/medigap-api-capture.json`:
method, path, query keys, request body shape and response shape — values
redacted, shape only.

Run it once. Paste the contract into this document. Then write the scraper.
