import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /webgazer-runtime\.spec\.ts$/,
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    headless: true,
    channel: "chromium",
    viewport: { width: 1280, height: 720 },
    video: "off",
    screenshot: "off",
    trace: "off"
  }
});
