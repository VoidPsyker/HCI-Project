import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".", testMatch: "*.spec.ts", workers: 1, retries: 0,
  timeout: 30000, reporter: "list",
  use: { baseURL: "http://127.0.0.1:8790", channel: "chromium", viewport: { width: 1920, height: 1080 } }
});
