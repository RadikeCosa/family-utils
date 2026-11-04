import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: /recipes\.spec\.ts/, workers: 1, reporter: "list",
  use: { baseURL: "http://localhost:3390", trace: "retain-on-failure" },
  projects: [
    { name: "Recipes iPhone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "Recipes Android", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } },
  ],
  webServer: { command: "npm run start -- -p 3390", url: "http://localhost:3390", reuseExistingServer: false, env: {
    DATABASE_URL: process.env.FAMILY_UTILS_TEST_DATABASE_URL, BETTER_AUTH_URL: "http://localhost:3390", BETTER_AUTH_SECRET: "recipes-e2e-only-secret-at-least-32-not-production", CODE_PEPPER: "recipes-e2e-only-pepper-at-least-32-not-production", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", RECIPES_ENABLED: "true",
  } },
});
