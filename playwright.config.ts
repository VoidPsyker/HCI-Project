import { defineConfig, devices } from "@playwright/test";

/**
 * Acceptance suite for the six experiment menus.
 *
 * The app under test is expected to be running already: the Docker stack on
 * http://127.0.0.1:8787 by default. Set PW_BASE_URL to test another host.
 */
const baseURL = process.env.PW_BASE_URL ?? "http://127.0.0.1:8787";
const isCI = Boolean(process.env.CI);
// Sibling agents may run Playwright in the same checkout. Keep artifacts in a
// caller-chosen directory so their cleanup cannot delete an in-flight trace.
const outputDir = process.env.PW_OUTPUT_DIR ?? "test-results";
const reportDir = process.env.PW_REPORT_DIR ?? "playwright-report";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  workers: isCI ? 2 : 3,
  timeout: 120_000,
  expect: {
    timeout: 8_000
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: reportDir }]],
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-GB",
    timezoneId: "Europe/London",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 }
      }
    }
  ]
});
