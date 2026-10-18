#!/usr/bin/env bash
set -uo pipefail

# Ejecuta el conjunto completo de verificación exclusivamente contra la base
# local descartable champions_test indicada por FAMILY_UTILS_TEST_DATABASE_URL.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATABASE_URL_VALUE="${FAMILY_UTILS_TEST_DATABASE_URL:-}"

if [[ -z "$DATABASE_URL_VALUE" ]]; then
  echo "ERROR: FAMILY_UTILS_TEST_DATABASE_URL no está definida; no se ejecutó nada." >&2
  exit 2
fi

if ! FAMILY_UTILS_VALIDATION_URL="$DATABASE_URL_VALUE" node <<'NODE'
const raw = process.env.FAMILY_UTILS_VALIDATION_URL;
let url;
try { url = new URL(raw); } catch {
  console.error("ERROR: FAMILY_UTILS_TEST_DATABASE_URL no es una URL PostgreSQL válida; no se ejecutó nada.");
  process.exit(2);
}
const host = url.hostname.toLowerCase();
const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
if (!['127.0.0.1', 'localhost'].includes(host) || database !== 'champions_test') {
  console.error(`ERROR: se requiere host 127.0.0.1/localhost y base champions_test (host=${host || '(vacío)'}, base=${database || '(vacía)'}); no se ejecutó nada.`);
  process.exit(2);
}
NODE
then
  exit 2
fi

# Todas las herramientas del proyecto reciben la misma URL validada. No se
# usa un puerto predeterminado ni una URL alternativa del entorno.
export DATABASE_URL="$DATABASE_URL_VALUE"
export DATABASE_URL_UNPOOLED="$DATABASE_URL_VALUE"

cd "$ROOT_DIR" || exit 2
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

declare -a SUITE_NAMES=()
declare -a SUITE_EXECUTED=()
declare -a SUITE_PASSED=()
declare -a SUITE_FAILED=()
declare -a SUITE_SKIPPED=()
ANY_PROBLEM=0

add_result() {
  SUITE_NAMES+=("$1")
  SUITE_EXECUTED+=("$2")
  SUITE_PASSED+=("$3")
  SUITE_FAILED+=("$4")
  SUITE_SKIPPED+=("$5")
  if (( $4 > 0 || $5 > 0 )); then ANY_PROBLEM=1; fi
}

run_check() {
  local name="$1"; shift
  local log="$TMP_DIR/${#SUITE_NAMES[@]}.log"
  printf '==> %s\n' "$name"
  if "$@" >"$log" 2>&1; then
    add_result "$name" 1 1 0 0
    echo "PASS: $name"
  else
    local status=$?
    add_result "$name" 1 0 1 0
    ANY_PROBLEM=1
    echo "FAIL: $name (exit $status)"
    cat "$log"
  fi
}

parse_tap() {
  local file="$1"
  node - "$file" <<'NODE'
const fs = require('node:fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
const last = (name) => [...text.matchAll(new RegExp(`^(?:#|ℹ) ${name}\\s+(\\d+)\\s*$`, 'gm'))].at(-1)?.[1];
const tests = Number(last('tests'));
const passed = Number(last('pass') ?? 0);
const failed = Number(last('fail') ?? 0) + Number(last('cancelled') ?? 0);
const skipped = Number(last('skipped') ?? 0) + Number(last('todo') ?? 0);
if (!Number.isFinite(tests) || tests <= 0) process.exit(2);
console.log([tests, passed, failed, skipped].join('|'));
NODE
}

run_tap_suite() {
  local name="$1"; shift
  local log="$TMP_DIR/${#SUITE_NAMES[@]}.tap"
  printf '==> %s\n' "$name"
  local status=0
  "$@" >"$log" 2>&1 || status=$?
  local parsed=""
  parsed="$(parse_tap "$log" 2>/dev/null)" || true
  if [[ -z "$parsed" ]]; then
    add_result "$name" 0 0 1 0
    ANY_PROBLEM=1
    echo "FAIL: $name (no se pudo obtener el resumen TAP; exit $status)"
    cat "$log"
    return
  fi
  local executed passed failed skipped
  IFS='|' read -r executed passed failed skipped <<<"$parsed"
  if (( status != 0 && failed == 0 )); then failed=1; fi
  add_result "$name" "$executed" "$passed" "$failed" "$skipped"
  if (( status != 0 || failed > 0 || skipped > 0 )); then
    ANY_PROBLEM=1
    echo "FAIL: $name (exit $status; ejecutados=$executed aprobados=$passed fallidos=$failed omitidos=$skipped)"
    cat "$log"
  else
    echo "PASS: $name (ejecutados=$executed aprobados=$passed)"
  fi
}

parse_playwright_json() {
  local file="$1"
  node - "$file" <<'NODE'
const fs = require('node:fs');
let report;
try { report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); }
catch { process.exit(2); }
let executed = 0, passed = 0, failed = 0, skipped = 0;
function visit(suite) {
  for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
    const status = test.status ?? test.results?.at(-1)?.status ?? 'unknown';
    if (status === 'skipped') { skipped++; continue; }
    executed++;
    if (status === 'expected' || (status === 'passed' && test.expectedStatus === 'passed')) passed++;
    else failed++;
  }
  for (const child of suite.suites ?? []) visit(child);
}
for (const suite of report.suites ?? []) visit(suite);
if (executed + skipped === 0) process.exit(2);
console.log([executed + skipped, passed, failed, skipped].join('|'));
NODE
}

