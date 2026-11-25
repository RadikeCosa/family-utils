import assert from "node:assert/strict";
import test from "node:test";
import { parsePlaywright, parseTap, playwrightRetryCount, shouldStopLocally } from "../scripts/run-verification-suites.mjs";

test("runner retries Playwright once only in GitHub Actions and stops local suites at first failure", () => {
  // Pass the local value explicitly so the assertion is stable inside GitHub Actions too.
  assert.equal(playwrightRetryCount("", ""), 0);
  assert.equal(playwrightRetryCount("true", ""), 1);
  assert.equal(playwrightRetryCount("true", "0"), 0);
  assert.equal(playwrightRetryCount("", "1"), 1);
  assert.equal(shouldStopLocally(undefined, false), true);
  assert.equal(shouldStopLocally("true", false), false);
  assert.equal(shouldStopLocally(undefined, true), false);
});

test("TAP summaries count cancelled and TODO tests as non-approving and preserve failure details", () => {
  const report = parseTap(`# tests 4
# pass 1
# fail 1
# cancelled 1
# skipped 0
# todo 1
not ok 2 - assertion regression
  ---
  error: 'Expected 2 to equal 3'
  ...
`);
  assert.deepEqual(report, {
    executed: 4,
    passed: 1,
    failed: 2,
    skipped: 1,
    failures: [{ title: "assertion regression", message: "Expected 2 to equal 3" }],
  });
  assert.equal(parseTap("# tests 0\n# pass 0\n# fail 0\n"), null);
});

test("TAP summaries retain multiline assertion messages", () => {
  const report = parseTap(`# tests 1
# pass 0
# fail 1
not ok 1 - multiline assertion
  ---
  error: |-
    AssertionError: expected the route to succeed
      at TestContext.<anonymous> (tests/example.test.mjs:10:2)
  ...
`);
  assert.equal(report.failures[0].message, "AssertionError: expected the route to succeed\n  at TestContext.<anonymous> (tests/example.test.mjs:10:2)");
});

test("Playwright reports count and identify failures without accepting skipped tests", () => {
  const report = {
    suites: [{
      specs: [
        { title: "passes", tests: [{ status: "expected", projectName: "Chromium" }] },
        { title: "flaky", tests: [{ status: "flaky", projectName: "WebKit" }] },
        { title: "missing browser dependency", tests: [{ status: "unexpected", projectName: "WebKit", results: [{ errors: [{ message: "launch failed\nmore details" }] }] }] },
        { title: "skipped", tests: [{ status: "skipped" }] },
      ],
      suites: [{ specs: [{ title: "nested failure", tests: [{ status: "unexpected", results: [{ status: "failed", error: { message: "assertion failed" } }] }] }] }],
    }],
  };

  assert.deepEqual(parsePlaywright(JSON.stringify(report)), {
    executed: 5,
    passed: 1,
    failed: 3,
    skipped: 1,
    unstable: 1,
    failures: [
      { title: "missing browser dependency", project: "WebKit", message: "launch failed" },
      { title: "nested failure", project: "desconocido", message: "assertion failed" },
    ],
  });
});

test("empty or invalid Playwright reports fail closed", () => {
  assert.equal(parsePlaywright("not-json"), null);
  assert.equal(parsePlaywright(JSON.stringify({ suites: [] })), null);
  assert.deepEqual(parsePlaywright(JSON.stringify({ suites: [], errors: [{ message: "global setup failed" }] })), {
    executed: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    unstable: 0,
    failures: [{ title: "Error global de Playwright", project: "runner", message: "global setup failed" }],
  });
});
