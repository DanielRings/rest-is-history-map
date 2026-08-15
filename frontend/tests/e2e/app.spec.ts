/**
 * End-to-end behavior tests for the map-first UI.
 *
 * The persistent episode panel is gone; episodes surface in a transient
 * country popup. Tests drive the same store/event paths a real user would,
 * via `window.__setTimeWindow`, `window.__hoverCountry`, and
 * `window.__clickCountry` to bypass canvas/touch flakiness on WebKit.
 *
 * Episode-count semantics: only episodes with at least one country tag are
 * surfaced at all. The 13-episode fixture has 3 non-geographic episodes
 * (kind: interview/themed/meta with empty countries) which are excluded.
 * That leaves 10 geographic episodes to choose from.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const READY_SELECTOR = 'main#app[data-app-ready="true"]';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PATH = path.resolve(__dirname, "../../../data/samples/episodes.sample.json");
const SAMPLE_JSON = readFileSync(SAMPLE_PATH, "utf-8");

test.beforeEach(async ({ page }) => {
  await page.route("**/data/episodes.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: SAMPLE_JSON }),
  );
  // The default filter set hides Club episodes; the sample fixture's
  // Saturnalia entry is members-only and several tests assert on it.
  // Land on the page with all filters off so those assertions hold.
  await page.goto("/#-3000,2025/20.000,10.000,0.00/f=none");
  await expect(page.locator(READY_SELECTOR)).toBeVisible({ timeout: 30_000 });
});

test("no popup at rest", async ({ page }) => {
  await expect(page.locator(".country-popup")).toBeHidden();
});

test("hover Italy → popup shows Caesar, Augustus, Saturnalia", async ({ page }) => {
  await page.evaluate(() => window.__hoverCountry?.("ITA"));
  await expect(page.locator(".country-popup")).toBeVisible();
  const cards = page.locator(".country-popup .ep-card");
  await expect(cards).toHaveCount(3);
  const guids = await cards.evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset["guid"] ?? ""),
  );
  expect(new Set(guids)).toEqual(
    new Set(["sample-caesar-ides", "sample-augustus", "sample-bonus-saturnalia"]),
  );
});

test("click Italy → popup pinned with same three episodes", async ({ page }) => {
  await page.evaluate(() => window.__clickCountry?.("ITA"));
  await page.waitForTimeout(800);
  const guids = await page
    .locator(".country-popup .ep-card")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset["guid"] ?? ""));
  expect(new Set(guids)).toEqual(
    new Set(["sample-caesar-ides", "sample-augustus", "sample-bonus-saturnalia"]),
  );
});

test("Saturnalia bonus shows a Club badge", async ({ page }) => {
  await page.evaluate(() => window.__hoverCountry?.("ITA"));
  const card = page.locator('.country-popup [data-guid="sample-bonus-saturnalia"]');
  await expect(card).toBeVisible();
  await expect(card.locator(".club-badge")).toBeVisible();
  await expect(card.locator(".club-badge")).toHaveText(/club/i);
});

test("scrub to AD 1400–1500 narrows Italy popup to zero (no Italy match)", async ({ page }) => {
  await page.evaluate(() => window.__setTimeWindow?.(1400, 1500));
  await page.evaluate(() => window.__hoverCountry?.("ITA"));
  // Italy has no episodes overlapping 1400–1500 in the fixture, so the
  // popup either doesn't open (unlit country) or shows the empty state.
  // __hoverCountry on an unlit country surfaces only the label popup; the
  // rich country popup stays hidden.
  await expect(page.locator(".country-popup")).toBeHidden();
});

test("scrub to AD 1400–1500: Turkey popup shows the two Constantinople episodes", async ({
  page,
}) => {
  await page.evaluate(() => window.__setTimeWindow?.(1400, 1500));
  await page.evaluate(() => window.__hoverCountry?.("TUR"));
  await expect(page.locator(".country-popup")).toBeVisible();
  const guids = await page
    .locator(".country-popup .ep-card")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset["guid"] ?? ""));
  expect(new Set(guids)).toEqual(new Set(["sample-constantinople-1", "sample-constantinople-2"]));
});

test("URL hash updates after timeline scrub and after country click", async ({ page }) => {
  const initialHash = await page.evaluate(() => window.location.hash);
  expect(initialHash).toMatch(
    /^#-?\d+,-?\d+\/-?\d+\.\d{3},-?\d+\.\d{3},-?\d+\.\d{2}(?:\/f=[a-z,]+)?$/,
  );

  // Hash writes are debounced on a quiet period (see HASH_WRITE_IDLE_MS):
  // continuous motion writes nothing and one write lands once things settle,
  // so the assertion is eventual, not synchronous. The contract being tested
  // is "a shared URL reflects the state you stopped at", which still holds.
  await page.evaluate(() => window.__setTimeWindow?.(1400, 1500));
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain("1400,1500");
  const afterScrub = await page.evaluate(() => window.location.hash);
  expect(afterScrub).not.toBe(initialHash);

  await page.evaluate(() => window.__clickCountry?.("TUR"));
  // Same country clicked once → no fly yet; click again to commit-zoom and
  // change mapCenter/zoom in the hash.
  await page.evaluate(() => window.__clickCountry?.("TUR"));
  await expect.poll(() => page.evaluate(() => window.location.hash)).not.toBe(afterScrub);
});
