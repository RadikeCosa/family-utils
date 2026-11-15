#!/usr/bin/env node
import { readFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await readFile(path.join(root, "scripts/verification-catalog.json"), "utf8"));
const started = Date.now();
const report = { schemaVersion: 1, startedAt: new Date(started).toISOString(), selection: null, suites: [], ok: true };

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) if (args[i].startsWith("--")) out[args[i].slice(2)] = args[i + 1];
  return out;
}
function run(command, args, env = process.env) {
  const begin = Date.now();
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return { ...result, durationMs: Date.now() - begin };
}
function addSuite(name, result, counts = {}) {
  const status = result.status === 0 && (counts.failed ?? 0) === 0 && (counts.skipped ?? 0) === 0 ? "passed" : "failed";
  report.suites.push({ name, status, durationMs: result.durationMs, ...counts });
  if (status !== "passed" || (counts.skipped ?? 0) > 0) report.ok = false;
  console.log(`${status === "passed" ? "PASS" : "FAIL"} ${name} (${result.durationMs} ms)`);
  for (const failure of counts.failures?.slice(0, 15) ?? []) {
    console.error(`  ${failure.project}: ${failure.title} — ${failure.message}`);
  }
  if ((counts.failures?.length ?? 0) > 15) console.error(`  … y ${counts.failures.length - 15} fallos más (ver JSON).`);
  if (result.status !== 0 && result.stderr) process.stderr.write(result.stderr);
}
function parseTap(output) {
  const tests = output.match(/^# tests (\d+)$/m);
  const pass = output.match(/^# pass (\d+)$/m);
  const fail = output.match(/^# fail (\d+)$/m);
  const skipped = output.match(/^# skipped (\d+)$/m);
  if (!tests || Number(tests[1]) === 0) return null;
  return { executed: Number(tests[1]), passed: Number(pass?.[1] ?? 0), failed: Number(fail?.[1] ?? 0), skipped: Number(skipped?.[1] ?? 0) };
}
export function parsePlaywright(output) {
  let data;
  try { data = JSON.parse(output); } catch { return null; }
  let passed = 0, failed = 0, skipped = 0;
  const failures = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      const status = test.status ?? test.results?.at(-1)?.status ?? "unknown";
      if (status === "skipped") skipped++;
      else if (status === "expected" || status === "passed") passed++;
      else {
        failed++;
        const result = test.results?.at(-1);
        failures.push({
          title: spec.title,
          project: test.projectName ?? test.projectId ?? "desconocido",
          message: (result?.errors?.[0]?.message ?? result?.error?.message ?? `Estado: ${status}`).split(/\r?\n/, 1)[0].slice(0, 300),
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of data.suites ?? []) visit(suite);
  if (passed + failed + skipped === 0) return null;
  return { executed: passed + failed + skipped, passed, failed, skipped, failures };
}
function executeTap(name, files) {
  if (!files.length) return;
  const result = run(process.execPath, ["--experimental-strip-types", "--test", "--test-concurrency=1", "--test-reporter=tap", ...files]);
  const counts = parseTap(result.stdout ?? "");
  if (!counts) { result.status = result.status || 1; result.stderr += "\nSin resumen TAP válido o suite vacía.\n"; }
  addSuite(name, result, counts ?? { executed: 0, passed: 0, failed: 1, skipped: 0 });
}
function executePlaywright(name, command, args, env = process.env) {
  const result = run(command, args, env);
  const counts = parsePlaywright(result.stdout ?? "");
  if (!counts) { result.status = result.status || 1; result.stderr += "\nReporte Playwright vacío o inválido.\n"; }
  addSuite(name, result, counts ?? { executed: 0, passed: 0, failed: 1, skipped: 0 });
}

async function makeUnifiedDatabase() {
  if (process.env.FAMILY_UTILS_UNIFIED_DATABASE_URL) return { url: process.env.FAMILY_UTILS_UNIFIED_DATABASE_URL, owned: false };
  const raw = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
  if (!raw) throw new Error("FAMILY_UTILS_TEST_DATABASE_URL es obligatorio para la interfaz unificada.");
  const base = new URL(raw);
  if (!["localhost", "127.0.0.1"].includes(base.hostname) || !base.pathname.slice(1).endsWith("_test")) throw new Error("La base auxiliar solo puede crearse desde una base PostgreSQL local terminada en _test.");
  const pool = new pg.Pool({ connectionString: base.toString(), connectionTimeoutMillis: 5000 });
  const name = `family_unified_${randomUUID().replaceAll("-", "")}_test`;
  try { await pool.query(`CREATE DATABASE "${name}"`); }
  finally { await pool.end(); }
  base.pathname = `/${name}`;
  return { url: base.toString(), owned: true, name };
}

async function dropUnifiedDatabase(database, baseUrl) {
  if (!database?.owned) return;
  const base = new URL(baseUrl);
  const pool = new pg.Pool({ connectionString: base.toString(), connectionTimeoutMillis: 5000 });
  try { await pool.query(`DROP DATABASE "${database.name}"`); }
  finally { await pool.end(); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.selection) throw new Error("Uso: run-verification-suites.mjs --selection <archivo.json>");
  report.selection = JSON.parse(await readFile(args.selection, "utf8"));
  const selection = report.selection;
  const selected = new Set(selection.groups);
  const domains = Object.entries(catalog.domains).filter(([name]) => selected.has(name));
  const nodeFiles = new Set(domains.flatMap(([, item]) => item.nodeTests));
  const routeFiles = new Set(domains.flatMap(([, item]) => item.routeTests));
  if (selection.mode === "full") {
    for (const file of catalog.sharedNodeTests) nodeFiles.add(file);
    for (const file of catalog.sharedRouteTests) routeFiles.add(file);
  }
  executeTap("Reglas e integración seleccionadas", [...nodeFiles].sort());
  executeTap("Handlers seleccionados", [...routeFiles].sort());

  const browserSuites = [...domains.flatMap(([, item]) => item.browser), ...(selection.sharedUi ? catalog.sharedBrowser : [])];
  const byKind = new Map();
  for (const suite of browserSuites) {
    const files = byKind.get(suite.kind) ?? new Set();
    for (const file of suite.files) files.add(file);
    byKind.set(suite.kind, files);
  }
  const defaultFiles = [...(byKind.get("default") ?? [])].sort();
  if (defaultFiles.length) executePlaywright("Navegador seleccionado", "npm", ["--silent", "run", "test:e2e", "--", "--reporter=json", ...defaultFiles]);
  const special = [
    ["recipes", "Recetas", "test:recipes:e2e"],
    ["sports-next", "Deportes", "test:sports-next"],
    ["champions", "Champions", "test:champions"],
    ["training-diary", "Diario de entrenamiento", "test:training:diary:e2e"],
    ["a11y", "Accesibilidad", "test:a11y"],
  ];
  for (const [kind, label, script] of special) if (byKind.has(kind)) executePlaywright(label, "npm", ["--silent", "run", script, "--", "--reporter=json"]);

  let unifiedDatabase;
  if (byKind.has("unified")) {
    const baseUrl = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
    try {
      unifiedDatabase = await makeUnifiedDatabase();
      const env = { ...process.env, DATABASE_URL: unifiedDatabase.url, DATABASE_URL_UNPOOLED: unifiedDatabase.url, FAMILY_UTILS_TEST_DATABASE_URL: unifiedDatabase.url };
      const migrate = run("npm", ["--silent", "run", "db:migrate"], env);
      addSuite("Migración de base auxiliar unificada", migrate);
      if (migrate.status === 0) executePlaywright("Interfaz unificada", "npm", ["--silent", "run", "test:unified", "--", "--reporter=json"], env);
    } catch (error) {
      addSuite("Preparar interfaz unificada", { status: 1, durationMs: 0, stderr: `${error.message}\n` });
    } finally {
      try { await dropUnifiedDatabase(unifiedDatabase, baseUrl); }
      catch (error) { addSuite("Retirar base auxiliar propia", { status: 1, durationMs: 0, stderr: `${error.message}\n` }); }
    }
  }
  report.completedAt = new Date().toISOString();
  report.durationMs = Date.now() - started;
  const out = args.output ?? "verification-results/suite-summary.json";
  await mkdir(path.dirname(path.resolve(root, out)), { recursive: true });
  await (await import("node:fs/promises")).writeFile(path.resolve(root, out), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  await (await import("node:fs/promises")).appendFile(process.env.GITHUB_STEP_SUMMARY ?? path.join(root, "verification-results/summary.md"), `\n## Suites de verificación\n\n- Modo: ${selection.mode}\n- Grupos: ${selection.groups.join(", ") || "documentación"}\n- Resultado: ${report.ok ? "aprobado" : "fallido"}\n- Duración de suites: ${report.durationMs} ms\n\n| Suite | Estado | Duración | Pruebas | Omitidas |\n|---|---|---:|---:|---:|\n${report.suites.map((suite) => `| ${suite.name} | ${suite.status} | ${suite.durationMs} ms | ${suite.executed ?? "—"} | ${suite.skipped ?? 0} |`).join("\n")}\n`);
  console.log(`Reporte JSON: ${out}`);
  if (!report.ok) process.exitCode = 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try { await main(); }
  catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 1; }
}
