#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await readFile(path.join(root, "scripts/verification-catalog.json"), "utf8"));
const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
const slash = (value) => value.replaceAll(path.sep, "/");
const allGroups = Object.keys(catalog.domains);

function ownerFor(file) {
  const normalized = slash(file);
  for (const [name, domain] of Object.entries(catalog.domains)) {
    if (domain.paths.some((prefix) => normalized.startsWith(prefix))) return name;
  }
  return null;
}

export function undeclaredDependencies(edges, domains = catalog.domains) {
  const declared = new Set(Object.entries(domains).flatMap(([name, domain]) => domain.dependsOn.map((target) => `${name}->${target}`)));
  const actual = new Set(edges);
  return [
    ...[...actual].filter((edge) => !declared.has(edge)).map((edge) => `Dependencia entre dominios sin declarar: ${edge}`),
    ...[...declared].filter((edge) => !actual.has(edge)).map((edge) => `Dependencia declarada sin import detectado: ${edge}`),
  ].sort();
}

export function unclassifiedTestFiles(found, known) {
  const knownSet = known instanceof Set ? known : new Set(known);
  return found.filter((file) => !knownSet.has(file)).map((file) => `Prueba sin grupo en el catálogo: ${file}`).sort();
}

async function walk(directory) {
  const result = [];
  let entries;
  try { entries = await readdir(path.join(root, directory), { withFileTypes: true }); }
  catch { return result; }
  for (const entry of entries) {
    const rel = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(rel));
    else if (entry.isFile()) result.push(rel);
  }
  return result;
}

