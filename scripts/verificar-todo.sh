#!/usr/bin/env bash
set -euo pipefail

# Selección por impacto local predeterminada. --full fuerza el inventario completo.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATABASE_URL_VALUE="${FAMILY_UTILS_TEST_DATABASE_URL:-}"
FULL=0
MAIN_REF="origin/main"
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    --main-ref=*) MAIN_REF="${arg#*=}" ;;
    --help|-h) echo "Uso: FAMILY_UTILS_TEST_DATABASE_URL=postgres://.../champions_test bash scripts/verificar-todo.sh [--full] [--main-ref=origin/main]"; exit 0 ;;
    *) echo "ERROR: argumento desconocido: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "$DATABASE_URL_VALUE" ]]; then
  echo "ERROR: FAMILY_UTILS_TEST_DATABASE_URL no está definida; no se ejecutó nada." >&2
  exit 2
fi
if ! FAMILY_UTILS_VALIDATION_URL="$DATABASE_URL_VALUE" node <<'NODE'
const raw = process.env.FAMILY_UTILS_VALIDATION_URL;
let url;
try { url = new URL(raw); decodeURIComponent(url.pathname); }
catch { console.error("ERROR: FAMILY_UTILS_TEST_DATABASE_URL no es URL PostgreSQL válida."); process.exit(2); }
const database = decodeURIComponent(url.pathname.slice(1));
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash
  || !['127.0.0.1', 'localhost'].includes(url.hostname.toLowerCase()) || database !== 'champions_test') {
  console.error(`ERROR: se requiere PostgreSQL local y base champions_test (host=${url.hostname}, base=${database}); no se ejecutó nada.`);
  process.exit(2);
}
NODE
then exit 2; fi

export DATABASE_URL="$DATABASE_URL_VALUE"
export DATABASE_URL_UNPOOLED="$DATABASE_URL_VALUE"
export BETTER_AUTH_SECRET="verification-local-only-secret-at-least-32-characters"
export CODE_PEPPER="verification-local-only-pepper-at-least-32-characters"
export BETTER_AUTH_URL="http://localhost:3000"
export GOOGLE_CLIENT_ID=""
export GOOGLE_CLIENT_SECRET=""
cd "$ROOT_DIR"

SERVER_MAJOR="$(node --input-type=module <<'NODE'
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.FAMILY_UTILS_TEST_DATABASE_URL, connectionTimeoutMillis: 5000 });
try { const { rows } = await pool.query("SELECT current_setting('server_version_num')::int AS version"); console.log(Math.floor(rows[0].version / 10000)); }
finally { await pool.end(); }
NODE
)" || { echo "ERROR: PostgreSQL 18 local no está disponible; no se ejecutaron suites." >&2; exit 2; }
if [[ "$SERVER_MAJOR" != 18 ]]; then echo "ERROR: se requiere PostgreSQL 18 (detectado $SERVER_MAJOR)." >&2; exit 2; fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
SCOPE_ARGS=(--local "--main-ref" "$MAIN_REF" --output "$TMP_DIR/selection.json")
if (( FULL )); then SCOPE_ARGS+=(--full); fi
echo "==> Seleccionar alcance"
CATALOG_INVALID=0
if node scripts/verification-impact.mjs "${SCOPE_ARGS[@]}" >"$TMP_DIR/selection.log"; then
  :
else
  SELECTOR_STATUS=$?
  if [[ -s "$TMP_DIR/selection.json" ]]; then CATALOG_INVALID=1; else cat "$TMP_DIR/selection.log"; exit "$SELECTOR_STATUS"; fi
fi
cat "$TMP_DIR/selection.log"
MODE="$(node -e 'const s=require(process.argv[1]);process.stdout.write(s.mode)' "$TMP_DIR/selection.json")"
if (( CATALOG_INVALID )) && [[ "$MODE" != full ]]; then echo "ERROR: el catálogo inválido no forzó ejecución completa." >&2; exit 1; fi
if [[ "$MODE" == documentation ]]; then
  echo "==> Revisar whitespace y conflictos en documentación"
  git diff --check "$(node -e 'const s=require(process.argv[1]);process.stdout.write(s.base)' "$TMP_DIR/selection.json")" --
  node scripts/check-documentation.mjs "$TMP_DIR/selection.json"
  echo "Verificación documental terminada. No se compilaron ni ejecutaron suites de aplicación."
  exit 0
fi

run_check() {
  echo "==> $1"
  shift
  "$@"
}
run_check "Dependencias instaladas" npm ls --depth=0
run_check "Migraciones ordenadas y hashes de SQL" npm run db:check
run_check "Consistencia de snapshots Drizzle" ./node_modules/.bin/drizzle-kit check
run_check "Preparar champions_test aislada" npm run db:migrate
run_check "Typecheck" npm run typecheck
run_check "Lint" npm run lint
run_check "Build" npm run build
run_check "Historial aplicado" npm run db:verify

if [[ "$MODE" == full ]]; then
  run_check "Permisos SQL public" psql "$DATABASE_URL_UNPOOLED" -X -v ON_ERROR_STOP=1 -f sources/champions/permisos-check.sql
fi
run_check "Suites del alcance seleccionado" node scripts/run-verification-suites.mjs --selection "$TMP_DIR/selection.json"
if (( CATALOG_INVALID )); then echo "ERROR: suite completa terminada, pero el catálogo requiere corrección." >&2; exit 1; fi
