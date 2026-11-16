import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(process.env.FAMILY_UTILS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

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

function git(...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} falló`);
  return result.stdout.trim();
}

function sha256(content) { return createHash("sha256").update(content).digest("hex"); }

export async function createVerificationEvidence({ selectionPath, suitePath, jobStatus = "unknown", trustedToolsDirectory = path.join(root, ".trusted-workflow/scripts") }) {
  const selection = JSON.parse(await readFile(path.resolve(root, selectionPath), "utf8"));
  let suites = null;
  try { suites = JSON.parse(await readFile(path.resolve(root, suitePath), "utf8")); } catch { /* no suite report means incomplete evidence */ }
  const version = JSON.parse(await readFile(path.join(root, "scripts/verification-catalog.json"), "utf8")).version;
  const trustedToolFiles = ["verification-impact.mjs", "run-verification-suites.mjs", "verification-results.mjs"];
  const trustedToolHashes = Object.fromEntries(trustedToolFiles.flatMap((file) => {
    try { return [[`scripts/${file}`, sha256(readFileSync(path.join(trustedToolsDirectory, file)))]]; }
    catch { return []; }
  }));
  let postgresMajor = null;
  if (process.env.DATABASE_URL && selection.mode !== "documentation") {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    try {
      const result = await pool.query("SELECT current_setting('server_version_num')::int AS version");
      postgresMajor = Math.floor(result.rows[0].version / 10000);
    } finally { await pool.end(); }
  }
  const suiteClean = Boolean(suites?.ok && suites.suites?.length && !(suites.notRun?.length) && suites.suites.every((suite) => suite.status === "passed" && !suite.skipped && !suite.unstable));
  const trustedToolsClean = /^[0-9a-f]{40}$/i.test(process.env.VERIFICATION_TRUSTED_TOOLS_SHA ?? "")
    && trustedToolFiles.length === Object.keys(trustedToolHashes).length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: process.env.GITHUB_REPOSITORY ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1),
    runUrl: process.env.GITHUB_RUN_URL ?? (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null),
    event: process.env.GITHUB_EVENT_NAME ?? null,
    workflowPath: process.env.GITHUB_WORKFLOW_REF?.split("@")[0].split("/").slice(2).join("/") ?? ".github/workflows/ci.yml",
    workflowRef: process.env.GITHUB_WORKFLOW_REF ?? null,
    workflowSha: process.env.VERIFICATION_WORKFLOW_SHA ?? null,
    trustedToolsSha: process.env.VERIFICATION_TRUSTED_TOOLS_SHA ?? null,
    trustedToolHashes,
    sourceHeadSha: process.env.VERIFICATION_SOURCE_SHA ?? null,
    candidateSha: git("rev-parse", "HEAD"),
    treeSha: git("rev-parse", "HEAD^{tree}"),
    baseSha: process.env.VERIFICATION_BASE_SHA ?? null,
    mainSha: process.env.VERIFICATION_MAIN_SHA ?? null,
    catalogVersion: version,
    hashes: Object.fromEntries(["scripts/verification-catalog.json", "scripts/verification-policy.json", "scripts/verification-impact.mjs", "scripts/run-verification-suites.mjs", "scripts/verification-results.mjs", "package-lock.json"].map((file) => [file, sha256(readFileSync(path.join(root, file)))])),
    environment: { node: process.version, npm: spawnSync("npm", ["--version"], { cwd: root, encoding: "utf8" }).stdout.trim() || null, postgresMajor },
    selection: { mode: selection.mode, groups: selection.groups, sharedUi: selection.sharedUi, browser: selection.browser, reasons: selection.reasons, files: selection.files, suiteFiles: selection.suiteFiles },
    suites: suites?.suites ?? [],
    suiteStatus: suites?.ok ? "success" : suites ? "failure" : "incomplete",
    unstable: (suites?.suites ?? []).reduce((sum, suite) => sum + (suite.unstable ?? 0), 0),
    omitted: (suites?.suites ?? []).reduce((sum, suite) => sum + (suite.skipped ?? 0), 0) + (suites?.notRun?.length ?? 0),
    jobStatus,
    approved: jobStatus === "success" && suiteClean && trustedToolsClean && selection.mode !== "documentation",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [format, file] = process.argv.slice(2);
    if (format === "--write-evidence") {
      const values = new Map(process.argv.slice(3).map((value, index, args) => value.startsWith("--") ? [value.slice(2), args[index + 1]] : null).filter(Boolean));
      const evidence = await createVerificationEvidence({ selectionPath: values.get("selection") ?? "verification-results/selection.json", suitePath: values.get("suites") ?? "verification-results/suite-summary.json", jobStatus: process.env.JOB_STATUS ?? "unknown" });
      const out = path.resolve(root, values.get("output") ?? "verification-results/verification-evidence.json");
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
      console.log(`Evidencia CI: ${path.relative(root, out)} (${evidence.approved ? "aprobada" : "no aprobada"})`);
      if (!evidence.approved && !(evidence.selection.mode === "documentation" && evidence.jobStatus === "success")) process.exitCode = 1;
    } else {
      const content = readFileSync(file, "utf8");
      if (!["tap", "playwright", "playwright-failures"].includes(format)) throw new Error("Unknown report format");
      if (format === "playwright-failures") console.log(playwrightFailures(JSON.parse(content)));
      else console.log((format === "tap" ? parseTap(content) : parsePlaywright(JSON.parse(content))).join("|"));
    }
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
