#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = path.resolve(process.env.FAMILY_UTILS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const catalog = JSON.parse(await readFile(path.join(root, "scripts/verification-catalog.json"), "utf8"));
const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
const slash = (value) => value.replaceAll(path.sep, "/");
const allGroups = Object.keys(catalog.domains);
const documentationAllowlist = new Set(catalog.documentationAllowlist);
const verificationToolPrefixes = [
  "scripts/verification-impact.", "scripts/run-verification-suites.",
  "scripts/preflight-publicacion.", "scripts/verification-results.",
  "scripts/verify-ci-evidence.",
  "scripts/reuse-main-verification.",
  "scripts/check-documentation.",
  "scripts/verification-policy.json",
];
const fullPrefixes = [
  ".github/", "src/app/api/auth/", "src/app/api/families/", "middleware.", "proxy.", "next.config.", "playwright.",
  "drizzle/", "drizzle-deferred/", "src/db/", "package.json", "package-lock.json",
  "vercel.json", "drizzle.config.", "tsconfig.", "eslint.config.", ".nvmrc", ".npmrc",
  "docker-compose.yml", ".env.example", "AGENTS.md", "agent-skills.md", "sources/verification.md",
  "sources/deployment.md", "sources/verification-impact-window.md",
  ...verificationToolPrefixes,
];

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

export function validateInvariantCoverage(invariants = catalog.invariants, domains = catalog.domains) {
  const errors = [];
  const knownTests = new Set([
    ...Object.values(domains).flatMap((domain) => [...domain.nodeTests, ...domain.routeTests, ...domain.browser.flatMap((suite) => suite.files)]),
    ...catalog.sharedNodeTests, ...catalog.sharedRouteTests, ...catalog.sharedBrowser.flatMap((suite) => suite.files),
  ]);
  for (const [name, files] of Object.entries(invariants ?? {})) {
    if (!Array.isArray(files) || files.length === 0) errors.push(`Invariante sin pruebas: ${name}`);
    for (const file of files ?? []) if (!knownTests.has(file)) errors.push(`Prueba inválida para invariante ${name}: ${file}`);
  }
  for (const required of ["authorization", "familyIsolation", "persistence", "concurrency", "retries", "familyDates", "recovery"])
    if (!Object.hasOwn(invariants ?? {}, required)) errors.push(`Falta invariante requerida: ${required}`);
  return errors.sort();
}

export function catalogChangeScope(previous, current = catalog) {
  const stable = (value) => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  };
  const globalKeys = ["version", "documentationAllowlist", "sharedPrefixes", "sharedUiPrefixes", "sharedNodeTests", "sharedRouteTests", "sharedBrowser", "invariants"];
  const reasons = [];
  for (const key of globalKeys) if (stable(previous?.[key]) !== stable(current?.[key])) reasons.push(`Regla global del catálogo modificada: ${key}`);
  const knownGroups = [...new Set([...Object.keys(previous?.domains ?? {}), ...Object.keys(current.domains ?? {})])].sort();
  if (reasons.length) return { mode: "full", groups: knownGroups, sharedUi: true, browser: true, reasons };
  const groups = Object.keys(current.domains).filter((name) => stable(previous?.domains?.[name]) !== stable(current.domains[name]));
  const removed = Object.keys(previous?.domains ?? {}).filter((name) => !current.domains[name]);
  if (removed.length) return { mode: "full", groups: knownGroups, sharedUi: true, browser: true, reasons: [`Dominios retirados del catálogo: ${removed.join(", ")}`] };
  if (!groups.length) return { mode: "full", groups: knownGroups, sharedUi: true, browser: true, reasons: ["El catálogo cambió sin una entrada de alcance asignable; se ejecuta todo."] };
  const selected = [...new Set([...expandConsumers(groups, previous.domains), ...expandConsumers(groups, current.domains)])].sort();
  return { mode: "impact", groups: selected, sharedUi: false, browser: selected.some((name) => current.domains[name].browser.length > 0), reasons: [`Entradas de catálogo modificadas: ${groups.join(", ")}.`] };
}

export function mergeCatalogChangeScope(selection, catalogScope, domains = catalog.domains) {
  if (!catalogScope) return selection;
  if (catalogScope.mode === "full") return catalogScope;
  if (selection.mode === "full") return selection;
  const groups = expandConsumers([...new Set([...selection.groups, ...catalogScope.groups])], domains);
  return {
    mode: groups.length || selection.mode === "impact" ? "impact" : selection.mode,
    groups,
    sharedUi: selection.sharedUi || catalogScope.sharedUi,
    screenA11y: selection.screenA11y || catalogScope.screenA11y,
    browser: selection.browser || catalogScope.browser,
    reasons: [...selection.reasons, ...catalogScope.reasons],
  };
}

