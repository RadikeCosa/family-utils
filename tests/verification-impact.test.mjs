import test from "node:test";
import assert from "node:assert/strict";
import { catalog, catalogChangeScope, mergeCatalogChangeScope, parseChangedPaths, select, suiteFilesForSelection, undeclaredDependencies, unclassifiedTestFiles, validateCatalog, validateInvariantCoverage } from "../scripts/verification-impact.mjs";

test("catalogue classifies every test and declares every static cross-domain import", async () => {
  const result = await validateCatalog();
  assert.deepEqual(result.errors, []);
  assert.ok(result.tests.length > 50);
});

test("documentation-only allowlist applies only when every changed file is allowed Markdown", () => {
  assert.equal(select(["README.md"]).mode, "documentation");
  assert.equal(select(["README.md", "src/app/tareas/page.tsx"]).mode, "impact");
  assert.equal(select(["AGENTS.md"]).mode, "full");
  assert.equal(select(["sources/deployment.md"]).mode, "full");
  assert.equal(select(["scripts/check-documentation.mjs"]).mode, "full");
  assert.equal(select(["sources/deployment.md", ".github/workflows/ci.yml"]).mode, "full");
});

test("task changes select dependent consumers transitively", () => {
  const result = select(["src/lib/tasks/rules.ts"]);
  assert.equal(result.mode, "impact");
  assert.deepEqual(result.groups, ["acceso", "deportes", "plataforma", "tasks"].sort());
});

test("shared changes and unknown paths select every domain", () => {
  assert.equal(select(["src/db/schema.ts"]).mode, "full");
  assert.deepEqual(select(["new-unmapped-area/file.ts"]).groups, ["acceso", "cinemateca", "cocina", "comidas", "deportes", "entrenamiento", "plataforma", "tasks"]);
});

test("screen changes add accessibility; shared components also add unified UI suites", () => {
  const result = select(["src/app/tareas/page.tsx"]);
  assert.equal(result.sharedUi, false);
  assert.equal(result.screenA11y, true);
  assert.equal(result.browser, true);
  assert.ok(result.groups.includes("tasks"));
  const screenSuites = suiteFilesForSelection(result);
  assert.ok(screenSuites.browser.some((suite) => suite.kind === "a11y"));
  assert.ok(screenSuites.browser.some((suite) => suite.kind === "default"));
  assert.equal(screenSuites.browser.some((suite) => suite.kind === "unified"), false);
  const shared = select(["src/components/FamilyNav.tsx"]);
  assert.equal(shared.sharedUi, true);
  assert.equal(shared.screenA11y, false);
  assert.ok(suiteFilesForSelection(shared).browser.some((suite) => suite.kind === "unified"));
});

test("API routes do not trigger shared UI audits; auth remains full scope", () => {
  const api = select(["src/app/api/tasks/route.ts"]);
  assert.equal(api.mode, "impact");
  assert.equal(api.sharedUi, false);
  assert.equal(api.screenA11y, false);
  assert.equal(api.browser, true);
  assert.equal(select(["src/app/api/auth/[...all]/route.ts"]).mode, "full");
  assert.equal(select(["src/app/api/families/route.ts"]).mode, "full");
});

test("catalogue edits select changed domain entries and global policy changes select full", () => {
  const previous = structuredClone(catalog);
  assert.equal(catalogChangeScope(previous, structuredClone(previous)).mode, "full");
  const changedDomain = structuredClone(catalog);
  changedDomain.domains.entrenamiento.browser.push({ kind: "extra", files: ["tests/e2e/training.spec.ts"] });
  assert.deepEqual(catalogChangeScope(previous, changedDomain).groups, ["entrenamiento", "plataforma"].sort());
  const changedPolicy = structuredClone(catalog);
  changedPolicy.invariants.recovery.push("tests/training-routes.integration.mjs");
  assert.equal(catalogChangeScope(previous, changedPolicy).mode, "full");
});

test("catalogue scope unions the old and new selector results without expanding mixed documentation", () => {
  const previous = structuredClone(catalog);
  const candidate = structuredClone(catalog);
  candidate.domains.deportes.browser.push({ kind: "review", files: ["tests/e2e/sports.spec.ts"] });
  const catalogueScope = catalogChangeScope(previous, candidate);
  const mixed = mergeCatalogChangeScope(select(["src/app/entrenamiento/HiitTimer.tsx", "README.md"]), catalogueScope, candidate.domains);
  assert.deepEqual(mixed.groups, ["deportes", "entrenamiento", "plataforma"]);
  assert.equal(mixed.mode, "impact");
  const docsAndCatalog = mergeCatalogChangeScope(select(["README.md", "scripts/verification-catalog.json"]), catalogueScope, candidate.domains);
  assert.deepEqual(docsAndCatalog.groups, ["deportes", "plataforma"]);
  const global = structuredClone(candidate);
  global.invariants.recovery.push("tests/training-routes.integration.mjs");
  assert.equal(mergeCatalogChangeScope(select(["README.md"]), catalogChangeScope(candidate, global), global.domains).mode, "full");
});

