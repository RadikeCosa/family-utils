import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePreflight } from "../scripts/preflight-publicacion.mjs";

const candidate = "a".repeat(40), deployed = "b".repeat(40), main = "c".repeat(40);
function input(overrides = {}) {
  return {
    mode: "code", candidateSha: candidate, deployedSha: deployed, mainSha: main, destination: "production",
    ancestor: true, containsMain: true, historyComplete: true, changes: [], databaseUrlPresent: false, tools: {},
    evidence: {
      deployment: { id: "deployment-1", url: "https://example.vercel.app", state: "READY", target: "production", commitSha: deployed, verifiedAt: new Date().toISOString() },
      fullSuite: { status: "success", complete: true, commitSha: candidate, mainSha: main, runUrl: "https://github.com/example/actions/runs/1" }
    },
    ...overrides,
  };
}

test("code preflight accepts only current deployment evidence and full suite for candidate", () => {
  assert.equal(evaluatePreflight(input()).ok, true);
});

test("code mode rejects migration, metadata, deferred SQL, and schema changes", () => {
  for (const file of ["drizzle/0069_feature.sql", "drizzle/meta/_journal.json", "drizzle-deferred/index.sql", "src/db/schema.ts"]) {
    assert.equal(evaluatePreflight(input({ changes: [{ status: "A", path: file }] })).ok, false, file);
  }
});

test("preflight rejects modified or deleted existing migration files", () => {
  for (const status of ["M", "D", "R100"]) {
    assert.ok(evaluatePreflight(input({ mode: "schema", changes: [{ status, path: "drizzle/0001_initial.sql" }] })).errors.some((error) => error.includes("No se permite modificar")));
  }
});

test("preflight rejects stale deployed state, mismatched destination, divergent ancestry, and partial suite evidence", () => {
  assert.ok(evaluatePreflight(input({ evidence: { ...input().evidence, deployment: { ...input().evidence.deployment, verifiedAt: "2020-01-01T00:00:00.000Z" } } })).errors.some((error) => error.includes("actual")));
  assert.ok(evaluatePreflight(input({ destination: "preview" })).errors.some((error) => error.includes("destino")));
  assert.ok(evaluatePreflight(input({ ancestor: false })).errors.some((error) => error.includes("desciende")));
  assert.ok(evaluatePreflight(input({ evidence: { ...input().evidence, fullSuite: { status: "success", complete: false, commitSha: candidate, mainSha: main, runUrl: "https://github.com/example/actions/runs/1" } } })).errors.some((error) => error.includes("suite completa")));
});

test("schema and transition require direct connection, compatible tools, and synthetic populated rehearsal", () => {
  const evidence = input().evidence;
  evidence.data = { backupRestoreVerified: true, rehearsal: Object.fromEntries(["isolated", "syntheticFixtures", "existingRows", "relations", "constraints", "edgeCases", "historicalCases", "invariantsPassed"].map((key) => [key, true])) };
  evidence.data.compatibility = { previousCodeWorks: true };
  const base = input({ mode: "schema", evidence, databaseUrlPresent: true, tools: { psql: true, pg_dump: true, pg_restore: true }, serverMajor: 18, dumpMajor: 18 });
  assert.equal(evaluatePreflight(base).ok, true);
  assert.equal(evaluatePreflight({ ...base, databaseUrlPresent: false }).ok, false);
  assert.equal(evaluatePreflight({ ...base, dumpMajor: 17 }).ok, false);
});
