#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationSql = /^drizzle\/\d+_.+\.sql$/;
const schemaPaths = ["drizzle/", "drizzle-deferred/", "src/db/schema.ts"];
const now = () => new Date().toISOString();

export function evaluatePreflight(input) {
  const errors = [];
  const checked = [];
  if (!/^[0-9a-f]{40}$/i.test(input.candidateSha ?? "")) errors.push("SHA candidato inválido.");
  if (!/^[0-9a-f]{40}$/i.test(input.deployedSha ?? "")) errors.push("SHA desplegado inválido.");
  if (!/^[0-9a-f]{40}$/i.test(input.mainSha ?? "")) errors.push("Falta SHA explícito del main vigente.");
  if (!input.destination) errors.push("Falta destino explícito.");
  if (!["code", "schema", "transition"].includes(input.mode)) errors.push("Modo inválido; usar code, schema o transition.");
  const evidence = input.evidence ?? {};
  const deployment = evidence.deployment ?? {};
  const suite = evidence.fullSuite ?? {};
  if (!deployment.id || !deployment.url || deployment.state !== "READY") errors.push("La evidencia no identifica un despliegue listo.");
  if (deployment.target !== input.destination) errors.push("El destino de la evidencia no coincide con el destino solicitado.");
  if (deployment.commitSha !== input.deployedSha) errors.push("El SHA del despliegue no coincide con el SHA desplegado indicado.");
  const freshness = Date.parse(deployment.verifiedAt ?? "");
  if (!Number.isFinite(freshness) || Date.now() - freshness > 24 * 60 * 60 * 1000 || freshness > Date.now() + 5 * 60 * 1000) errors.push("La evidencia del despliegue debe ser actual (máximo 24 horas).");
  if (suite.status !== "success" || suite.complete !== true || suite.commitSha !== input.candidateSha || suite.mainSha !== input.mainSha || !suite.runUrl) errors.push("Falta evidencia de suite completa aprobada para el candidato y el main indicados.");
  if (input.ancestor === false) errors.push("El candidato no desciende del SHA actualmente desplegado; requiere conciliación.");
  if (input.containsMain === false) errors.push("El candidato no contiene el main vigente.");
  if (input.historyComplete !== true) errors.push("No se pudo leer el historial completo entre despliegue y candidato.");
  for (const item of input.changes ?? []) {
    if (migrationSql.test(item.path) && item.status !== "A") errors.push(`No se permite modificar, borrar o renombrar una migración existente: ${item.path}`);
    if (input.mode === "code" && schemaPaths.some((prefix) => item.path.startsWith(prefix))) errors.push(`El modo code no admite cambios de esquema o migración: ${item.path}`);
  }
  if (["schema", "transition"].includes(input.mode)) {
    if (!input.databaseUrlPresent) errors.push("El modo de datos requiere DATABASE_URL_UNPOOLED explícita.");
    for (const tool of ["psql", "pg_dump", "pg_restore"]) if (!input.tools?.[tool]) errors.push(`Falta herramienta requerida: ${tool}.`);
    if (!input.serverMajor || input.dumpMajor < input.serverMajor) errors.push("pg_dump debe ser de la misma versión mayor o una posterior al servidor.");
    const data = evidence.data ?? {};
    const rehearsal = data.rehearsal ?? {};
    if (data.backupRestoreVerified !== true) errors.push("Falta evidencia de respaldo y restauración verificados.");
    for (const key of ["isolated", "syntheticFixtures", "existingRows", "relations", "constraints", "edgeCases", "historicalCases", "invariantsPassed"]) {
      if (rehearsal[key] !== true) errors.push(`El ensayo de datos no acredita ${key}.`);
    }
    if (input.mode === "schema" && data.compatibility?.previousCodeWorks !== true) errors.push("El modo schema requiere acreditar que el código anterior funciona con el esquema expandido.");
    if (input.mode === "transition") {
      if (!Array.isArray(data.transition?.steps) || data.transition.steps.length < 2) errors.push("La transición debe enumerar el orden de sus pasos.");
      if (!data.transition?.irreversibleStep) errors.push("La transición debe señalar su paso irreversible y el punto de parada.");
      if (!/^[0-9a-f]{40}$/i.test(data.transition?.recoveryCompatibleSha ?? "")) errors.push("La transición debe identificar el SHA de recuperación compatible.");
    }
  }
  if (!errors.length) checked.push("destino, evidencia de despliegue, candidato, historial, suite y modo verificados");
  return { ok: errors.length === 0, mode: input.mode, candidateSha: input.candidateSha, deployedSha: input.deployedSha, destination: input.destination, checked, errors };
}

