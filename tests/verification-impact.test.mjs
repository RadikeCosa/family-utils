import test from "node:test";
import assert from "node:assert/strict";
import { parseChangedPaths, select, undeclaredDependencies, unclassifiedTestFiles, validateCatalog } from "../scripts/verification-impact.mjs";

test("catalogue classifies every test and declares every static cross-domain import", async () => {
  const result = await validateCatalog();
  assert.deepEqual(result.errors, []);
  assert.ok(result.tests.length > 50);
});

test("documentation-only allowlist applies only when every changed file is allowed Markdown", () => {
  assert.equal(select(["README.md", "sources/deployment.md"]).mode, "documentation");
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

test("interface changes add shared accessibility and unified UI suites", () => {
  const result = select(["src/app/tareas/page.tsx"]);
  assert.equal(result.sharedUi, true);
  assert.equal(result.browser, true);
  assert.ok(result.groups.includes("tasks"));
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
