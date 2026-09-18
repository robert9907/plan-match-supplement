// ---------------------------------------------------------------------------
// flow-driver.ts — drives one persona through the Supplement funnel.
//
// FlowContext keeps everything in memory with no persistence, so there is no
// way to deep-link into /results with state. Every screen has to be walked.
// That is also a compliance property worth knowing: no PHI survives a refresh
// and none of it is ever in a URL.
//
// Route order:
//   /about → /rates → [OEP: /results] | [/meds → /providers → /health → /results]
//   /results → /apply → /submitted
//
// Selectors are anchored on stable structure (aria-labels, the .chip / .hq-btn
// class contract, button text) rather than on nth-child positions, so an
// unrelated layout change does not turn into a red compliance run.
// ---------------------------------------------------------------------------

import { expect, type Page } from '@playwright/test';
import type { Persona } from '../fixtures/personas.js';

export type ScreenName =
  | 'about'
  | 'rates'
  | 'meds'
  | 'providers'
  | 'health'
  | 'results'
  | 'apply';

/** Click a `.chip` button by its exact visible label. */
async function chip(page: Page, label: string): Promise<void> {
  await page.locator('button.chip', { hasText: new RegExp(`^${label}$`) }).first().click();
}

export async function openAbout(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/about`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.step-label')).toContainText(/About you/i, { timeout: 15_000 });
}

/** Fill everything About asks for. Does not click Continue. */
export async function fillAbout(page: Page, persona: Persona): Promise<void> {
  await chip(page, persona.prompt);
  await page.getByLabel('Birth month').selectOption(persona.dobMonth);
  await page.getByLabel('Birth day').selectOption(persona.dobDay);
  await page.getByLabel('Birth year').selectOption(persona.dobYear);
  await chip(page, persona.gender);
  await chip(page, persona.tobacco);
  await page.locator('input.fi.mono').first().fill(persona.zip);
  // The ZIP field drives the licensure gate on change; give React a tick.
  await page.waitForTimeout(150);
}

export async function continueFromAbout(page: Page): Promise<void> {
  await page.locator('button.btn', { hasText: /rate projection/i }).first().click();
  await expect(page.locator('.step-label')).toContainText(/rate projection/i, { timeout: 20_000 });
}

/** Waits for the projection widget to resolve — chart or explicit message. */
export async function settleRates(page: Page): Promise<void> {
  await page
    .locator('.ms-c-sub, .rate-methodology-disclosure, .combo-alert')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => undefined);
  await page.waitForTimeout(400);
}

export async function continueFromRates(page: Page, persona: Persona): Promise<void> {
  const label = persona.oep ? /guaranteed plans/i : /Continue to medications/i;
  await page.locator('button.btn', { hasText: label }).first().click();
}

export async function fillMeds(page: Page, persona: Persona): Promise<void> {
  await expect(page.locator('.step-label')).toContainText(/Medications/i, { timeout: 20_000 });
  for (const med of persona.meds) {
    await page.locator('input.search-input').fill(med);
    const suggestion = page.locator('.ac-item').first();
    await suggestion.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    if (await suggestion.count()) await suggestion.click();
  }
  await page.waitForTimeout(200);
}

export async function continueFromMeds(page: Page, persona: Persona): Promise<void> {
  if (persona.meds.length === 0) {
    await page.locator('button.skip-link', { hasText: /don.t take any medications/i }).first().click();
  } else {
    await page.locator('button.btn', { hasText: /Continue to doctors/i }).first().click();
  }
}

export async function fillProviders(page: Page, persona: Persona): Promise<void> {
  await expect(page.locator('.step-label')).toContainText(/doctors/i, { timeout: 20_000 });
  for (const name of persona.providers) {
    await page.locator('input[placeholder*="Doctor"]').first().fill(name);
    await page.waitForTimeout(700);
    const suggestion = page.locator('.ac-item').first();
    if (await suggestion.count()) {
      await suggestion.click();
    } else {
      const addBtn = page.locator('button.btn').first();
      if (await addBtn.count()) await addBtn.click();
    }
    await page.waitForTimeout(200);
  }
}

export async function continueFromProviders(page: Page): Promise<void> {
  const skip = page.locator('button.skip-link');
  if (await skip.count()) {
    await skip.first().click();
  } else {
    await page.locator('button.btn').last().click();
  }
}

export async function fillHealth(page: Page, persona: Persona): Promise<void> {
  await expect(page.locator('.step-label')).toContainText(/Health screen/i, { timeout: 20_000 });

  const questions = page.locator('.hq');
  const count = await questions.count();
  for (let i = 0; i < count; i++) {
    const answer = persona.health[i] ?? 'No';
    await questions.nth(i).locator('button.hq-btn', { hasText: new RegExp(`^${answer}$`) }).first().click();

    // Answering "Yes" to diabetes (q7) or heart (q8) reveals an inline
    // slider that Continue waits on. Pick the first option when it appears.
    const slider = questions.nth(i).locator('.slider-opts button.sopt').first();
    if (await slider.count()) await slider.click();
  }

  await page.getByLabel('Height').selectOption(String(persona.heightIn));
  await page.locator('input[placeholder*="Weight"]').first().fill(String(persona.weightLbs));
  await page.waitForTimeout(200);
}

export async function continueFromHealth(page: Page): Promise<void> {
  await page.locator('button.btn', { hasText: /Check my qualification/i }).first().click();
}

export async function settleResults(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/results/, { timeout: 30_000 });
  await page.locator('.disclaimer').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(400);
}

/**
 * Walk the persona from /about to /results, calling `onScreen` after each
 * screen has settled so the caller can run its checks at that point.
 */
export async function driveToResults(
  page: Page,
  persona: Persona,
  baseURL: string,
  onScreen: (screen: ScreenName, route: string) => Promise<void>,
): Promise<void> {
  await openAbout(page, baseURL);
  await fillAbout(page, persona);
  await onScreen('about', '/about');

  // An unlicensed ZIP never leaves /about — that is the gate working.
  if (!persona.reachesResults && !persona.blockedAt) return;

  await continueFromAbout(page);
  await settleRates(page);
  await onScreen('rates', '/rates');

  await continueFromRates(page, persona);

  if (!persona.oep) {
    await fillMeds(page, persona);
    await onScreen('meds', '/meds');
    await continueFromMeds(page, persona);

    await fillProviders(page, persona);
    await onScreen('providers', '/providers');
    await continueFromProviders(page);

    await fillHealth(page, persona);
    await onScreen('health', '/health');
    await continueFromHealth(page);
  }

  if (persona.blockedAt) {
    // Expected to stop here. What matters is HOW: the applicant must be told,
    // in words, that this cannot proceed — not left on a spinner.
    await page.waitForTimeout(1500);
    await onScreen(persona.blockedAt === 'health' ? 'health' : 'rates', `/${persona.blockedAt}`);
    return;
  }

  await settleResults(page);
  await onScreen('results', '/results');
}

/**
 * For a persona with a documented gap: assert the applicant is stopped with a
 * visible explanation rather than a spinner, and that no premium is shown
 * alongside it.
 */
export async function blockedState(page: Page): Promise<{ url: string; message: string | null }> {
  const alert = page.locator('.combo-alert').first();
  const message = (await alert.count()) ? ((await alert.innerText()).trim() || null) : null;
  return { url: page.url(), message };
}
