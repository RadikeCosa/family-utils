#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const selectionPath = process.argv[2];
if (!selectionPath) throw new Error("Uso: check-documentation.mjs <selection.json>");
const selection = JSON.parse(await readFile(selectionPath, "utf8"));
const errors = [];
for (const file of selection.files.filter((name) => name.endsWith(".md"))) {
  const content = await readFile(path.join(root, file), "utf8");
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (!raw || /^(?:[a-z]+:|\/\/|#)/i.test(raw)) continue;
    let target;
    try { target = decodeURIComponent(raw.split(/[?#]/, 1)[0]); }
    catch { errors.push(`${file}: enlace local con escape inválido: ${raw}`); continue; }
    if (!target) continue;
    const resolved = path.resolve(path.dirname(path.join(root, file)), target);
    if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) { errors.push(`${file}: enlace fuera del repositorio: ${raw}`); continue; }
    try { await access(resolved); }
    catch { errors.push(`${file}: destino local inexistente: ${raw}`); }
  }
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`Enlaces locales comprobados en ${selection.files.filter((name) => name.endsWith(".md")).length} documentos.`);
