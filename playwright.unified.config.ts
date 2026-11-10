import { defineConfig } from "@playwright/test";
const database = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if (
  !database ||
  !["localhost", "127.0.0.1"].includes(new URL(database).hostname) ||
  !new URL(database).pathname.endsWith("_test")
)
  throw new Error(
    "Unified UI tests require an isolated local database ending in _test",
  );
const shared = {
  DATABASE_URL: database,
  DATABASE_URL_UNPOOLED: database,
  BETTER_AUTH_SECRET: "unified-ui-local-only-secret-at-least-32-characters",
  CODE_PEPPER: "unified-ui-local-only-pepper-at-least-32-characters",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  LIBRARY_ENABLED: "true",
  RECIPES_ENABLED: "true",
  TRAINING_ENABLED: "true",
  SPORTS_ENABLED: "true",
  SPORTS_AGENDA_ENABLED: "true",
  SPORTS_RIVER_RESULTS_ENABLED: "true",
  SPORTS_UFC_PREDICTIONS_ENABLED: "true",
};
export default defineConfig({
  outputDir: "test-results-unified",
  testDir: "./tests/e2e",
  testMatch: /unified\.spec\.ts/,
  workers: 1,
  timeout: 45_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3411",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: "Chromium", use: { browserName: "chromium" } },
    {
      name: "WebKit navigation",
      grep: /drawer shares|recipe filter|converter mode/,
      use: { browserName: "webkit" },
    },
  ],
  webServer: [
    {
      command: "npm run start -- -p 3411",
      url: "http://localhost:3411",
      env: {
        ...shared,
        BETTER_AUTH_URL: "http://localhost:3411",
        UNIFIED_UI_ENABLED: "true",
        UNIFIED_UI_PREVIEW_MEMBER_IDS: "",
      },
    },
    {
      command: "npm run start -- -p 3412",
      url: "http://localhost:3412",
      env: {
        ...shared,
        BETTER_AUTH_URL: "http://localhost:3412",
        UNIFIED_UI_ENABLED: "false",
        UNIFIED_UI_PREVIEW_MEMBER_IDS: "",
      },
    },
    {
      command: "npm run start -- -p 3413",
      url: "http://localhost:3413",
      env: {
        ...shared,
        BETTER_AUTH_URL: "http://localhost:3413",
        UNIFIED_UI_ENABLED: "false",
        UNIFIED_UI_PREVIEW_MEMBER_IDS: "11111111-1111-4111-8111-111111111111",
      },
    },
    {
      command: "npm run start -- -p 3414",
      url: "http://localhost:3414",
      env: {
        ...shared,
        BETTER_AUTH_URL: "http://localhost:3414",
        UNIFIED_UI_ENABLED: "true",
        UNIFIED_UI_PREVIEW_MEMBER_IDS: "",
        LIBRARY_ENABLED: "false",
        RECIPES_ENABLED: "false",
        SPORTS_ENABLED: "false",
        SPORTS_AGENDA_ENABLED: "false",
        SPORTS_RIVER_RESULTS_ENABLED: "false",
        SPORTS_UFC_PREDICTIONS_ENABLED: "false",
        TRAINING_ENABLED: "false",
      },
    },
  ],
});
