import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:3318";

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
