import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:3318";

if (process.env.CI && !process.env.FAMILY_UTILS_TEST_DATABASE_URL) {
  throw new Error("FAMILY_UTILS_TEST_DATABASE_URL is required in CI");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: /(sports-next|champions)\.spec\.ts/,
  workers: 1,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "iPhone viewport", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "Android viewport", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } },
    { name: "WebKit iPhone viewport", testMatch: /library\.spec\.ts/, use: { ...devices["iPhone 13"], defaultBrowserType: "webkit" } },
    { name: "Desktop Chromium", testMatch: /sports\.spec\.ts/, use: { viewport: { width: 1365, height: 900 }, defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "npm run start -- -p 3318",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 45_000,
    env: {
      DATABASE_URL: process.env.FAMILY_UTILS_TEST_DATABASE_URL,
      CODE_PEPPER: process.env.CODE_PEPPER ?? "ci-only-pepper-not-used-outside-ci",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "ci-only-better-auth-secret-not-used-outside-ci",
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
      BETTER_AUTH_URL: baseURL,
      LIBRARY_ENABLED: "true",
      TRAINING_ENABLED: "true",
      SPORTS_ENABLED: "true",
      SPORTS_AGENDA_ENABLED: "true",
      SPORTS_RIVER_RESULTS_ENABLED: "true",
      SPORTS_UFC_PREDICTIONS_ENABLED: "true",
    },
  },
});
