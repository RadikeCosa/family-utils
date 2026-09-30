import { defineConfig } from "@playwright/test";

const port = 3319;

export default defineConfig({
  testDir: "./tests",
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
    env: { ...process.env, BETTER_AUTH_URL: `http://localhost:${port}` },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
