import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: /training-(diary|activity)\.spec\.ts/, workers: 1,
  outputDir: "test-results-training-diary/browser", reporter: "list", timeout: 45_000,
  use: { trace: "retain-on-failure", actionTimeout: 10_000 },
  projects: [
    { name: "diary-mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "diary-desktop", use: { viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Tokyo" } },
    { name: "diary-webkit", use: { ...devices["iPhone 13"], defaultBrowserType: "webkit" } },
  ],
});