function argsMap(args) {
  const values = new Map();
  for (let i = 0; i < args.length; i++) if (args[i].startsWith("--")) values.set(args[i].slice(2), args[i + 1]);
  return values;
}
function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
}
function version(command) {
  const result = run(command, ["--version"]);
  return result.status === 0 ? result.stdout.trim() : null;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Uso: preflight-publicacion.sh --mode code|schema|transition --candidate SHA --deployed SHA --main SHA --destination DESTINO --evidence-file JSON");
    process.exit(0);
  }
  const values = argsMap(process.argv.slice(2));
  const mode = values.get("mode");
  const candidate = values.get("candidate");
  const deployed = values.get("deployed");
  const destination = values.get("destination");
  const evidenceFile = values.get("evidence-file");
  let evidence;
  try { evidence = JSON.parse(await readFile(path.resolve(root, evidenceFile), "utf8")); }
  catch { evidence = {}; }
  let candidateSha = "", deployedSha = "", mainSha = "", ancestor = false, containsMain = false, changes = [], diffKnown = false;
  if (candidate) {
    const result = run("git", ["rev-parse", "--verify", `${candidate}^{commit}`]);
    if (result.status === 0) candidateSha = result.stdout.trim();
  }
  if (deployed) {
    const result = run("git", ["rev-parse", "--verify", `${deployed}^{commit}`]);
    if (result.status === 0) deployedSha = result.stdout.trim();
  }
  if (values.get("main")) {
    const result = run("git", ["rev-parse", "--verify", `${values.get("main")}^{commit}`]);
    if (result.status === 0) mainSha = result.stdout.trim();
  }
  if (candidateSha && deployedSha) {
    ancestor = run("git", ["merge-base", "--is-ancestor", deployedSha, candidateSha]).status === 0;
    const trackingMain = run("git", ["rev-parse", "--verify", "origin/main^{commit}"]);
    containsMain = Boolean(mainSha) && trackingMain.status === 0 && trackingMain.stdout.trim() === mainSha && run("git", ["merge-base", "--is-ancestor", mainSha, candidateSha]).status === 0;
    const diff = run("git", ["diff", "--name-status", "-z", deployedSha, candidateSha, "--"]);
    if (diff.status === 0) {
      diffKnown = true;
      const fields = diff.stdout.split("\0").filter(Boolean);
      for (let i = 0; i < fields.length;) {
        const status = fields[i++];
        if (status.startsWith("R") || status.startsWith("C")) {
          const oldPath = fields[i++], newPath = fields[i++];
          changes.push({ status, path: oldPath }, { status, path: newPath });
        } else changes.push({ status, path: fields[i++] });
      }
    }
  }
  const tools = Object.fromEntries(["psql", "pg_dump", "pg_restore"].map((name) => [name, Boolean(version(name))]));
  let serverMajor = 0, dumpMajor = 0;
  if (["schema", "transition"].includes(mode) && process.env.DATABASE_URL_UNPOOLED && tools.psql) {
    const result = run("psql", [process.env.DATABASE_URL_UNPOOLED, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", "SHOW server_version"], { env: process.env });
    if (result.status === 0) serverMajor = Number.parseInt(result.stdout.trim(), 10) || 0;
    const parsed = version("pg_dump")?.match(/([0-9]+)(?:\.[0-9]+)?$/);
    if (parsed) dumpMajor = Number(parsed[1]);
  }
  const report = evaluatePreflight({ mode, candidateSha, deployedSha, mainSha, destination, evidence, ancestor, containsMain, historyComplete: diffKnown, changes, databaseUrlPresent: Boolean(process.env.DATABASE_URL_UNPOOLED), tools, serverMajor, dumpMajor });
  report.evaluatedAt = now();
  for (const error of report.errors) console.error(`ERROR: ${error}`);
  if (report.ok) console.log("Preflight aprobado: solo lectura; no publicó, migró ni activó funcionalidades.");
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
