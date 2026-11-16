#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCiEvidence } from "./verify-ci-evidence.mjs";

const api = "https://api.github.com";

export function findMergedPullRequest(pullRequests, repository, mergeSha) {
  const matches = pullRequests.filter((pr) => pr.merged_at
    && pr.merge_commit_sha === mergeSha
    && pr.base?.ref === "main"
    && pr.base?.repo?.full_name === repository
    && pr.head?.repo?.full_name === repository
    && /^[0-9a-f]{40}$/i.test(pr.head?.sha ?? ""));
  return matches.length === 1 ? matches[0] : null;
}

export function successfulPullRequestRuns(runs, headSha) {
  return runs.filter((run) => run.event === "pull_request"
    && run.status === "completed"
    && run.conclusion === "success"
    && run.head_sha === headSha
    && run.path === ".github/workflows/ci.yml")
    .sort((left, right) => Date.parse(right.updated_at ?? 0) - Date.parse(left.updated_at ?? 0));
}

async function getJson(url, token) {
  const response = await fetch(url, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" } });
  if (!response.ok) throw new Error(`GitHub API ${response.status} al consultar ${new URL(url).pathname}`);
  return response.json();
}

export async function tryReuseIntegratedVerification({ repository, candidateSha, token = process.env.GITHUB_TOKEN, root = process.cwd() }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) throw new Error("Repositorio GitHub inválido.");
  if (!/^[0-9a-f]{40}$/i.test(candidateSha ?? "")) throw new Error("SHA integrado inválido.");
  if (!token) throw new Error("Falta GITHUB_TOKEN con lectura de Actions y pull requests.");
  const base = `${api}/repos/${repository}`;
  const pullRequests = await getJson(`${base}/commits/${candidateSha}/pulls?per_page=100`, token);
  if (!Array.isArray(pullRequests)) throw new Error("La API no devolvió la lista de PR asociados.");
  const pullRequest = findMergedPullRequest(pullRequests, repository, candidateSha);
  if (!pullRequest) return { reused: false, reason: "No hay un único PR integrado que corresponda al commit de main." };
  const workflowRuns = await getJson(`${base}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pullRequest.head.sha}&status=completed&per_page=100`, token);
  const runs = successfulPullRequestRuns(workflowRuns.workflow_runs ?? [], pullRequest.head.sha);
  const mainSha = candidateSha;
  const failures = [];
  for (const run of runs) {
    const result = await verifyCiEvidence({ repository, runId: run.id, candidateSha, mainSha, token, root });
    if (result.ok) return { reused: true, reason: "La evidencia del PR coincide con el árbol integrado, la base y el workflow confiable.", runId: run.id, runUrl: result.runUrl };
    failures.push(...result.errors);
  }
  return { reused: false, reason: runs.length ? `La evidencia del PR no es reutilizable: ${[...new Set(failures)].join("; ")}` : "El PR no tiene una ejecución CI aprobada disponible." };
}

async function main() {
  const result = await tryReuseIntegratedVerification({
    repository: process.env.GITHUB_REPOSITORY,
    candidateSha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN,
  });
  const output = process.env.GITHUB_OUTPUT;
  if (output) await appendFile(output, `reused=${result.reused}\nrun_id=${result.runId ?? ""}\nrun_url=${result.runUrl ?? ""}\nreason=${result.reason.replace(/[\r\n]/g, " ")}\n`);
  if (result.reused) console.log(`Se reutiliza la verificación ${result.runUrl}.`);
  else console.log(`Se ejecutará verificación completa: ${result.reason}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    const reason = error.message.replace(/[\r\n]/g, " ");
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `reused=false\nreason=${reason}\n`);
    console.error(`No se pudo comprobar la reutilización; se ejecutará todo: ${reason}`);
  }
}
