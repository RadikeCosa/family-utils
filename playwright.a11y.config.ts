import { defineConfig } from "@playwright/test";

const port = 3319;

export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results-a11y",
  testMatch: "accessibility.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: process.env.A11Y_BASE_URL ?? `http://localhost:${port}`,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "retain-on-failure",
  },
  webServer: process.env.A11Y_BASE_URL ? undefined : {
    command: `npm run start -- -p ${port}`,
    env: {
      ...process.env,
      DATABASE_URL: process.env.FAMILY_UTILS_TEST_DATABASE_URL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "ci-only-better-auth-secret-not-used-outside-ci",
      CODE_PEPPER: process.env.CODE_PEPPER ?? "ci-only-pepper-not-used-outside-ci",
      LIBRARY_ENABLED: "true",
      BETTER_AUTH_URL: `http://localhost:${port}`,
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
