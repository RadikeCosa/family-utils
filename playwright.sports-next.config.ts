import { defineConfig, devices } from "@playwright/test";

if (!process.env.FAMILY_UTILS_TEST_DATABASE_URL)
  throw new Error(
    "FAMILY_UTILS_TEST_DATABASE_URL es obligatorio: estas pruebas requieren una base aislada.",
  );
const testPort = process.env.SPORTS_NEXT_TEST_PORT ?? "3318";
const baseURL = `http://localhost:${testPort}`;

if (process.env.CI && !process.env.FAMILY_UTILS_TEST_DATABASE_URL) {
  throw new Error("FAMILY_UTILS_TEST_DATABASE_URL is required in CI");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /sports-next\.spec\.ts/,
  workers: 1,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "iPhone viewport",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
    {
      name: "Android viewport",
      use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" },
    },
    {
      name: "WebKit iPhone viewport",
      testMatch: /sports-next\.spec\.ts/,
      use: { ...devices["iPhone 13"], defaultBrowserType: "webkit" },
    },
    {
      name: "Desktop Chromium",
      testMatch: /sports-next\.spec\.ts/,
      use: {
        viewport: { width: 1365, height: 900 },
        defaultBrowserType: "chromium",
      },
    },
  ],
  webServer: {
    command: `npm run start -- -p ${testPort}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 45_000,
    env: {
      BETTER_AUTH_URL: baseURL,
      LIBRARY_ENABLED: "true",
      SPORTS_ENABLED: "true",
      SPORTS_AGENDA_ENABLED: "true",
      SPORTS_RIVER_RESULTS_ENABLED: "true",
      SPORTS_UFC_PREDICTIONS_ENABLED: "true",
      DATABASE_URL: process.env.FAMILY_UTILS_TEST_DATABASE_URL,
    },
  },
});
