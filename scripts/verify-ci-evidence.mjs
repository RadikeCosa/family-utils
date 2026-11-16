import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const api = "https://api.github.com";

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} falló`);
  return result.stdout;
}

function sha(content) { return createHash("sha256").update(content).digest("hex"); }

export function validateWorkflowEvidence({ run, workflow, jobs, artifact, evidence, expected, workflowMatchesMain = false, pullRequest = null, integrated = false, now = Date.now() }) {
  const errors = [];
  const workflowPath = ".github/workflows/ci.yml";
  if (workflow.path !== workflowPath || run.path !== workflowPath || run.workflow_id !== workflow.id) errors.push("La ejecución no proviene del workflow CI esperado.");
  if (run.event === "workflow_dispatch") {
    if (run.head_branch !== "main" || run.head_sha !== expected.mainSha || evidence.workflowSha !== expected.mainSha || evidence.trustedToolsSha !== expected.mainSha) errors.push("La ejecución manual debe usar el workflow y herramientas vigentes de main.");
  } else if (run.event === "pull_request") {
    if (!pullRequest || pullRequest.head?.sha !== run.head_sha || pullRequest.base?.ref !== "main" || pullRequest.base?.repo?.full_name !== expected.repository) errors.push("La ejecución PR no acredita el commit fuente y repositorio esperados.");
    if (!integrated && pullRequest?.base?.sha !== expected.mainSha) errors.push("La ejecución PR no acredita la base main vigente.");
    if (integrated && !integrated.baseMatches) errors.push("La integración no conserva la base verificada ni el árbol certificado.");
    if (!workflowMatchesMain) errors.push("El workflow del PR difiere del workflow confiable de main.");
    if (evidence.trustedToolsSha !== evidence.baseSha) errors.push("El selector y runner no provienen de la base confiable del PR.");
    if (evidence.sourceHeadSha !== run.head_sha) errors.push("La evidencia no corresponde al commit fuente del PR.");
  } else errors.push("El evento de la ejecución no puede certificar un candidato.");
  if (run.id !== Number(expected.runId) || run.status !== "completed" || run.conclusion !== "success") errors.push("La ejecución CI no terminó aprobada o su ID no coincide.");
  if (run.run_attempt !== evidence.runAttempt || evidence.runId !== String(run.id) || evidence.repository !== expected.repository) errors.push("La identidad o intento de la evidencia no coincide con la API.");
  const expiresAt = Date.parse(artifact.expires_at ?? "");
  const createdAt = Date.parse(artifact.created_at ?? "");
  if (artifact.name !== `verification-evidence-${run.id}-${run.run_attempt}` || artifact.expired || !Number.isFinite(expiresAt) || expiresAt <= now || !Number.isFinite(createdAt) || expiresAt - createdAt < 89 * 24 * 60 * 60 * 1000) errors.push("El artefacto no existe, venció, no cumple 90 días o no corresponde a esta ejecución.");
  if (artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== run.head_sha) errors.push("El artefacto pertenece a otra ejecución.");
  if (evidence.event !== run.event || evidence.workflowPath !== workflowPath) errors.push("La evidencia no acredita la identidad del workflow esperado.");
  const candidateMatches = expected.candidateTree
    ? evidence.treeSha === expected.candidateTree
    : evidence.candidateSha === expected.candidateSha;
  const baseMatches = evidence.mainSha === expected.mainSha && evidence.baseSha === expected.mainSha
    || run.event === "pull_request" && integrated?.baseMatches === true && evidence.baseSha === evidence.mainSha;
  if (!candidateMatches || !baseMatches) errors.push("El árbol candidato o la base de la evidencia no coincide con el preflight.");
  if (!/^[0-9a-f]{40}$/i.test(evidence.candidateSha ?? "") || !/^[0-9a-f]{40}$/i.test(evidence.workflowSha ?? "")) errors.push("La evidencia no contiene SHA válidos del candidato y del workflow.");
  if (evidence.approved !== true || evidence.jobStatus !== "success" || evidence.suiteStatus !== "success") errors.push("La suite no tiene estado aprobado en el artefacto.");
  if (!["impact", "full"].includes(evidence.selection?.mode)) errors.push("El artefacto no declara un alcance funcional aprobable.");
  if (!Array.isArray(evidence.suites) || !evidence.suites.length || evidence.suites.some((suite) => suite.status !== "passed" || suite.skipped || suite.unstable)) errors.push("El detalle de suites no acredita resultados limpios.");
  if (evidence.unstable !== 0 || evidence.omitted !== 0) errors.push("La evidencia contiene pruebas inestables u omitidas.");
  if (evidence.selection?.mode !== "full") errors.push("La ejecución manual certificadora debe cubrir el inventario completo.");
  if (evidence.runUrl !== run.html_url) errors.push("El enlace de la ejecución no coincide con la API de GitHub.");
  if (!jobs.some((job) => job.name === "check" && job.conclusion === "success" && job.run_attempt === run.run_attempt)) errors.push("El job de verificación no aprobó en el intento certificado.");
  return { ok: errors.length === 0, errors };
}

async function getJson(url, token) {
  const response = await fetch(url, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" } });
  if (!response.ok) throw new Error(`GitHub API ${response.status} al consultar ${new URL(url).pathname}`);
  return response.json();
}

function readArtifact(archive) {
  const listing = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" });
  if (listing.status !== 0) throw new Error("No se pudo inspeccionar el artefacto ZIP.");
  const paths = listing.stdout.split(/\r?\n/).filter((entry) => entry.endsWith("verification-evidence.json"));
  if (paths.length !== 1 || paths[0].startsWith("/") || paths[0].split("/").includes("..")) throw new Error("El artefacto no contiene un manifiesto de evidencia único y seguro.");
  const extracted = spawnSync("unzip", ["-p", archive, paths[0]], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (extracted.status !== 0) throw new Error("No se pudo leer el manifiesto del artefacto.");
  return JSON.parse(extracted.stdout);
}

function suiteFilesForScope(catalog, groups, full, sharedUi) {
  const node = new Set(), route = new Set(), browser = new Map();
  for (const name of groups) {
    const domain = catalog.domains?.[name];
    if (!domain) continue;
    for (const file of domain.nodeTests ?? []) node.add(file);
    for (const file of domain.routeTests ?? []) route.add(file);
    for (const suite of domain.browser ?? []) {
      const files = browser.get(suite.kind) ?? new Set();
      for (const file of suite.files) files.add(file);
      browser.set(suite.kind, files);
    }
  }
  if (full) {
    for (const file of catalog.sharedNodeTests ?? []) node.add(file);
    for (const file of catalog.sharedRouteTests ?? []) route.add(file);
  }
  if (full || sharedUi) for (const suite of catalog.sharedBrowser ?? []) {
    const files = browser.get(suite.kind) ?? new Set();
    for (const file of suite.files) files.add(file);
    browser.set(suite.kind, files);
  }
  return { node: [...node].sort(), route: [...route].sort(), browser: [...browser].map(([kind, files]) => ({ kind, files: [...files].sort() })).sort((a, b) => a.kind.localeCompare(b.kind)) };
}

function unionSuiteFiles(left, right) {
  const node = [...new Set([...left.node, ...right.node])].sort();
  const route = [...new Set([...left.route, ...right.route])].sort();
  const browser = new Map();
  for (const item of [...left.browser, ...right.browser]) {
    const files = browser.get(item.kind) ?? new Set();
    for (const file of item.files) files.add(file);
    browser.set(item.kind, files);
  }
  return { node, route, browser: [...browser].map(([kind, files]) => ({ kind, files: [...files].sort() })).sort((a, b) => a.kind.localeCompare(b.kind)) };
}

function readGitJson(root, ref, file) {
  const result = spawnSync("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`No se pudo leer ${file} en ${ref}.`);
  return JSON.parse(result.stdout);
}

export async function verifyCiEvidence({ repository, runId, candidateSha, mainSha, token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN, root = process.cwd() }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) throw new Error("Repositorio GitHub inválido.");
  if (!token) throw new Error("Se requiere GH_TOKEN o GITHUB_TOKEN con lectura de Actions.");
  if (!/^[0-9]+$/.test(String(runId))) throw new Error("ID de ejecución inválido.");
  const base = `${api}/repos/${repository}`;
  const [run, workflow, jobsResponse, artifactsResponse] = await Promise.all([
    getJson(`${base}/actions/runs/${runId}`, token),
    getJson(`${base}/actions/workflows/ci.yml`, token),
    getJson(`${base}/actions/runs/${runId}/jobs?per_page=100`, token),
    getJson(`${base}/actions/runs/${runId}/artifacts?per_page=100`, token),
  ]);
  const artifact = artifactsResponse.artifacts?.find((item) => item.name === `verification-evidence-${runId}-${run.run_attempt}`);
  if (!artifact) throw new Error("No existe el artefacto de evidencia de esa ejecución.");
  const temp = await mkdtemp(path.join(os.tmpdir(), "family-utils-ci-evidence-"));
  try {
    const response = await fetch(`${base}/actions/artifacts/${artifact.id}/zip`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
    if (!response.ok) throw new Error(`No se pudo descargar el artefacto (${response.status}).`);
    const archive = path.join(temp, "evidence.zip");
    const archiveBytes = Buffer.from(await response.arrayBuffer());
    await writeFile(archive, archiveBytes);
    if (artifact.digest && artifact.digest !== `sha256:${sha(archiveBytes)}`) throw new Error("El digest del artefacto no coincide con la API de GitHub.");
    const evidence = readArtifact(archive);
    for (const [label, value] of [["SHA de base", evidence.baseSha], ["SHA main", evidence.mainSha], ["SHA candidato", evidence.candidateSha], ["SHA de workflow", evidence.workflowSha], ["SHA de herramientas confiables", evidence.trustedToolsSha]]) {
      if (!/^[0-9a-f]{40}$/i.test(value ?? "")) throw new Error(`La evidencia contiene un ${label} inválido.`);
    }
    if (run.event === "pull_request" && !/^[0-9a-f]{40}$/i.test(evidence.sourceHeadSha ?? "")) throw new Error("La evidencia no contiene el SHA fuente del PR.");
    const candidateTree = git(root, "rev-parse", `${candidateSha}^{tree}`).trim();
    const baseCatalogRef = evidence.baseSha;
    const [workflowAtRun, workflowAtBase, workflowAtMain, associatedPullRequests, testedCommit] = await Promise.all([
      getJson(`${base}/contents/${workflow.path}?ref=${encodeURIComponent(evidence.workflowSha)}`, token),
      getJson(`${base}/contents/${workflow.path}?ref=${encodeURIComponent(baseCatalogRef)}`, token),
      getJson(`${base}/contents/${workflow.path}?ref=${encodeURIComponent(mainSha)}`, token),
      run.event === "pull_request" ? getJson(`${base}/commits/${run.head_sha}/pulls?per_page=100`, token) : Promise.resolve([]),
      run.event === "pull_request" ? getJson(`${base}/commits/${evidence.candidateSha}`, token) : Promise.resolve(null),
    ]);
    const pullRequest = Array.isArray(associatedPullRequests)
      ? associatedPullRequests.find((item) => item.head?.sha === run.head_sha && item.base?.ref === "main" && item.base?.repo?.full_name === repository)
      : null;
    const workflowMatchesMain = workflowAtRun.path === workflow.path && workflowAtBase.path === workflow.path && workflowAtMain.path === workflow.path
      && workflowAtRun.sha === workflowAtBase.sha && workflowAtRun.sha === workflowAtMain.sha;
    const currentMainTree = git(root, "rev-parse", `${mainSha}^{tree}`).trim();
    const baseIsAncestor = spawnSync("git", ["merge-base", "--is-ancestor", evidence.mainSha, mainSha], { cwd: root }).status === 0;
    const sameTestedCommitParents = testedCommit?.commit?.tree?.sha === evidence.treeSha
      && testedCommit.parents?.some((parent) => parent.sha === evidence.mainSha)
      && testedCommit.parents?.some((parent) => parent.sha === evidence.sourceHeadSha);
    const integrated = { baseMatches: evidence.baseSha === evidence.mainSha && baseIsAncestor && currentMainTree === evidence.treeSha && sameTestedCommitParents };
    const result = validateWorkflowEvidence({ run, workflow, jobs: jobsResponse.jobs ?? [], artifact, evidence, expected: { repository, runId, candidateSha, candidateTree, mainSha }, workflowMatchesMain, pullRequest, integrated: run.event === "pull_request" && integrated.baseMatches ? integrated : false });
    if (evidence.treeSha !== candidateTree) result.errors.push("El árbol local del candidato difiere del árbol probado.");
    const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", mainSha, candidateSha], { cwd: root });
    if (ancestor.status !== 0) result.errors.push("El candidato no contiene el main declarado.");
    const names = ["scripts/verification-catalog.json", "scripts/verification-policy.json", "scripts/verification-impact.mjs", "scripts/run-verification-suites.mjs", "scripts/verification-results.mjs", "package-lock.json"];
    for (const name of names) {
      const committed = spawnSync("git", ["show", `${candidateSha}:${name}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
      if (committed.status !== 0 || evidence.hashes?.[name] !== sha(committed.stdout)) result.errors.push(`Hash de evidencia no coincide con el candidato: ${name}`);
    }
    const trustedNames = ["scripts/verification-impact.mjs", "scripts/run-verification-suites.mjs", "scripts/verification-results.mjs"];
    for (const name of trustedNames) {
      const trusted = spawnSync("git", ["show", `${evidence.trustedToolsSha}:${name}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
      if (trusted.status !== 0 || evidence.trustedToolHashes?.[name] !== sha(trusted.stdout)) result.errors.push(`Hash de herramienta confiable no coincide: ${name}`);
    }
    const baselineCatalog = readGitJson(root, evidence.baseSha, "scripts/verification-catalog.json");
    const candidateCatalog = readGitJson(root, candidateSha, "scripts/verification-catalog.json");
    const allGroups = [...new Set([...Object.keys(baselineCatalog.domains ?? {}), ...Object.keys(candidateCatalog.domains ?? {})])].sort();
    const evidenceGroups = [...new Set(evidence.selection?.groups ?? [])].sort();
    const expectedGroups = evidence.selection?.mode === "full" ? allGroups : evidenceGroups;
    if (!evidenceGroups.length || evidenceGroups.some((name) => !allGroups.includes(name)) || JSON.stringify(evidenceGroups) !== JSON.stringify(expectedGroups)) result.errors.push("El alcance declarado contiene grupos inválidos o incompletos.");
    const expectedSuites = unionSuiteFiles(
      suiteFilesForScope(baselineCatalog, evidenceGroups, evidence.selection?.mode === "full", evidence.selection?.sharedUi === true),
      suiteFilesForScope(candidateCatalog, evidenceGroups, evidence.selection?.mode === "full", evidence.selection?.sharedUi === true),
    );
    if (JSON.stringify(evidence.selection?.suiteFiles) !== JSON.stringify(expectedSuites)) result.errors.push("El inventario de suites no cubre el catálogo de main y candidato.");
    return { ...result, runUrl: run.html_url, evidence, workflowId: workflow.id, workflowSha: evidence.workflowSha, artifactExpiresAt: artifact.expires_at };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
