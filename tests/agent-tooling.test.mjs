import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlaywright, parseTap, playwrightFailures } from "../scripts/verification-results.mjs";

test("verifier rejects missing, malformed, remote and overridden destinations before running tools", () => {
  for (const url of [undefined, "not a URL", "postgres://family:family@remote.invalid/champions_test",
    "postgres://family:family@localhost/family_utils", "https://localhost/champions_test",
    "postgres://family:family@localhost/champions_test?host=remote.invalid",
    "postgres://family:family@localhost/champions_test#fragment",
    "postgres://family:family@localhost/%ZZ"]) {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.FAMILY_UTILS_TEST_DATABASE_URL;
    if (url !== undefined) env.FAMILY_UTILS_TEST_DATABASE_URL = url;
    const result = spawnSync("bash", ["scripts/verificar-todo.sh"], { env, encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 2, `${url}: ${result.stderr}`);
    if (url === undefined) assert.match(result.stderr, /FAMILY_UTILS_TEST_DATABASE_URL no está definida/);
    else assert.doesNotMatch(result.stdout, /==>/);
    assert.match(result.stderr, /ERROR:/);
  }
});

test("TAP counts failures, cancellations and omissions and rejects incomplete evidence", () => {
  assert.deepEqual(parseTap("# tests 4\n# pass 1\n# fail 1\n# cancelled 1\n# skipped 1\n# todo 0\n"), [4, 1, 2, 1]);
  assert.deepEqual(parseTap("ℹ tests 2\nℹ pass 2\nℹ fail 0\nℹ skipped 0\n"), [2, 2, 0, 0]);
  for (const text of ["", "# tests 0\n# pass 0\n# fail 0\n", "# tests 3\n# pass 1\n# fail 0\n"]) {
    assert.throws(() => parseTap(text));
  }
});

test("Playwright counts skipped, flaky and interrupted tests and global errors", () => {
  const report = { suites: [{ suites: [{ specs: [{ tests: [
    { status: "expected" }, { status: "skipped" }, { status: "flaky" },
    { status: "unexpected" }, { status: "interrupted" },
  ] }] }] }], errors: [{ message: "teardown failed" }] };
  assert.deepEqual(parsePlaywright(report), [6, 1, 4, 1]);
  assert.throws(() => parsePlaywright({ suites: [] }));
});

test("browser failure evidence retains project, test and cause after temporary reports are removed", () => {
  const evidence = playwrightFailures({ suites: [{ title: "screen.spec.ts", specs: [{ title: "opens", tests: [
    { projectName: "WebKit", status: "unexpected", results: [{ errors: [{ message: "libxml2.so.2: not found" }] }] },
    { projectName: "Chromium", status: "expected" },
  ] }] }], errors: [{ message: "global teardown error" }] });
  assert.match(evidence, /\[WebKit\] screen\.spec\.ts > opens: unexpected/);
  assert.match(evidence, /libxml2\.so\.2: not found/);
  assert.match(evidence, /global teardown error/);
  assert.doesNotMatch(evidence, /Chromium/);
});

test("skills installer and checker preserve a pre-existing divergent installation", async () => {
  const destination = await mkdtemp(join(tmpdir(), "family-skills-collision-"));
  try {
    await mkdir(join(destination, "neon"));
    const file = join(destination, "neon/SKILL.md");
    await writeFile(file, "existing local skill\n");
    for (const command of ["install", "check"]) {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, ["scripts/project-skills.mjs", command, "--dest", destination], { env, encoding: "utf8" });
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /preserved without changes/);
      assert.equal(await readFile(file, "utf8"), "existing local skill\n");
    }
  } finally { await rm(destination, { recursive: true, force: true }); }
});