export function suiteFilesForSelection(selection, candidateCatalogs = [catalog]) {
  const selectedGroups = new Set(selection.groups);
  const suiteFiles = { node: new Set(), route: new Set(), browser: new Map() };
  for (const candidateCatalog of candidateCatalogs) {
    for (const [name, domain] of Object.entries(candidateCatalog.domains ?? {})) if (selection.mode === "full" || selectedGroups.has(name)) {
      for (const file of domain.nodeTests ?? []) suiteFiles.node.add(file);
      for (const file of domain.routeTests ?? []) suiteFiles.route.add(file);
      for (const suite of domain.browser ?? []) {
        const files = suiteFiles.browser.get(suite.kind) ?? new Set();
        for (const file of suite.files) files.add(file);
        suiteFiles.browser.set(suite.kind, files);
      }
    }
    if (selection.mode === "full") {
      for (const file of candidateCatalog.sharedNodeTests ?? []) suiteFiles.node.add(file);
      for (const file of candidateCatalog.sharedRouteTests ?? []) suiteFiles.route.add(file);
    }
    if (selection.mode === "full" || selection.sharedUi || selection.screenA11y) for (const suite of candidateCatalog.sharedBrowser ?? []) {
      if (selection.mode !== "full" && !selection.sharedUi && selection.screenA11y && suite.kind !== "a11y") continue;
      const files = suiteFiles.browser.get(suite.kind) ?? new Set();
      for (const file of suite.files) files.add(file);
      suiteFiles.browser.set(suite.kind, files);
    }
  }
  return { node: [...suiteFiles.node].sort(), route: [...suiteFiles.route].sort(), browser: [...suiteFiles.browser].map(([kind, files]) => ({ kind, files: [...files].sort() })).sort((a, b) => a.kind.localeCompare(b.kind)) };
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
  errors.push(...validateInvariantCoverage());
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

function expandConsumers(groups, domains = catalog.domains) {
  const expanded = new Set(groups);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, domain] of Object.entries(domains)) {
      if (domain.dependsOn.some((dep) => expanded.has(dep)) && !expanded.has(name)) {
        expanded.add(name); changed = true;
      }
    }
  }
  return [...expanded].sort();
}

function isDocsOnly(files) {
  return files.length > 0 && files.every((file) => documentationAllowlist.has(file));
}

