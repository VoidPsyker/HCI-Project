import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /diagnostic-paired\.spec\.ts$/,
  timeout: 150_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    headless: true,
    channel: "chromium",
    viewport: { width: 1920, height: 1080 },
    video: "off",
    screenshot: "off",
    trace: "off"
  }
});
