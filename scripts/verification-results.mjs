import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parseTap(text) {
  const last = name => [...text.matchAll(new RegExp(`^(?:#|ℹ) ${name}\\s+(\\d+)\\s*$`, "gm"))].at(-1)?.[1];
  const tests = Number(last("tests"));
  const passed = Number(last("pass"));
  const failed = Number(last("fail")) + Number(last("cancelled") ?? 0);
  const skipped = Number(last("skipped") ?? 0) + Number(last("todo") ?? 0);
  if (![tests, passed, failed, skipped].every(Number.isSafeInteger)
    || tests <= 0 || passed + failed + skipped !== tests) throw new Error("Missing or inconsistent TAP summary");
  return [tests, passed, failed, skipped];
}

export function parsePlaywright(report) {
  let tests = 0, passed = 0, failed = 0, skipped = 0;
  function visit(suite) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      tests++;
      if (test.status === "skipped") skipped++;
      else if (test.status === "expected") passed++;
      else failed++; // Includes flaky, unexpected and interrupted tests.
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites ?? []) visit(suite);
  if (!tests) throw new Error("Empty Playwright report");
  // Global setup/teardown errors can occur even when individual tests passed.
  if (report.errors?.length) { tests++; failed++; }
  return [tests, passed, failed, skipped];
}

export function playwrightFailures(report) {
  const lines = [];
  function visit(suite, parents = []) {
    const titles = [...parents, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      if (test.status === "expected") continue;
      lines.push(`[${test.projectName ?? "browser"}] ${[...titles, spec.title].join(" > ")}: ${test.status ?? "unknown"}`);
      for (const result of test.results ?? []) for (const error of result.errors ?? []) {
        lines.push(error.message ?? error.value ?? "Unknown browser error");
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  }
  for (const suite of report.suites ?? []) visit(suite);
  for (const error of report.errors ?? []) lines.push(error.message ?? "Global Playwright error");
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [format, file] = process.argv.slice(2);
    const content = readFileSync(file, "utf8");
    if (!["tap", "playwright", "playwright-failures"].includes(format)) throw new Error("Unknown report format");
    if (format === "playwright-failures") console.log(playwrightFailures(JSON.parse(content)));
    else console.log((format === "tap" ? parseTap(content) : parsePlaywright(JSON.parse(content))).join("|"));
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
