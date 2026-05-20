import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Rest Is History frontend.
 *
 * Two projects exercise the same suite at the two viewports the design
 * targets: iPhone 13 (390×844, WebKit) and 1440×900 desktop Chromium.
 * The dev server is reused across tests; CI invokes a fresh one.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] !== undefined ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: process.env["CI"] === undefined,
    timeout: 60_000,
  },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 13"] } },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