run_playwright_suite() {
  local name="$1"; shift
  local report="$TMP_DIR/${#SUITE_NAMES[@]}.json"
  local stderr="$TMP_DIR/${#SUITE_NAMES[@]}.stderr"
  printf '==> %s\n' "$name"
  local status=0
  if [[ "$name" == "Champions" ]]; then
    SPORTS_CHAMPIONS_ENABLED=true npm --silent run test:e2e -- "$@" --reporter=json >"$report" 2>"$stderr" || status=$?
  else
    npm --silent run test:e2e -- "$@" --reporter=json >"$report" 2>"$stderr" || status=$?
  fi
  local parsed=""
  parsed="$(parse_playwright_json "$report" 2>/dev/null)" || true
  if [[ -z "$parsed" ]]; then
    add_result "$name" 0 0 1 0
    ANY_PROBLEM=1
    echo "FAIL: $name (no se pudo obtener el reporte JSON; exit $status)"
    cat "$stderr" "$report"
    return
  fi
  local executed passed failed skipped
  IFS='|' read -r executed passed failed skipped <<<"$parsed"
  if (( status != 0 && failed == 0 )); then failed=1; fi
  add_result "$name" "$executed" "$passed" "$failed" "$skipped"
  if (( status != 0 || failed > 0 || skipped > 0 )); then
    ANY_PROBLEM=1
    echo "FAIL: $name (exit $status; ejecutados=$executed aprobados=$passed fallidos=$failed omitidos=$skipped)"
    cat "$stderr"
  else
    echo "PASS: $name (ejecutados=$executed aprobados=$passed)"
  fi
}

run_check "Typecheck" npm run typecheck
run_check "Lint" npm run lint
run_check "Build" npm run build

run_check "Migraciones ordenadas y hashes de SQL" npm run db:check
run_check "Consistencia de snapshots Drizzle" ./node_modules/.bin/drizzle-kit check
run_check "Historial aplicado y hashes en champions_test" npm run db:verify

run_tap_suite "Reglas/base" npm test
run_tap_suite "Rutas" npm run test:routes
run_playwright_suite "Navegador general"
run_playwright_suite "Deportes" --config playwright.sports-next.config.ts
run_playwright_suite "Champions" --config playwright.champions.config.ts
run_playwright_suite "Accesibilidad" --config playwright.a11y.config.ts

printf '==> Permisos SQL public (solo lectura)\n'
permission_count=0
permission_status=0
permission_count="$(node --input-type=module <<'NODE' 2>"$TMP_DIR/permissions.err"
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.FAMILY_UTILS_TEST_DATABASE_URL });
try {
  const count = await pool.query("SELECT count(*)::int AS n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'");
  console.log(`FUNCTIONS=${count.rows[0].n}`);
  await pool.query(await readFile('sources/champions/permisos-check.sql', 'utf8'));
} finally { await pool.end(); }
NODE
)" || permission_status=$?
permission_count="${permission_count#FUNCTIONS=}"
if (( permission_status == 0 )) && [[ "$permission_count" =~ ^[0-9]+$ ]]; then
  add_result "Permisos public (todas las funciones)" 1 1 0 0
  echo "PASS: permisos SQL ($permission_count funciones enumeradas)"
else
  cat "$TMP_DIR/permissions.err" 2>/dev/null || true
  add_result "Permisos public (todas las funciones)" 1 0 1 0
  ANY_PROBLEM=1
  echo "FAIL: permisos SQL"
fi

printf '\n%-42s %10s %10s %10s %10s\n' "Suite" "Ejecutados" "Aprobados" "Fallidos" "Omitidos"
printf '%-42s %10s %10s %10s %10s\n' "------------------------------------------" "----------" "----------" "----------" "----------"
total_executed=0; total_passed=0; total_failed=0; total_skipped=0
for i in "${!SUITE_NAMES[@]}"; do
  printf '%-42s %10s %10s %10s %10s\n' "${SUITE_NAMES[i]}" "${SUITE_EXECUTED[i]}" "${SUITE_PASSED[i]}" "${SUITE_FAILED[i]}" "${SUITE_SKIPPED[i]}"
  (( total_executed += SUITE_EXECUTED[i] ))
  (( total_passed += SUITE_PASSED[i] ))
  (( total_failed += SUITE_FAILED[i] ))
  (( total_skipped += SUITE_SKIPPED[i] ))
done
printf '%-42s %10s %10s %10s %10s\n' "TOTAL" "$total_executed" "$total_passed" "$total_failed" "$total_skipped"

if (( ANY_PROBLEM || total_failed > 0 || total_skipped > 0 )); then
  echo "ERROR: hay fallos u omisiones en la verificación completa." >&2
  exit 1
fi
echo "Verificación completa: todas las comprobaciones aprobaron sin omisiones."
