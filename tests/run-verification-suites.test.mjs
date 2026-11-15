import assert from "node:assert/strict";
import test from "node:test";
import { parsePlaywright } from "../scripts/run-verification-suites.mjs";

test("Playwright reports count and identify failures without accepting skipped tests", () => {
  const report = {
    suites: [{
      specs: [
        { title: "passes", tests: [{ status: "expected", projectName: "Chromium" }] },
        { title: "missing browser dependency", tests: [{ status: "unexpected", projectName: "WebKit", results: [{ errors: [{ message: "launch failed\nmore details" }] }] }] },
        { title: "skipped", tests: [{ status: "skipped" }] },
      ],
      suites: [{ specs: [{ title: "nested failure", tests: [{ status: "unexpected", results: [{ status: "failed", error: { message: "assertion failed" } }] }] }] }],
    }],
  };

  assert.deepEqual(parsePlaywright(JSON.stringify(report)), {
    executed: 4,
    passed: 1,
    failed: 2,
    skipped: 1,
    failures: [
      { title: "missing browser dependency", project: "WebKit", message: "launch failed" },
      { title: "nested failure", project: "desconocido", message: "assertion failed" },
    ],
  });
});

test("empty or invalid Playwright reports fail closed", () => {
  assert.equal(parsePlaywright("not-json"), null);
  assert.equal(parsePlaywright(JSON.stringify({ suites: [] })), null);
});
