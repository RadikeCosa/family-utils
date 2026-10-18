#!/usr/bin/env bash
set -Eeuo pipefail

# Ensayo únicamente sobre una copia restaurada. Nunca lee DATABASE_URL.
# Uso: CHAMPIONS_RESTORE_DATABASE_URL='...' ./sources/champions/ensayo-restauracion.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_URL="${CHAMPIONS_RESTORE_DATABASE_URL:-}"

if [[ -z "$DB_URL" ]]; then
  echo "ERROR: define CHAMPIONS_RESTORE_DATABASE_URL con la copia restaurada." >&2
  exit 2
fi
command -v psql >/dev/null || { echo "ERROR: se requiere psql." >&2; exit 2; }
command -v pg_dump >/dev/null || { echo "ERROR: falta pg_dump (instalá postgresql-client de versión igual o mayor al servidor, o usá la imagen postgres:<versión>)." >&2; exit 2; }
command -v npm >/dev/null || { echo "ERROR: se requiere npm." >&2; exit 2; }

# Verifica primero el nombre de base y la dirección solicitada (solo localhost/
# loopback); después acepta la IP interna del bridge Docker usado por el
# PostgreSQL local además de sockets Unix y loopback nativo.
IFS='|' read -r SERVER_ADDR DATABASE_NAME < <(
  psql "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 -F '|' \
    -c "SELECT COALESCE(inet_server_addr()::text,'local-socket'), current_database()"
)
if [[ ! "$DATABASE_NAME" =~ (ensayo|test) ]]; then
  echo "ERROR: el nombre de base '$DATABASE_NAME' no contiene ensayo ni test; se cancela." >&2
  exit 3
fi
DATABASE_HOST="$(node --input-type=module -e 'const u=new URL(process.argv[1]);process.stdout.write(u.hostname.replace(/^\[|\]$/g,"").toLowerCase())' "$DB_URL")"
case "$DATABASE_HOST" in
  ""|localhost|127.*|::1) ;;
  *) echo "ERROR: la URL de destino no apunta a localhost/loopback (host=$DATABASE_HOST); se cancela." >&2; exit 3 ;;
esac
case "$SERVER_ADDR" in
  local-socket|127.*|::1|172.1[6-9].*|172.2[0-9].*|172.3[01].*) ;;
  *) echo "ERROR: dirección del servidor fuera de loopback o bridge local de Docker ($SERVER_ADDR); se cancela sin migrar." >&2; exit 3 ;;
esac

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

snapshot_sports() {
  local dest="$1"
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -At -F '|' >"$dest" <<'SQL'
SELECT format(
  'SELECT %L, count(*)::bigint, md5(COALESCE(string_agg(md5(to_jsonb(t)::text), %L ORDER BY to_jsonb(t)::text), %L)) FROM %I.%I AS t;',
  tablename, '', '' , schemaname, tablename)
FROM pg_catalog.pg_tables
WHERE schemaname='public' AND tablename LIKE 'sports\_%' ESCAPE '\'
ORDER BY tablename
\gexec
SQL
}

# Hashes de contenido de los datos que deben sobrevivir idénticos. En peleas
# se conserva además el hash completo; la comparación estable excluye solo la
# columna derivada que 0037 agrega (prode_eligible).
snapshot_protected() {
  local dest="$1"
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -At -F '|' >"$dest" <<'SQL'
WITH protected(table_name, projection) AS (VALUES
 ('sports_predictions', 'to_jsonb(t)'),
 ('sports_fight_results', 'to_jsonb(t)'),
 ('sports_football_predictions', 'to_jsonb(t)'),
 ('sports_football_results', 'to_jsonb(t)'),
 ('sports_comments', 'to_jsonb(t)'),
 ('sports_football_round_comments', 'to_jsonb(t)'),
 ('sports_fights', 'to_jsonb(t) - ''prode_eligible''::text')
), present AS (
 SELECT p.table_name,p.projection
 FROM protected p JOIN pg_catalog.pg_tables t
   ON t.schemaname='public' AND t.tablename=p.table_name
)
SELECT format(
 'SELECT %L, count(*)::bigint, md5(COALESCE(string_agg(md5((%s)::text), %L ORDER BY (%s)::text), %L)) FROM public.%I AS t;',
 p.table_name, p.projection, '', p.projection, '', p.table_name)
FROM present p ORDER BY p.table_name
\gexec
SQL
  # Absent-before tables are recorded explicitly so their appearance is not
  # misclassified as an existing-data mutation.
  for table in sports_predictions sports_fight_results sports_football_predictions sports_football_results sports_comments sports_football_round_comments sports_fights; do
    if ! cut -d'|' -f1 "$dest" | grep -Fxq "$table"; then
      printf '%s|MISSING|MISSING\n' "$table" >>"$dest"
    fi
  done
  sort -o "$dest" "$dest"
}