function select(files, { full = false, alert = null, knownGroups = allGroups } = {}) {
  const reasons = [];
  if (full) reasons.push("Se solicitó la suite completa o el evento requiere cobertura completa.");
  if (!files.length && !alert && !full) alert = "No se detectaron cambios; se ejecuta todo para evitar una aprobación vacía.";
  if (full || alert) {
    if (alert) reasons.push(alert);
    return { mode: "full", groups: [...knownGroups].sort(), sharedUi: true, screenA11y: false, browser: true, reasons };
  }
  if (isDocsOnly(files)) return { mode: "documentation", groups: [], sharedUi: false, screenA11y: false, browser: false, reasons: ["Todos los cambios están en rutas Markdown permitidas."] };
  const groups = new Set();
  let needsFull = false;
  for (const file of files) {
    if (file === "scripts/verification-catalog.json") continue;
    if (documentationAllowlist.has(file)) continue;
    if (fullPrefixes.some((prefix) => file === prefix || file.startsWith(prefix))
      || catalog.sharedPrefixes.some((prefix) => file === prefix || file.startsWith(prefix))) {
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
  if (needsFull) return { mode: "full", groups: [...allGroups].sort(), sharedUi: true, screenA11y: false, browser: true, reasons };
  const sharedUi = files.some((file) => catalog.sharedUiPrefixes.some((prefix) => file.startsWith(prefix)) && !file.startsWith("src/app/api/") && /\.(?:tsx?|css)$/.test(file));
  const screenA11y = files.some((file) => file.startsWith("src/app/") && !file.startsWith("src/app/api/") && /\.(?:tsx|css)$/.test(file));
  const browser = selected.some((name) => catalog.domains[name].browser.length > 0) || sharedUi || screenA11y;
  if (sharedUi) reasons.push("Cambio en componente compartido: se agregan accesibilidad e interfaz unificada.");
  else if (screenA11y) reasons.push("Cambio visual de pantalla: se agrega accesibilidad junto con la suite del dominio.");
  if (!reasons.length) reasons.push(`Pruebas seleccionadas por impacto: ${selected.join(", ") || "ninguna"}.`);
  return { mode: "impact", groups: selected, sharedUi, screenA11y, browser, reasons };
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
  const policyRef = getArg("--policy-ref") ?? "origin/main";
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
  let catalogScope = null;
  if (files.includes("scripts/verification-catalog.json") && comparisonBase) {
    const oldCatalog = git("show", `${comparisonBase}:scripts/verification-catalog.json`);
    if (oldCatalog.status !== 0) alert = "No se pudo leer el catálogo base para comparar el alcance; se ejecuta todo.";
    else {
      try { catalogScope = catalogChangeScope(JSON.parse(oldCatalog.stdout), catalog); }
      catch { alert = "No se pudo comparar el catálogo base con el candidato; se ejecuta todo."; }
    }
  }
  let trustedCatalog = catalog;
  const trustedCatalogResult = git("show", `${policyRef}:scripts/verification-catalog.json`);
  if (trustedCatalogResult.status === 0) {
    try { trustedCatalog = JSON.parse(trustedCatalogResult.stdout); }
    catch { alert = `Catálogo confiable inválido en ${policyRef}; se ejecuta todo.`; }
  } else if (git("rev-parse", "--verify", policyRef).status === 0) alert = `No se pudo leer el catálogo confiable ${policyRef}; se ejecuta todo.`;
  const knownGroups = [...new Set([...Object.keys(trustedCatalog.domains ?? {}), ...allGroups])].sort();
  const validation = await validateCatalog();
  if (validation.errors.length) alert = `El catálogo requiere corrección: ${validation.errors.join("; ")}`;
  if (validation.dynamicImports.length && !asBool) alert = `Imports dinámicos no literales en ${validation.dynamicImports.join(", ")}; se ejecuta todo.`;
  if (validation.unresolvedImports.length && !asBool) alert = `Imports internos irresolubles en ${validation.unresolvedImports.join(", ")}; se ejecuta todo.`;
  if (git("cat-file", "-e", `${policyRef}:scripts/verification-policy.json`).status === 0) {
    const policyResult = git("show", `${policyRef}:scripts/verification-policy.json`);
    try {
      const policy = JSON.parse(policyResult.stdout);
      if (policy.version !== 1 || typeof policy.forceFull !== "boolean") alert = `Política de verificación inválida en ${policyRef}; se ejecuta todo.`;
      else if (policy.forceFull === true) {
        if (typeof policy.reason !== "string" || !policy.reason.trim() || typeof policy.incident !== "string" || !policy.incident.trim()) alert = `Política forceFull incompleta en ${policyRef}; se ejecuta todo.`;
        else alert = `Selección completa forzada por la política confiable ${policyRef}: ${policy.reason} (${policy.incident})`;
      }
    } catch { alert = `Política de verificación ilegible en ${policyRef}; se ejecuta todo.`; }
  } else if (git("rev-parse", "--verify", policyRef).status !== 0) alert = `No se pudo leer la política confiable ${policyRef}; se ejecuta todo.`;
  let selection = select([...new Set(files)].sort(), { full: asBool, alert, knownGroups });
  if (catalogScope && !alert) selection = mergeCatalogChangeScope(selection, catalogScope);
  const selectedCatalogs = [trustedCatalog, catalog];
  selection.suiteFiles = suiteFilesForSelection(selection, selectedCatalogs);
  const result = { version: catalog.version, trustedCatalogVersion: trustedCatalog.version, base: comparisonBase ?? (asBool ? "not-calculated-full-run" : "merge-base(origin/main, HEAD)"), requestedBase: base ?? null, head: head ?? "working-tree", files: [...new Set(files)].sort(), ...selection, catalogErrors: validation.errors, importEdges: validation.edges, unresolvedImports: validation.unresolvedImports };
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
    await appendFile(githubOutput, `mode=${result.mode}\ngroups=${result.groups.join(",")}\nshared_ui=${result.sharedUi}\nbrowser=${result.browser}\ndocumentation=${result.files.some((file) => /\.md$/i.test(file))}\nbase=${result.base}\n`);
  }
  if (validation.errors.length) process.exitCode = 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();
export { catalog, select, ownerFor, expandConsumers };
