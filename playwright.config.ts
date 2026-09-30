import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:3318";

if (process.env.CI && !process.env.FAMILY_UTILS_TEST_DATABASE_URL) {
  throw new Error("FAMILY_UTILS_TEST_DATABASE_URL is required in CI");
}

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "iPhone viewport", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "Android viewport", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "npm run start -- -p 3318",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 45_000,
    env: { BETTER_AUTH_URL: baseURL },
  },
});