echo "Destino seguro: base '$DATABASE_NAME' en host $DATABASE_HOST y servidor local/bridge Docker ($SERVER_ADDR)."
echo "Tablas deportivas: filas y MD5 de contenido completo."
echo "Tablas protegidas con MD5 para invariancia: sports_predictions, sports_fight_results, sports_football_predictions, sports_football_results, sports_comments, sports_football_round_comments y sports_fights (proyección estable sin prode_eligible)."

snapshot_sports "$TMP_DIR/sports-before.txt"
snapshot_protected "$TMP_DIR/protected-before.txt"
echo "--- ANTES: tabla | filas | md5 ---"
cat "$TMP_DIR/sports-before.txt"

echo "--- Aplicando migraciones pendientes sobre la copia ---"
(
  cd "$ROOT_DIR"
  env -u DATABASE_URL DATABASE_URL_UNPOOLED="$DB_URL" npm run db:migrate
)

snapshot_sports "$TMP_DIR/sports-after.txt"
snapshot_protected "$TMP_DIR/protected-after.txt"
echo "--- DESPUÉS: tabla | filas | md5 ---"
cat "$TMP_DIR/sports-after.txt"
echo "--- Diferencia del inventario/filas/hash de tablas sports_* ---"
if diff -u "$TMP_DIR/sports-before.txt" "$TMP_DIR/sports-after.txt"; then
  echo "Sin diferencias en tablas sports_*."
else
  echo "Las diferencias anteriores incluyen cambios de esquema y backfills esperados; revisar la clasificación indicada abajo."
fi

echo "--- Invariancia de contenido protegido ---"
protected_problem=0
while IFS='|' read -r table before_count before_hash; do
  after_line="$(awk -F'|' -v name="$table" '$1==name {print; exit}' "$TMP_DIR/protected-after.txt")"
  if [[ -z "$after_line" ]]; then
    echo "ALERTA: falta la tabla protegida $table después de migrar." >&2
    protected_problem=1
    continue
  fi
  IFS='|' read -r _ after_count after_hash <<<"$after_line"
  if [[ "$before_count" == MISSING && "$after_count" == 0 ]]; then
    echo "OK: $table no existía y la migración creó una tabla vacía."
  elif [[ "$before_count" == "$after_count" && "$before_hash" == "$after_hash" ]]; then
    echo "OK: $table conserva el mismo contenido previo."
  else
    echo "ALERTA: $table cambió: antes filas=$before_count md5=$before_hash; después filas=$after_count md5=$after_hash." >&2
    protected_problem=1
  fi
done <"$TMP_DIR/protected-before.txt"
if (( protected_problem )); then
  exit 4
fi
echo "OK: contenido protegido existente sin cambios."

cat <<'EXPECTED'
--- Cambios esperados por esta rama ---
0038: sports_events.football_category se normaliza a NULL en filas UFC; se crean referencias deportivas de proveedor para los eventos existentes de fútbol. River conserva su categoría histórica/default.
0039: se crean vacías las tablas de cierres y pronósticos de fútbol y se ajusta la restricción de estados; no cambia el contenido protegido existente.
0040–0041: funciones, permisos y privilegios por defecto; no cambian filas de negocio.
0042: función de tabla de Champions; no inserta resultados.
0043: se crea vacía la tabla de comentarios de jornada.
0044: se agrega una fila de switch apagado por familia existente.
0045: se crea vacía la tabla de resoluciones administrativas.
0046: se crea vacía la tabla de auditoría de correcciones.
0047: permisos y privilegios por defecto; no cambia filas de negocio.
0037: ya está aplicada en la producción de referencia (fila 28), conserva su hash original y no pertenece a las migraciones pendientes de esta rama. Si el respaldo indica 28 migraciones y db:migrate intenta aplicar 0037, detenerse y revisar restauración, historial y hashes.
Las tablas que deben permanecer idénticas son las enumeradas arriba. Cualquier discrepancia dispara la alerta y detiene el script.
EXPECTED

echo "--- Permisos de ejecución en public ---"
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT_DIR/sources/champions/permisos-check.sql"
echo "Ensayo de restauración completado. No se hicieron cambios en producción."