test("all required safety invariants map to catalogued cases", () => {
  assert.deepEqual(validateInvariantCoverage(), []);
  assert.ok(validateInvariantCoverage({ authorization: ["tests/missing.test.mjs"] }).some((error) => error.includes("Prueba inválida")));
});

test("route-to-scope snapshots for representative changes", () => {
  const cases = [
    { name: "HIIT change", paths: ["src/app/entrenamiento/HiitTimer.tsx"], before: "impact: entrenamiento,plataforma + broad global UI", after: "impact: entrenamiento,plataforma + accessibility", groups: "entrenamiento,plataforma", browser: true },
    { name: "API change", paths: ["src/app/api/tasks/route.ts"], before: "impact: acceso,deportes,plataforma,tasks + global UI", after: "impact: acceso,deportes,plataforma,tasks", groups: "acceso,deportes,plataforma,tasks", browser: true },
    { name: "documentation", paths: ["README.md"], before: "documentation", after: "documentation", groups: "", browser: false },
    { name: "shared styles", paths: ["src/app/globals.css"], before: "full", after: "full", groups: "acceso,cinemateca,cocina,comidas,deportes,entrenamiento,plataforma,tasks", browser: true },
    { name: "migration", paths: ["drizzle/0001_test.sql"], before: "full", after: "full", groups: "acceso,cinemateca,cocina,comidas,deportes,entrenamiento,plataforma,tasks", browser: true },
    { name: "HIIT plus documentation", paths: ["src/app/entrenamiento/HiitTimer.tsx", "README.md"], before: "full", after: "impact: entrenamiento,plataforma + accessibility", groups: "entrenamiento,plataforma", browser: true },
    { name: "HIIT plus catalogue", paths: ["src/app/entrenamiento/HiitTimer.tsx", "README.md", "scripts/verification-catalog.json"], before: "full", after: "impact: deportes,entrenamiento,plataforma", groups: "deportes,entrenamiento,plataforma", browser: true, catalogueEdit: "deportes" },
  ];
  for (const item of cases) {
    let result = select(item.paths);
    if (item.catalogueEdit) {
      const candidate = structuredClone(catalog);
      candidate.domains[item.catalogueEdit].browser.push({ kind: "review", files: ["tests/e2e/sports.spec.ts"] });
      result = mergeCatalogChangeScope(result, catalogChangeScope(catalog, candidate), candidate.domains);
    }
    assert.equal(result.groups.join(","), item.groups, `${item.name}; antes ${item.before}, ahora ${item.after}`);
    assert.equal(result.browser, item.browser, item.name);
  }
});

test("catalog verification errors force complete scope with a visible reason", () => {
  const result = select(["src/lib/tasks/rules.ts"], { alert: "catalog error" });
  assert.equal(result.mode, "full");
  assert.ok(result.reasons.some((reason) => reason.includes("catalog error")));
});

test("new imports and test files without catalogue entries fail verification", () => {
  assert.deepEqual(undeclaredDependencies(["tasks->comidas"], { tasks: { dependsOn: [] }, comidas: { dependsOn: [] } }), ["Dependencia entre dominios sin declarar: tasks->comidas"]);
  assert.deepEqual(unclassifiedTestFiles(["tests/e2e/new-domain.spec.ts"], new Set(["tests/e2e/tasks.spec.ts"])), ["Prueba sin grupo en el catálogo: tests/e2e/new-domain.spec.ts"]);
});

test("changed-file parsing preserves both sides of renames and deletions", () => {
  assert.deepEqual(parseChangedPaths("M\0README.md\0D\0src/lib/tasks/old.ts\0R100\0src/lib/access/shared.ts\0src/lib/tasks/new.ts\0A\0src/lib/sports/new.ts\0"), [
    "README.md", "src/lib/tasks/old.ts", "src/lib/access/shared.ts", "src/lib/tasks/new.ts", "src/lib/sports/new.ts",
  ]);
});