export async function validateCatalog() {
  const errors = [];
  for (const [name, domain] of Object.entries(catalog.domains)) {
    for (const dependency of domain.dependsOn) if (!catalog.domains[dependency]) errors.push(`Dominio inexistente declarado por ${name}: ${dependency}`);
  }
  const groupsByTest = new Map();
  for (const [name, domain] of Object.entries(catalog.domains)) {
    for (const file of [...domain.nodeTests, ...domain.routeTests, ...domain.browser.flatMap((suite) => suite.files)]) {
      const groups = groupsByTest.get(file) ?? [];
      groups.push(name);
      groupsByTest.set(file, groups);
      try { await readFile(path.join(root, file)); }
      catch { errors.push(`El catálogo referencia una prueba inexistente: ${file}`); }
    }
  }
  for (const file of [...catalog.sharedNodeTests, ...catalog.sharedRouteTests, ...catalog.sharedBrowser.flatMap((suite) => suite.files)]) {
    const groups = groupsByTest.get(file) ?? [];
    groups.push("shared");
    groupsByTest.set(file, groups);
    try { await readFile(path.join(root, file)); }
    catch { errors.push(`El catálogo referencia una prueba inexistente: ${file}`); }
  }
  for (const [file, owners] of groupsByTest) {
    if (owners.length > 1) errors.push(`La prueba aparece en más de un grupo: ${file}`);
  }
  const found = (await Promise.all([walk("src/lib"), walk("tests")])).flat()
    .filter((file) => /(?:\.test\.(?:ts|mjs|js)|\.integration\.mjs|\.spec\.ts)$/.test(file))
    .sort();
  errors.push(...unclassifiedTestFiles(found, groupsByTest.keys()));
  for (const file of groupsByTest.keys()) if (!found.includes(file)) errors.push(`Prueba catalogada fuera del inventario: ${file}`);
  const edges = new Set();
  const dynamicImports = [];
  const unresolvedImports = [];
  const configPath = path.join(root, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) errors.push("No se pudo leer tsconfig.json para revisar dependencias.");
  else {
    const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
    const host = ts.createCompilerHost(config.options, true);
    const aliases = Object.keys(config.options.paths ?? {}).map((pattern) => pattern.split("*", 1)[0]).filter(Boolean);
    const files = await walk("src");
    for (const rel of files.filter((file) => /\.[cm]?[jt]sx?$/.test(file))) {
      const from = ownerFor(rel);
      if (!from) continue;
      const source = ts.createSourceFile(rel, await readFile(path.join(root, rel), "utf8"), ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node) => {
        let specifier;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          if (node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) specifier = node.arguments[0].text;
          else dynamicImports.push(rel);
        }
        if (specifier) {
          const resolvedByTs = ts.resolveModuleName(specifier, path.join(root, rel), config.options, host).resolvedModule?.resolvedFileName;
          const localTarget = (specifier.startsWith(".") || aliases.some((prefix) => specifier.startsWith(prefix)))
            ? path.resolve(path.dirname(path.join(root, rel)), specifier)
            : null;
          const resolved = resolvedByTs ?? (localTarget && ts.sys.fileExists(localTarget) ? localTarget : null);
          if (resolved && resolved.startsWith(root)) {
            const to = ownerFor(path.relative(root, resolved));
            if (to && to !== from) edges.add(`${from}->${to}`);
          } else if (!resolved && (specifier.startsWith(".") || aliases.some((prefix) => specifier.startsWith(prefix)))) {
            unresolvedImports.push(`${rel} -> ${specifier}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  errors.push(...undeclaredDependencies(edges, catalog.domains));
  return { errors: [...new Set(errors)].sort(), edges: [...edges].sort(), dynamicImports: [...new Set(dynamicImports)].sort(), unresolvedImports: [...new Set(unresolvedImports)].sort(), tests: found };
}

function gitOutput(...args) {
  const result = git(...args);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} falló`);
  return result.stdout.trim();
}
function gitOutputRaw(...args) {
  const result = git(...args);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} falló`);
  return result.stdout;
}

export function parseChangedPaths(output) {
  const fields = output.split("\0").filter(Boolean);
  const files = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    if (status.startsWith("R") || status.startsWith("C")) files.push(fields[i++], fields[i++]);
    else files.push(fields[i++]);
  }
  return files;
}

function expandConsumers(groups) {
  const expanded = new Set(groups);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, domain] of Object.entries(catalog.domains)) {
      if (domain.dependsOn.some((dep) => expanded.has(dep)) && !expanded.has(name)) {
        expanded.add(name); changed = true;
      }
    }
  }
  return [...expanded].sort();
}

function isDocsOnly(files) {
  return files.length > 0 && files.every((file) => file.endsWith(".md") && catalog.documentationAllowlist.some((entry) => entry.endsWith("/") ? file.startsWith(entry) : file === entry));
}

function select(files, { full = false, alert = null } = {}) {
  const reasons = [];
  if (full) reasons.push("Se solicitó la suite completa o el evento requiere cobertura completa.");
  if (!files.length && !alert && !full) alert = "No se detectaron cambios; se ejecuta todo para evitar una aprobación vacía.";
  if (full || alert) {
    if (alert) reasons.push(alert);
    return { mode: "full", groups: [...allGroups].sort(), sharedUi: true, browser: true, reasons };
  }
  if (isDocsOnly(files)) return { mode: "documentation", groups: [], sharedUi: false, browser: false, reasons: ["Todos los cambios están en rutas Markdown permitidas."] };
  const groups = new Set();
  let needsFull = false;
  for (const file of files) {
    if (catalog.sharedPrefixes.some((prefix) => file === prefix || file.startsWith(prefix))) {
      needsFull = true; reasons.push(`Ruta compartida o de configuración: ${file}`); continue;
    }
    let found = false;
    for (const [name, domain] of Object.entries(catalog.domains)) {
      if (domain.paths.some((prefix) => file.startsWith(prefix))) { groups.add(name); found = true; }
      if ([...domain.nodeTests, ...domain.routeTests, ...domain.browser.flatMap((suite) => suite.files)].includes(file)) { groups.add(name); found = true; }
    }
    if ([...catalog.sharedNodeTests, ...catalog.sharedRouteTests, ...catalog.sharedBrowser.flatMap((suite) => suite.files)].includes(file)) {
      needsFull = true; found = true; reasons.push(`Prueba o utilidad compartida: ${file}`);
    }
    if (!found) { needsFull = true; reasons.push(`Ruta sin clasificar: ${file}`); }
  }
  const selected = expandConsumers([...groups]);
  if (needsFull) return { mode: "full", groups: [...allGroups].sort(), sharedUi: true, browser: true, reasons };
  const sharedUi = files.some((file) => catalog.sharedUiPrefixes.some((prefix) => file.startsWith(prefix)) && /\.(?:tsx?|css)$/.test(file));
  const browser = selected.some((name) => catalog.domains[name].browser.length > 0) || (sharedUi && catalog.sharedBrowser.length > 0);
  if (sharedUi) reasons.push("Cambios de interfaz: se agregan accesibilidad e interfaz unificada.");
  if (!reasons.length) reasons.push(`Pruebas seleccionadas por impacto: ${selected.join(", ") || "ninguna"}.`);
  return { mode: "impact", groups: selected, sharedUi, browser, reasons };
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1] ?? null; };
  const asBool = args.includes("--full");
  if (args.includes("--check")) {
    const result = await validateCatalog();
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
    return;
  }
  let files = [];
  let alert = null;
  const base = getArg("--base");
  const head = getArg("--head");
  let comparisonBase = base;
  if (asBool) { /* explicit full */ }
  else if (args.includes("--local")) {
    try {
      const mainRef = getArg("--main-ref") ?? "origin/main";
      const mergeBase = gitOutput("merge-base", "HEAD", mainRef);
      comparisonBase = mergeBase;
      files = parseChangedPaths(gitOutputRaw("diff", "--name-status", "-z", mergeBase, "--"));
      files.push(...gitOutputRaw("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean));
    } catch (error) { alert = `No se pudo determinar el alcance local (${error.message}); se ejecuta todo.`; }
  } else if (base && head) {
    try {
      const mergeBase = gitOutput("merge-base", base, head);
      comparisonBase = mergeBase;
      files = parseChangedPaths(gitOutputRaw("diff", "--name-status", "-z", mergeBase, head, "--"));
    } catch (error) { alert = `No se pudo calcular el ancestro común (${error.message}); se ejecuta todo.`; }
  } else {
    alert = "Falta base Git explícita; se ejecuta todo.";
  }
  const validation = await validateCatalog();
  if (validation.errors.length) alert = `El catálogo requiere corrección: ${validation.errors.join("; ")}`;
  if (validation.dynamicImports.length && !asBool) alert = `Imports dinámicos no literales en ${validation.dynamicImports.join(", ")}; se ejecuta todo.`;
  if (validation.unresolvedImports.length && !asBool) alert = `Imports internos irresolubles en ${validation.unresolvedImports.join(", ")}; se ejecuta todo.`;
  const selection = select([...new Set(files)].sort(), { full: asBool, alert });
  const result = { version: catalog.version, base: comparisonBase ?? (asBool ? "not-calculated-full-run" : "merge-base(origin/main, HEAD)"), requestedBase: base ?? null, head: head ?? "working-tree", files: [...new Set(files)].sort(), ...selection, catalogErrors: validation.errors, importEdges: validation.edges, unresolvedImports: validation.unresolvedImports };
  console.log(JSON.stringify(result, null, 2));
  const output = getArg("--output");
  if (output) {
    const fs = await import("node:fs/promises");
    await fs.mkdir(path.dirname(path.resolve(root, output)), { recursive: true });
    await fs.writeFile(path.resolve(root, output), JSON.stringify(result, null, 2) + "\n");
  }
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(githubOutput, `mode=${result.mode}\ngroups=${result.groups.join(",")}\nshared_ui=${result.sharedUi}\nbrowser=${result.browser}\n`);
  }
  if (validation.errors.length) process.exitCode = 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();
export { catalog, select, ownerFor };
