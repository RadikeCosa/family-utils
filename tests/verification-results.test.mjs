import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVerificationEvidence } from "../scripts/verification-results.mjs";

async function prepareTrustedTools(directory) {
  const trustedToolsDirectory = path.join(directory, "trusted-tools");
  await mkdir(trustedToolsDirectory);
  for (const name of ["verification-impact.mjs", "run-verification-suites.mjs", "verification-results.mjs"])
    await writeFile(path.join(trustedToolsDirectory, name), `trusted ${name}`);
  process.env.VERIFICATION_TRUSTED_TOOLS_SHA = "a".repeat(40);
  return trustedToolsDirectory;
}

test("verification evidence binds candidate tree, trusted workflow metadata and clean scope", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "family-evidence-"));
  const previous = Object.fromEntries(["GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SERVER_URL", "GITHUB_EVENT_NAME", "GITHUB_WORKFLOW_REF", "VERIFICATION_WORKFLOW_SHA", "VERIFICATION_TRUSTED_TOOLS_SHA", "VERIFICATION_SOURCE_SHA", "VERIFICATION_BASE_SHA", "VERIFICATION_MAIN_SHA", "DATABASE_URL"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    GITHUB_REPOSITORY: "example/family-utils", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SERVER_URL: "https://github.com", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: "example/family-utils/.github/workflows/ci.yml@refs/heads/main",
    VERIFICATION_WORKFLOW_SHA: "a".repeat(40), VERIFICATION_SOURCE_SHA: "b".repeat(40),
    VERIFICATION_BASE_SHA: "a".repeat(40), VERIFICATION_MAIN_SHA: "a".repeat(40),
  });
  delete process.env.DATABASE_URL;
  try {
    const trustedToolsDirectory = await prepareTrustedTools(directory);
    const selectionPath = path.join(directory, "selection.json"), suitePath = path.join(directory, "suite.json");
    await writeFile(selectionPath, JSON.stringify({ mode: "full", groups: ["training"], sharedUi: true, browser: true, reasons: ["test"], files: ["src/app/test.tsx"] }));
    await writeFile(suitePath, JSON.stringify({ ok: true, suites: [{ name: "rules", status: "passed", executed: 1, skipped: 0, unstable: 0 }] }));
    const result = await createVerificationEvidence({ selectionPath, suitePath, jobStatus: "success", trustedToolsDirectory });
    assert.equal(result.approved, true);
    assert.equal(result.workflowPath, ".github/workflows/ci.yml");
    assert.equal(result.workflowSha, "a".repeat(40));
    assert.equal(result.sourceHeadSha, "b".repeat(40));
    assert.equal(Object.keys(result.trustedToolHashes).length, 3);
    assert.equal(result.candidateSha.length, 40);
    assert.equal(result.treeSha.length, 40);
    assert.equal(result.runUrl, "https://github.com/example/family-utils/actions/runs/123");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("verification evidence cannot approve flaky, skipped, documentation-only or failed runs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "family-evidence-"));
  const previous = process.env.DATABASE_URL;
  const previousTrustedSha = process.env.VERIFICATION_TRUSTED_TOOLS_SHA;
  delete process.env.DATABASE_URL;
  try {
    const trustedToolsDirectory = await prepareTrustedTools(directory);
    const selectionPath = path.join(directory, "selection.json"), suitePath = path.join(directory, "suite.json");
    await writeFile(selectionPath, JSON.stringify({ mode: "impact", groups: ["training"], sharedUi: false, browser: true, reasons: [], files: [] }));
    await writeFile(suitePath, JSON.stringify({ ok: true, suites: [{ status: "passed", skipped: 0, unstable: 1 }] }));
    const generate = (jobStatus) => createVerificationEvidence({ selectionPath, suitePath, jobStatus, trustedToolsDirectory });
    assert.equal((await generate("success")).approved, false);
    await writeFile(suitePath, JSON.stringify({ ok: true, suites: [{ status: "passed", skipped: 1, unstable: 0 }] }));
    assert.equal((await generate("success")).approved, false);
    await writeFile(suitePath, JSON.stringify({ ok: true, suites: [{ status: "passed", skipped: 0, unstable: 0 }] }));
    await writeFile(selectionPath, JSON.stringify({ mode: "documentation", groups: [], sharedUi: false, browser: false, reasons: [], files: [] }));
    assert.equal((await generate("success")).approved, false);
    await writeFile(selectionPath, JSON.stringify({ mode: "impact", groups: ["training"], sharedUi: false, browser: true, reasons: [], files: [] }));
    assert.equal((await generate("failure")).approved, false);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    if (previousTrustedSha === undefined) delete process.env.VERIFICATION_TRUSTED_TOOLS_SHA; else process.env.VERIFICATION_TRUSTED_TOOLS_SHA = previousTrustedSha;
    await rm(directory, { recursive: true, force: true });
  }
});
