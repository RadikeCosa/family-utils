import pg from "pg";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
export const connectionString = process.env.FAMILY_UTILS_TEST_DATABASE_URL;
export async function diaryDatabase(options = {}) {
  if (!connectionString) throw new Error("Explicit FAMILY_UTILS_TEST_DATABASE_URL required");
  const url = new URL(connectionString);
  if (!url.pathname.endsWith("_test") || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Diary acceptance tests require a local isolated database ending in _test");
  const admin = new pg.Pool({ connectionString }), name = `diary_${randomUUID().replaceAll("-", "")}_test`;
  await admin.query(`CREATE DATABASE "${name}"`); url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  try {
    if (options.beforeDiary) {
      const { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
      const folder = await mkdtemp(join(tmpdir(), "diary-before-"));
      try {
        const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")); journal.entries = journal.entries.slice(0, journal.entries.findIndex(entry => entry.tag === "0067_training_diary"));
        await mkdir(join(folder, "meta")); await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
        for (const entry of journal.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
        await migrate(drizzle(pool), { migrationsFolder: folder }); await options.beforeDiary(pool);
      } finally { await rm(folder, { recursive: true, force: true }); }
    }
    try { await migrate(drizzle(pool), { migrationsFolder: "drizzle" }); }
    catch (error) { if (options.onMigrationError) await options.onMigrationError(pool); throw error; }
  }
  catch (error) { await pool.end(); await admin.query(`DROP DATABASE "${name}"`); await admin.end(); throw error; }
  return { pool, url: url.toString(), async close() { await pool.end(); await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end(); } };
}
export async function diaryServer(databaseURL, writable, unified = true) {
  const listener = createServer(); await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const origin = `http://localhost:${port}`, logs = [];
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...process.env, NODE_ENV: "production", DATABASE_URL: databaseURL, TRAINING_ENABLED: "true", TRAINING_DIARY_ENABLED: String(writable), TRAINING_OPTIONAL_METRICS_ENABLED: "true", TRAINING_OPTIONAL_METRICS_FORM_ENABLED: "true", UNIFIED_UI_ENABLED: String(unified), BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "diary-test-only-secret-not-production", CODE_PEPPER: "diary-test-only-pepper-not-production", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", value => logs.push(value.toString())); server.stderr.on("data", value => logs.push(value.toString()));
  for (let i = 0; i < 200; i++) {
    if (server.exitCode !== null) throw new Error(`Diary test server exited: ${logs.join("")}`);
    try { if ((await fetch(origin)).ok) return { origin, logs, async close() { server.kill(); if (server.exitCode === null) await once(server, "exit"); } }; } catch { /* listener starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  server.kill(); throw new Error("Diary test server startup timeout");
}
export async function diaryProfile(server, name, pool, familyId, role = "member") {
  const signup = await fetch(`${server.origin}/api/access/prepare`, { method: "POST", headers: { Origin: server.origin, "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 200) + 1}` } });
  if (!signup.ok) throw new Error(`Prepare failed: ${await signup.text()}`);
  const cookie = signup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const session = await fetch(`${server.origin}/api/auth/get-session`, { headers: { Cookie: cookie } }).then(res => res.json());
  familyId ??= (await pool.query("INSERT INTO families(name) VALUES($1) RETURNING id", [name])).rows[0].id;
  const member = (await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,$2,$3) RETURNING id", [familyId, name, role])).rows[0];
  await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)", [member.id, session.user.id]);
  return { cookie, id: member.id, familyId, userId: session.user.id };
}
export async function diaryCall(server, profile, path, method = "GET", body, contract = "3") {
  const res = await fetch(`${server.origin}/api/training/${path}`, { method, headers: { Cookie: profile.cookie, Origin: server.origin, "Content-Type": "application/json", "X-Training-Contract": contract }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json() };
}
