import assert from "node:assert/strict";
import test from "node:test";
import { findMergedPullRequest, successfulPullRequestRuns } from "../scripts/reuse-main-verification.mjs";

test("main evidence reuse requires one merged PR for the integrated commit and same repository", () => {
  const pr = { merged_at: "2026-11-16T10:00:00Z", merge_commit_sha: "a".repeat(40), base: { ref: "main", repo: { full_name: "example/family-utils" } }, head: { sha: "b".repeat(40), repo: { full_name: "example/family-utils" } } };
  assert.equal(findMergedPullRequest([pr], "example/family-utils", "a".repeat(40)), pr);
  assert.equal(findMergedPullRequest([{ ...pr, head: { ...pr.head, repo: { full_name: "fork/family-utils" } } }], "example/family-utils", "a".repeat(40)), null);
  assert.equal(findMergedPullRequest([pr, pr], "example/family-utils", "a".repeat(40)), null);
});

test("only successful CI pull request runs for the merged source commit can be reused", () => {
  const run = { id: 1, event: "pull_request", status: "completed", conclusion: "success", head_sha: "b".repeat(40), path: ".github/workflows/ci.yml", updated_at: "2026-11-16T10:00:00Z" };
  const older = { ...run, id: 2, updated_at: "2026-11-15T10:00:00Z" };
  assert.deepEqual(successfulPullRequestRuns([older, run, { ...run, conclusion: "failure" }, { ...run, event: "push" }], "b".repeat(40)).map((item) => item.id), [1, 2]);
});
