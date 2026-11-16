import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflowEvidence } from "../scripts/verify-ci-evidence.mjs";

function fixture(overrides = {}) {
  const run = { id: 123, workflow_id: 7, path: ".github/workflows/ci.yml", event: "workflow_dispatch", head_branch: "main", head_sha: "a".repeat(40), status: "completed", conclusion: "success", run_attempt: 1, html_url: "https://github.com/example/family-utils/actions/runs/123" };
  const workflow = { id: 7, path: ".github/workflows/ci.yml" };
  const jobs = [{ name: "check", conclusion: "success", run_attempt: 1 }];
  const artifact = { name: "verification-evidence-123-1", expired: false, created_at: "2026-01-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z", workflow_run: { id: 123, head_sha: "a".repeat(40) } };
  const evidence = { runId: "123", runAttempt: 1, repository: "example/family-utils", event: "workflow_dispatch", workflowPath: ".github/workflows/ci.yml", workflowSha: "a".repeat(40), trustedToolsSha: "a".repeat(40), candidateSha: "b".repeat(40), baseSha: "a".repeat(40), mainSha: "a".repeat(40), approved: true, jobStatus: "success", suiteStatus: "success", suites: [{ name: "Reglas", status: "passed", skipped: 0, unstable: 0 }], unstable: 0, omitted: 0, selection: { mode: "full" }, runUrl: run.html_url };
  const expected = { repository: "example/family-utils", runId: "123", candidateSha: "b".repeat(40), mainSha: "a".repeat(40) };
  return { run, workflow, jobs, artifact, evidence, expected, ...overrides };
}

test("workflow evidence accepts a successful main workflow dispatch with a full candidate run", () => {
  assert.deepEqual(validateWorkflowEvidence(fixture()), { ok: true, errors: [] });
});

test("workflow evidence rejects untrusted workflow, mismatched artifacts, and incomplete results", () => {
  const base = fixture();
  for (const changed of [
    { run: { ...base.run, event: "pull_request" } },
    { run: { ...base.run, head_sha: "c".repeat(40) } },
    { workflow: { ...base.workflow, id: 8 } },
    { artifact: { ...base.artifact, expired: true } },
    { artifact: { ...base.artifact, expires_at: "2026-02-01T00:00:00Z" } },
    { evidence: { ...base.evidence, unstable: 1 } },
    { evidence: { ...base.evidence, omitted: 1 } },
    { evidence: { ...base.evidence, candidateSha: "d".repeat(40) } },
    { evidence: { ...base.evidence, selection: { mode: "impact" } } },
    { jobs: [{ ...base.jobs[0], conclusion: "failure" }] },
  ]) assert.equal(validateWorkflowEvidence({ ...base, ...changed }).ok, false);
});

test("PR evidence is reusable only when the workflow matches main and GitHub confirms the current base", () => {
  const base = fixture();
  const mainSha = "a".repeat(40), sourceSha = "c".repeat(40);
  const run = { ...base.run, event: "pull_request", head_branch: "feature/verification", head_sha: sourceSha };
  const evidence = { ...base.evidence, event: "pull_request", workflowSha: "d".repeat(40), trustedToolsSha: mainSha, sourceHeadSha: sourceSha };
  const pullRequest = { head: { sha: sourceSha }, base: { ref: "main", sha: mainSha, repo: { full_name: "example/family-utils" } } };
  const artifact = { ...base.artifact, workflow_run: { ...base.artifact.workflow_run, head_sha: sourceSha } };
  const args = { ...base, run, artifact, evidence, pullRequest, workflowMatchesMain: true, expected: { ...base.expected, mainSha } };
  assert.equal(validateWorkflowEvidence(args).ok, true);
  assert.equal(validateWorkflowEvidence({ ...args, workflowMatchesMain: false }).ok, false);
  assert.equal(validateWorkflowEvidence({ ...args, pullRequest: { ...pullRequest, base: { ...pullRequest.base, sha: "e".repeat(40) } } }).ok, false);
});

test("post-merge PR evidence is reusable only when its base ancestry and candidate tree still match", () => {
  const base = fixture();
  const treeSha = "f".repeat(40), currentMain = "d".repeat(40), sourceSha = "c".repeat(40);
  const run = { ...base.run, event: "pull_request", head_branch: "feature/verification", head_sha: sourceSha };
  const evidence = { ...base.evidence, event: "pull_request", sourceHeadSha: sourceSha, treeSha };
  const artifact = { ...base.artifact, workflow_run: { ...base.artifact.workflow_run, head_sha: sourceSha } };
  const pullRequest = { head: { sha: sourceSha }, base: { ref: "main", sha: currentMain, repo: { full_name: "example/family-utils" } } };
  const args = { ...base, run, artifact, evidence, pullRequest, workflowMatchesMain: true, integrated: { baseMatches: true }, expected: { ...base.expected, candidateTree: treeSha, mainSha: currentMain } };
  assert.equal(validateWorkflowEvidence(args).ok, true);
  assert.equal(validateWorkflowEvidence({ ...args, expected: { ...args.expected, candidateTree: "e".repeat(40) } }).ok, false);
  assert.equal(validateWorkflowEvidence({ ...args, integrated: false }).ok, false);
});
