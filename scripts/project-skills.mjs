import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// Hash paths and file bytes, independent of checkout location and file timestamps.
async function directoryHash(directory) {
  const files = [];
  async function visit(relative = "") {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Unsupported symlink or special file: ${path}`);
    }
  }
  await visit();
  const hash = createHash("sha256");
  for (const path of files.sort()) {
    hash.update(path).update("\0");
    hash.update(createHash("sha256").update(await readFile(join(directory, path))).digest("hex"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function exists(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { maxBuffer: 32 * 1024 * 1024 });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  let destination = join(root, ".agents/skills");
  if (args[0] === "--dest" && args[1]) {
    destination = resolve(args[1]);
    args.splice(0, 2);
  }
  if (!["install", "check", "hash"].includes(command) || args.length) {
    throw new Error("Usage: node scripts/project-skills.mjs install|check|hash [--dest DIRECTORY]");
  }
  if (command === "hash") { console.log(await directoryHash(destination)); return; }
  const lock = JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
  if (lock.version !== 2) throw new Error("Unsupported project skills lock version");
  const entries = Object.entries(lock.skills);
  const pending = [];
  // Validate all entries and collisions before fetching or installing anything.
  for (const [name, entry] of entries) {
    if (!/^[a-z0-9-]+$/.test(name) || !/^[\w-]+\/[\w.-]+$/.test(entry.source)
      || !/^[a-f0-9]{40}$/.test(entry.revision) || !/^[a-f0-9]{40}$/.test(entry.gitTree)
      || !/^[a-f0-9]{64}$/.test(entry.directorySha256)
      || !/^skills\/[a-z0-9-]+\/SKILL\.md$/.test(entry.skillPath)) {
      throw new Error(`Invalid pinned source: ${name}`);
    }
    const target = join(destination, name);
    const stat = await exists(target);
    if (stat) {
      if (!stat.isDirectory() || stat.isSymbolicLink()
        || await directoryHash(target) !== entry.directorySha256) {
        throw new Error(`${name}: existing installation differs; preserved without changes. Use --dest with an empty directory to review the pinned version.`);
      }
      console.log(`OK ${name} ${entry.revision}`);
    } else {
      if (command === "check") throw new Error(`${name}: not installed in ${destination}`);
      pending.push([name, entry]);
    }
  }
  if (!pending.length) return;
  const temporary = await mkdtemp(join(tmpdir(), "family-project-skills-"));
  try {
    const repositories = new Map();
    const staged = [];
    for (const [name, entry] of pending) {
      const key = `${entry.source}@${entry.revision}`;
      let repository = repositories.get(key);
      if (!repository) {
        repository = join(temporary, `repo-${repositories.size}`);
        await mkdir(repository);
        git(repository, "init", "-q");
        git(repository, "fetch", "-q", "--depth=1", `https://github.com/${entry.source}.git`, entry.revision);
        repositories.set(key, repository);
      }
      const sourcePath = dirname(entry.skillPath);
      const tree = git(repository, "rev-parse", `${entry.revision}:${sourcePath}`).toString().trim();
      if (tree !== entry.gitTree) throw new Error(`${name}: upstream tree differs from lock`);
      const stage = join(temporary, name);
      await mkdir(stage);
      const listing = git(repository, "ls-tree", "-r", "-z", tree).toString().split("\0").filter(Boolean);
      for (const line of listing) {
        const tab = line.indexOf("\t");
        const [mode, type, object] = line.slice(0, tab).split(" ");
        const path = line.slice(tab + 1);
        if (!["100644", "100755"].includes(mode) || type !== "blob"
          || path.split("/").some(part => !part || part === "." || part === "..")
          || path.includes("\\")) throw new Error(`${name}: unsupported upstream entry ${path}`);
        const file = join(stage, path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, git(repository, "cat-file", "blob", object), { mode: mode === "100755" ? 0o755 : 0o644 });
      }
      await readFile(join(stage, "SKILL.md"));
      if (await directoryHash(stage) !== entry.directorySha256) throw new Error(`${name}: content checksum differs from lock`);
      staged.push([name, stage]);
    }
    await mkdir(destination, { recursive: true });
    for (const [name, stage] of staged) {
      const target = join(destination, name);
      // Copy to a sibling first so the final rename also works across filesystems.
      const sibling = await mkdtemp(join(destination, `.install-${name}-`));
      try {
        const { cp } = await import("node:fs/promises");
        const prepared = join(sibling, "content");
        await cp(stage, prepared, { recursive: true, errorOnExist: true, force: false });
        if (await exists(target)) throw new Error(`${name}: destination appeared during install; preserved`);
        await rename(prepared, target);
      } finally { await rm(sibling, { recursive: true, force: true }); }
      console.log(`Installed ${name}; instructions will be available in a new chat.`);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
