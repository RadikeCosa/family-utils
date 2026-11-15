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
try {
  url = new URL(raw);
  decodeURIComponent(url.pathname);
} catch {
  console.error("ERROR: FAMILY_UTILS_TEST_DATABASE_URL no es una URL PostgreSQL válida; no se ejecutó nada.");
  process.exit(2);
}
const host = url.hostname.toLowerCase();
const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash
  || !['127.0.0.1', 'localhost'].includes(host) || database !== 'champions_test') {
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
# El build y los servidores locales no deben heredar credenciales de autenticación reales.
export BETTER_AUTH_SECRET="verification-local-only-secret-at-least-32-characters"
export CODE_PEPPER="verification-local-only-pepper-at-least-32-characters"
export BETTER_AUTH_URL="http://localhost:3000"
export GOOGLE_CLIENT_ID=""
export GOOGLE_CLIENT_SECRET=""

cd "$ROOT_DIR" || exit 2
TMP_DIR="$(mktemp -d)"
auxiliary_database() {
  node --input-type=module - "$1" "$TMP_DIR/unified-url" <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const [action, file] = process.argv.slice(2);
const base = new URL(process.env.FAMILY_UTILS_TEST_DATABASE_URL);
const pool = new pg.Pool({ connectionString: base.toString(), connectionTimeoutMillis: 5000 });
try {
  if (action === 'create') {
    const name = `family_unified_${randomUUID().replaceAll('-', '')}_test`;
    await pool.query(`CREATE DATABASE "${name}"`);
    base.pathname = `/${name}`;
    try { await writeFile(file, base.toString(), { mode: 0o600 }); }
    catch (error) { await pool.query(`DROP DATABASE "${name}"`); throw error; }
  } else {
    const url = new URL(await readFile(file, 'utf8'));
    const name = url.pathname.slice(1);
    if (!/^family_unified_[a-f0-9]{32}_test$/.test(name)
      || url.host !== base.host || url.username !== base.username) throw new Error('Invalid auxiliary test database');
    await pool.query(`DROP DATABASE "${name}"`);
  }
} finally { await pool.end(); }
NODE
}
cleanup() {
  local status=$?
  if [[ -f "$TMP_DIR/unified-url" ]]; then
    if ! auxiliary_database drop; then
      echo "ERROR: no se pudo retirar la base auxiliar creada por esta ejecución." >&2
      status=1
    fi
  fi
  rm -rf "$TMP_DIR"
  exit "$status"
}
trap cleanup EXIT

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
  node scripts/verification-results.mjs tap "$file"
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
  node scripts/verification-results.mjs playwright "$file"
}

run_playwright_suite() {
  local name="$1"; shift
  local report="$TMP_DIR/${#SUITE_NAMES[@]}.json"
  local stderr="$TMP_DIR/${#SUITE_NAMES[@]}.stderr"
  printf '==> %s\n' "$name"
  local status=0
  npm --silent run test:e2e -- "$@" --reporter=json >"$report" 2>"$stderr" || status=$?
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
    node scripts/verification-results.mjs playwright-failures "$report"
  else
    echo "PASS: $name (ejecutados=$executed aprobados=$passed)"
  fi
}

# Verificar el servidor antes de aplicar migraciones o ejecutar suites.
if ! node --input-type=module <<'NODE'
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.FAMILY_UTILS_TEST_DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  const { rows } = await pool.query("SELECT current_setting('server_version_num')::int AS version");
  if (Math.floor(rows[0].version / 10000) !== 18) throw new Error('La verificación requiere PostgreSQL 18');
} finally { await pool.end(); }
NODE
then
  echo "ERROR: PostgreSQL 18 local no está disponible; no se ejecutaron suites." >&2
  exit 2
fi

run_check "Dependencias instaladas" npm ls --depth=0
run_check "Migraciones ordenadas y hashes de SQL" npm run db:check
run_check "Consistencia de snapshots Drizzle" ./node_modules/.bin/drizzle-kit check
# Migrar solo la base local validada; detenerse si no puede prepararse.
if ! npm run db:migrate; then
  echo "ERROR: no se pudo preparar champions_test; no se ejecutaron suites." >&2
  exit 1
fi
run_check "Typecheck" npm run typecheck
run_check "Lint" npm run lint
run_check "Build" npm run build

run_check "Historial aplicado y hashes en champions_test" npm run db:verify

run_tap_suite "Reglas/base" npm test
run_tap_suite "Navegación" npm run test:navigation
run_tap_suite "Herramientas de agentes" node --test tests/agent-tooling.test.mjs
run_tap_suite "Rutas" npm run test:routes
run_playwright_suite "Recetas" --config playwright.recipes.config.ts
run_playwright_suite "Navegador general"
run_playwright_suite "Deportes" --config playwright.sports-next.config.ts
run_playwright_suite "Champions" --config playwright.champions.config.ts
run_playwright_suite "Accesibilidad" --config playwright.a11y.config.ts

# Igual que CI, aislar interfaz unificada y diario de las suites generales.
run_check "Crear base auxiliar de interfaz" auxiliary_database create
if [[ -f "$TMP_DIR/unified-url" ]]; then
  AUXILIARY_URL="$(cat "$TMP_DIR/unified-url")"
  (
    export FAMILY_UTILS_TEST_DATABASE_URL="$AUXILIARY_URL"
    export DATABASE_URL="$AUXILIARY_URL"
    export DATABASE_URL_UNPOOLED="$AUXILIARY_URL"
    npm run db:migrate
  ) >"$TMP_DIR/unified-migrate.log" 2>&1
  auxiliary_migration_status=$?
  if (( auxiliary_migration_status == 0 )); then
    add_result "Migrar base auxiliar" 1 1 0 0
    # Asignaciones temporales: conservar el resumen en este shell y restaurar las URLs.
    FAMILY_UTILS_TEST_DATABASE_URL="$AUXILIARY_URL" DATABASE_URL="$AUXILIARY_URL" DATABASE_URL_UNPOOLED="$AUXILIARY_URL" \
      run_playwright_suite "Interfaz unificada" --config playwright.unified.config.ts
    FAMILY_UTILS_TEST_DATABASE_URL="$AUXILIARY_URL" DATABASE_URL="$AUXILIARY_URL" DATABASE_URL_UNPOOLED="$AUXILIARY_URL" TRAINING_DIARY_PERFORMANCE=1 \
      run_tap_suite "Diario: migración/API/rendimiento" npm run test:training:diary
    FAMILY_UTILS_TEST_DATABASE_URL="$AUXILIARY_URL" DATABASE_URL="$AUXILIARY_URL" DATABASE_URL_UNPOOLED="$AUXILIARY_URL" \
      run_playwright_suite "Diario: navegador" --config playwright.training-diary.config.ts
  else
    add_result "Migrar base auxiliar" 1 0 1 0
    cat "$TMP_DIR/unified-migrate.log"
  fi
fi
if [[ ! -f "$TMP_DIR/unified-url" ]] || (( ${auxiliary_migration_status:-1} != 0 )); then
  add_result "Interfaz unificada" 0 0 0 1
  add_result "Diario: migración/API/rendimiento" 0 0 0 1
  add_result "Diario: navegador" 0 0 0 1
fi

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
