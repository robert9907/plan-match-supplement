# Plan Match Supplement — AI Session Instructions

Read this first, every session. This codebase has hard rails you must not break.

## Identity

This is **Plan Match Supplement** — the Medicare Supplement (Medigap) pre-qualification
and application flow. It is a **different product under different regulators** than the
two sibling repos. Do not carry rules across without checking which regime applies:

| Repo | Surface | Regime |
|---|---|---|
| `~/Code/plan-match` | consumer MA/PDP widget, `planmatch.generationhealth.me` | CMS MCMG (42 CFR 422.2260–2276) |
| `~/planmatch/planmatch` | agent-v3, `agent.generationhealth.me` | CMS MCMG |
| **this repo** | Supplement, `supplement.generationhealth.me` | **NAIC Medigap Model Act + state DOI + 45 CFR §92** |
| `~/Code/plan-match-aca` | ACA | FFM / web-broker rules |

**Never edit another repo's folder from this session.** If a task seems to require it, stop and ask Rob.

## Owner

- Rob Simm — solo NC Medicare/ACA broker, NPN #10447418, phone **(828) 761-3326**. Never 3324.
- Appointed in **NC, TX, GA only** (`src/lib/licensedStates.ts`). Any other state of residence is unlicensed:
  do not show rates, do not accept an application. NC GS §58-33-26, TX Ins. Code §4001.101, GA OCGA §33-23-4.
- GitHub `robert9907`. Rob approves each migration before execution and wants commits after every meaningful
  change, pushed immediately.

## Tech stack (locked)

