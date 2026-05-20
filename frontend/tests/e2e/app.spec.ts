/**
 * End-to-end tests covering the five assertions in the W2 brief.
 *
 * The tests target the same store/event code paths a real user drives, but
 * call the `window.__setTimeWindow` and `window.__clickCountry` hooks to
 * avoid the canvas-drag and map-hit-test fragility that bites on iPhone
 * WebKit. The hooks are dispatched via `page.evaluate`.
 */

import { expect, test } from "@playwright/test";

const READY_SELECTOR = 'main#app[data-app-ready="true"]';

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(READY_SELECTOR)).toBeVisible({ timeout: 30_000 });
});

test("loads all 13 fixture episodes", async ({ page }) => {
  const cards = page.locator(".ep-card");
  await expect(cards).toHaveCount(13);
});

test("scrub to AD 1400–1500 narrows to the three 15th-century-overlapping episodes", async ({
  page,
}) => {
  // NOTE: the W2 brief named Constantinople 1, Constantinople 2, and Mongol
  // Empire — but Mongol Empire (1206-1368) ends before 1400 and so does
  // not overlap; the Hundred Years' War episode (1337-1453) does. The
  // predicate's actual behavior is the source of truth (see
  // src/filter/predicate.ts:timelineOverlaps).
  await page.evaluate(() => window.__setTimeWindow?.(1400, 1500));
  const cards = page.locator(".ep-card");
  await expect(cards).toHaveCount(3);
  const guids = await cards.evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset["guid"] ?? ""),
  );
  expect(new Set(guids)).toEqual(
    new Set(["sample-constantinople-1", "sample-constantinople-2", "sample-live-london"]),
  );
});

test("click Italy → sidebar shows Caesar, Augustus, Saturnalia", async ({ page }) => {
  await page.evaluate(() => window.__clickCountry?.("ITA"));
  // Allow fitBounds animation + moveend recompute.
  await page.waitForTimeout(800);
  const guids = await page
    .locator(".ep-card")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset["guid"] ?? ""));
  expect(new Set(guids)).toEqual(
    new Set(["sample-caesar-ides", "sample-augustus", "sample-bonus-saturnalia"]),
  );
});

test("Saturnalia bonus shows a Club badge", async ({ page }) => {
  const card = page.locator('[data-guid="sample-bonus-saturnalia"]');
  await expect(card).toBeVisible();
  await expect(card.locator(".club-badge")).toBeVisible();
  await expect(card.locator(".club-badge")).toHaveText(/club/i);
});

test("URL hash updates after timeline scrub and after country click", async ({ page }) => {
  const initialHash = await page.evaluate(() => window.location.hash);
  expect(initialHash).toMatch(/^#-?\d+,-?\d+\/-?\d+\.\d{3},-?\d+\.\d{3},-?\d+\.\d{2}$/);

  await page.evaluate(() => window.__setTimeWindow?.(1400, 1500));
  const afterScrub = await page.evaluate(() => window.location.hash);
  expect(afterScrub).not.toBe(initialHash);
  expect(afterScrub).toContain("1400,1500");

  await page.evaluate(() => window.__clickCountry?.("ITA"));
  // The hash includes mapCenter+zoom; wait for moveend then read.
  await page.waitForTimeout(900);
  const afterClick = await page.evaluate(() => window.location.hash);
  expect(afterClick).not.toBe(afterScrub);
});