- Vite + React 18 + TypeScript, **npm** (not pnpm — the sibling repos use pnpm; don't copy their commands)
- State: React Context only (`src/context/FlowContext.tsx`)
- Vercel serverless functions under `api/`, `"type": "module"` → **Node ESM at runtime**
- Supabase, two projects (below)

### ESM trap — this has real teeth

`package.json` sets `"type": "module"`, so Vercel loads compiled `api/*.js` as Node ESM.
Strict ESM resolution rejects extensionless relative imports at runtime with
`ERR_MODULE_NOT_FOUND` **at cold start** — the function 500s, not the build.
Every relative import under `api/` must carry `.js`:

```ts
import { applyCors } from './_lib/cors.js';        // correct
import { applyCors } from './_lib/cors';           // 500s in production
```

`api/tsconfig.json` (module: NodeNext) exists to catch exactly this at compile time and is
wired into the gate. If it errors on an extension, **add the extension** — do not switch
the tsconfig to `bundler`/`ESNext` to make the error go away.

## Typecheck

- `npm run typecheck` → `typecheck:app` (root tsconfig, `include: ["src"]`) **then** `typecheck:api`
  (`api/tsconfig.json`).
- Before `api/tsconfig.json` was added (2026-09-17), everything under `api/` — enroll, MBI
  crypto, scan-mbi, rates — shipped with **no typecheck at all**. Keep both halves.

## TWO Supabase projects

Picking the wrong one silently returns empty rows.

### Project A — `plan-match-prod` (`rpcbrkmvalvdmroqzpaq`)
- Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Medigap rate data + the application landing table:
  `pm_medsup_carrier`, `pm_medsup_rate`, `pm_medsup_rate_history`, `pm_supp_carrier_rates`,
  `pm_medsup_carrier_exclusions`, the `_public` views, and `supplement_applications`.
- Migrations `003` and `005` target this project.

### Project B — `agentbase` (`wyyasqvouvdcovttzfnv`) — Rob's CRM
- Env: `AGENTBASE_SUPABASE_URL`, `AGENTBASE_SUPABASE_SERVICE_ROLE_KEY`
- `clients`, `leads`, `calls`, `client_medications`, `client_providers`.
- Migrations `001`, `002`, `004` target this project. **Never DROP, TRUNCATE or ALTER an
  AgentBase table** — real client data.
- The Supabase CLI in this repo is linked to **agentbase**, so `003`/`005` are applied by hand
  against the correct project. Check which project a migration targets before running it.

Show every migration SQL to Rob and wait for an explicit "go".

## Carrier suppression — the hard one

Migration `005` suppresses carriers Generation Health cannot broker — currently
**Physicians Select Insurance Company**, **MedMutual Protect**, **Physicians Life Insurance
Company**. The mechanism:

- anon/authenticated `SELECT` is **revoked** on `pm_medsup_rate`, `pm_medsup_carrier`,
  `pm_supp_carrier_rates`
- reads go through `pm_medsup_rate_public` / `pm_supp_carrier_rates_public`, which filter
  `pm_medsup_carrier_exclusions`

**Every consumer read uses the `_public` view. Never the base table.** A base-table read
either 401s on an anon path or — worse, on the service-role path — puts a carrier Rob can't
sell in front of a consumer. `scripts/check-medsup-view.sh` enforces this and the ship gate
runs it on every push. Do not weaken the grep to make a new read pass.

After every rate-scraper refresh, check `pm_medsup_suppression_audit` for drift: unexpected
new rows = pattern over-reach; a known carrier missing = the scraper renamed it.

## Compliance text — exact, never paraphrased

These are regulated disclosures, not copy. All are in `protectedPaths`, so editing one
prompts Rob before the edit lands.

- **`src/lib/section-1557.ts`** — nondiscrimination notice, civil-rights grievance contact,
  HHS OCR pointer, top-15 language taglines (45 CFR §92.10). Mirrored in `~/Code/plan-match`
  and `~/Code/plan-match-aca`. **Keep all three in sync** — a change here is a change there.
- **`src/components/NondiscriminationFooter.tsx`** — renders the above plus the
  Medicare.gov / 1-800-MEDICARE (TTY 1-877-486-2048) pointer.
- **`src/components/MedigapDisclosures.tsx`** — Guaranteed Issue rights enumeration and
  state rating-methodology explainer (CMS Medigap Guide §3, 42 CFR §403.205, NAIC Model Act §13).
- **`src/components/MedSupRateDisclosure.tsx`** — rate methodology, effective date,
  gender/tobacco basis. NAIC Model Act §13 requires the rating type (attained-age /
  issue-age / community-rated) be disclosed wherever a premium is shown.
- **`src/components/Application.tsx`** — carrier authorizations (indices 0–3) and the
  **TCPA consent at index 4**. Under 47 CFR §64.1200(f)(9) (eff. 2025-01-27) prior express
  written consent must be **separately and conspicuously** identified — it cannot be bundled
  into the carrier authorization, and agreeing to the authorizations must not be construed as
  TCPA consent. `FlowContext` stamps `authChecks[4]`'s timestamp for the audit trail. Keep the
  index-4 slot, the separation, and the timestamp.

Standing content rules:

- Underwriting must be disclosed wherever a score or premium appears: acceptance is **not
  guaranteed**, final rates come from the carrier's underwriting department.
- Medigap does **not** cover prescription drugs — the standalone Part D statement stays on
  Results. Pointing to Part D is a required disclosure here, not a scope violation.
- Rates are estimates from Medicare.gov / SERFF filings, not a quote.
- **The TPMO disclaimer does not belong here.** 42 CFR §422.2267(e)(41) governs MA/PDP.
  Medigap is state-regulated. Don't paste the MA disclaimer onto a Medigap screen, and don't
  strip the Medigap disclosures to match the MA repo.

## Fit score — open compliance question (2026-09-17, unresolved)

Results shows a 0–100 fit score, a score ring, and a **"Top match"** badge. The consumer repo's
`checkRankingLanguage` bans `top pick` / `recommended plan` / `#1 match` outright under MCMG
§30.6, and commit `6082e2e` already softened this repo's scoring copy to likelihood language
for the same reason.

Rob's call (2026-09-17): **flag, don't change.** Leave "Top match" alone until a Supplement
compliance harness reports on it and he reviews the findings. Do not rename it on your own
initiative, and do not add a ranking-language exemption either.

## Compliance test coverage

`qa/` is the Medigap compliance sweep. `npm run test:compliance`. It builds HEAD, serves it
locally, and stubs every API call with `page.route()` — the absolute-URL library endpoints and
the Supabase analytics beacon included — so a run is offline, deterministic, and describes the
commit being pushed rather than whatever is deployed.

Four personas walk the real funnel: `oep-nc`, `underwritten-nc`, `underwritten-tx`,
`unlicensed-ny`. ~245 checks. The punch list lands in `qa/reports/medigap-compliance.md`.

Findings carry a severity, and the distinction is deliberate:

- **`fail`** — a legally required disclosure is missing, or something touches PHI. These block
  the push. There is a right answer and the harness knows it.
- **`warn`** — a judgement call that belongs to Rob: marketing wording, small type. Printed in
  full with surrounding context every run, never gating.
- **`info`** — recorded without acting. The `"Top match"` ranking-language question lives here.

Do not promote a `fail` to `warn` to get a green run. Fix the disclosure or ask Rob.

Two things this does NOT cover: the `/apply` screen and the TCPA consent block are not yet
walked (the sweep stops at `/results`), and `underwritten-tx` stops at `/health` by design —
see `blockedAt` in `qa/fixtures/personas.ts`.

Separately, `qa/tests/aca-supplement.spec.ts` in `~/Code/plan-match/qa` still smoke-tests this
surface against production, and its `checkScope(page, ['Medigap'])` call is **wrong here** —
Results legitimately mentions Part D, so it reports a false positive. Allow `['Medigap', 'PDP']`
when that spec is next touched.

## Gates — enforced by hooks, not by memory

- Every `git commit`: `npm run typecheck` (app + api + qa) must pass.
- Every `git push`: typecheck **and** `scripts/check-medsup-view.sh`, on a clean tree, with the
  pushed branch checked out.
- A push touching `brainPaths` also needs a passing compliance sweep on that exact commit:
  `node scripts/gate/full-audit.mjs`. `fullAudit.enabled` is **true**.
- Dry run anytime: `node scripts/gate/ship-gate.mjs manual`.
- Edits to `scripts/gate/`, `.claude/hooks/`, `.githooks/`, `CLAUDE.md`, `api/tsconfig.json`, or
  any of the compliance components listed above trigger an approval prompt for Rob.
- If a gate blocks you, fix the cause. Never use `--no-verify`, change `core.hooksPath`, deploy
  with the Vercel CLI, or edit gate files to get past a failure. Those prompt Rob.
- Report results with the real numbers from the output, including failures. Never summarize a
  failing run as passing.

## How work is done here

- One agreed task per session. Don't drift into adjacent fixes; list anything you noticed at the end.
- Rob runs parallel Claude Code sessions. Before committing, check `git status` and `git log -5`.
  Never commit, revert, or "clean up" changes you didn't make.
- Read a file before editing it. Search for an existing implementation before writing a new one.
- Run commands yourself. Never hand Rob terminal commands to paste.

If anything in this file seems wrong, ask — don't assume it's stale.
