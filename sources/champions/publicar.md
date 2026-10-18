# Publicación directa — `champions-fase-1-rc5`

Runbook manual para una sola ejecución. Mantener el switch de familia apagado hasta que se indique. La hora límite de apertura es **20/10/2026 13:45 (Argentina)**; si falta cualquier verificación a esa hora, no abrir y mover el estreno a Jornada 4.

## Pasos manuales

1. **manual — preparar copia limpia y preflight.** Clonar solo el tag final, comprobar tag exacto y árbol limpio, y ejecutar `./scripts/preflight-publicacion.sh`:
   ```sh
   git clone --branch champions-fase-1-rc5 --single-branch https://github.com/RadikeCosa/family-utils.git "$RC_DIR"
   test -z "$(git -C "$RC_DIR" status --porcelain)"
   test "$(git -C "$RC_DIR" describe --tags --exact-match)" = champions-fase-1-rc5
   (cd "$RC_DIR" && ./scripts/preflight-publicacion.sh)
   ```
   **Esperado:** el tag es `champions-fase-1-rc5`, `git status --porcelain` no imprime nada y todos los preflight obligatorios dicen OK. **Reversión:** borrar únicamente `$RC_DIR`. **NO SEGUIR SI:** el tag, commit, árbol o herramientas no coinciden.

2. **manual — respaldo y ensayo restaurado.** Con `DATABASE_URL_UNPOOLED` como conexión directa, consultar `SHOW server_version`; usar `pg_dump` de versión igual o mayor y mantener la URL fuera de archivos, argumentos registrados y logs:
   ```sh
   psql "$DATABASE_URL_UNPOOLED" -X -At -c 'SHOW server_version'
   pg_dump --version
   pg_dump --format=custom --file="$BACKUP_FILE" "$DATABASE_URL_UNPOOLED"
   pg_restore --list "$BACKUP_FILE" >/dev/null
   ```
   Si falta un cliente compatible, alternativa en Linux/WSL con `.pgpass` montado y sin pasar la URL al contenedor:
   ```sh
   docker run --rm --network host \
     -v "$HOME/.pgpass:/root/.pgpass:ro" -e PGPASSFILE=/root/.pgpass \
     -e PGHOST -e PGPORT -e PGUSER -e PGDATABASE \
     "postgres:$SERVER_MAJOR" pg_dump -Fc -f /dev/stdout >"$BACKUP_FILE"
   ```
   Restaurar **ese mismo respaldo** en la base local descartable `champions_test` y ejecutar:
   ```sh
   pg_restore --no-owner --no-acl --dbname="$CHAMPIONS_TEST_URL" "$BACKUP_FILE"
   CHAMPIONS_RESTORE_DATABASE_URL="$CHAMPIONS_TEST_URL" "$RC_DIR/sources/champions/ensayo-restauracion.sh"
   ```
   **Esperado:** pg_dump no es más viejo que el servidor; el ensayo valida la copia local, reporta mediciones antes/después y no alerta diferencias en contenido protegido. **Reversión:** descartar la base local y conservar el respaldo cifrado. **NO SEGUIR SI:** el dump/restore falla, el respaldo no es legible, la guardia no confirma host local y base `champions_test`, o aparece una alerta de datos.

3. **manual — cotejar las 28 migraciones de producción.** Consultar con la conexión directa:
   ```sh
   psql "$DATABASE_URL_UNPOOLED" -X -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS applied FROM drizzle.__drizzle_migrations'
   psql "$DATABASE_URL_UNPOOLED" -X -v ON_ERROR_STOP=1 -c 'SELECT created_at, hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1'
   ```
   **Esperado:** 28 filas; la fila 28 tiene `created_at=1792046402706` y `hash=4d508cf9c2e6acbe5ac2860cdc8b60b4c7ceee927a675b114727baa49966c96a` (0037). Esta rama conserva 0037 intacta; no se añadió una 0048 porque el overload con UUID ya fue retirado en 0040 y no existe en la base comprobada. **Reversión:** ninguna, todavía no se cambió producción. **NO SEGUIR SI:** no coinciden el conteo, timestamp o hash.

4. **manual — aplicar y verificar migraciones.** Desde la copia limpia del tag final:
   ```sh
   cd "$RC_DIR"
   env -u DATABASE_URL DATABASE_URL_UNPOOLED="$DATABASE_URL_UNPOOLED" npm run db:migrate
   env -u DATABASE_URL DATABASE_URL_UNPOOLED="$DATABASE_URL_UNPOOLED" npm run db:verify
   psql "$DATABASE_URL_UNPOOLED" -X -At -c 'SELECT count(*) FROM drizzle.__drizzle_migrations'
   ```
   **Esperado:** 0038–0047 se aplican en orden y quedan **38** filas; `db:verify` confirma todos los hashes. **Reversión:** no ejecutar migraciones inversas; mantener Champions apagado y volver al despliegue previo si fuera necesario. **NO SEGUIR SI:** alguna migración se omite, falla o el conteo/hash final difiere.

5. **manual — revisar permisos.** Ejecutar desde la copia limpia:
   ```sh
   psql "$DATABASE_URL_UNPOOLED" -X -v ON_ERROR_STOP=1 -f "$RC_DIR/sources/champions/permisos-check.sql"
   ```
   **Esperado:** funciones de aplicación sin EXECUTE para PUBLIC/anon/authenticated; funciones de extensiones salen clasificadas como `extension`, con extensión y propietario, y son informativas. Si falla una función no deportiva, no revocar nada: detenerse y consultar al responsable antes de actuar. **Reversión:** ninguna; no modificar ACLs manualmente durante la publicación. **NO SEGUIR SI:** aparece una función de aplicación con permiso, o una función ajena a Deportes está señalada; detenerse y consultar.

6. **manual — desplegar el tag final apagado para la familia.** En Vercel, mantener `SPORTS_CHAMPIONS_ENABLED=true` en Production; comprobar que el switch persistido de la familia objetivo sigue apagado. Desde `$RC_DIR`, vincular al proyecto correcto y desplegar Production desde el tag limpio:
   ```sh
   cd "$RC_DIR"
   test -z "$(git status --porcelain)"
   test "$(git describe --tags --exact-match)" = champions-fase-1-rc5
   vercel link --yes --scope team_2UTQTPZVu8pM5PQfUR3qQAvy --project prj_SYvr9uLiDCRbuOLyZjNLVaVKn9bO
   vercel deploy --prod --yes --scope team_2UTQTPZVu8pM5PQfUR3qQAvy --project prj_SYvr9uLiDCRbuOLyZjNLVaVKn9bO
   ```
   **Esperado:** el nuevo deployment usa el commit/tag final, con `SPORTS_CHAMPIONS_ENABLED=true`, pero Champions sigue oculto por el switch familiar `false`. Conservar el deployment anterior `dpl_FbQmLAJYdz8vSq4oiNU9UWuWpocY`; no borrarlo, sirve como rollback de código. **Reversión:** re-aliasar/revertir al deployment anterior; no revertir migraciones. **NO SEGUIR SI:** el árbol deja de estar limpio, el tag no es exacto, el proyecto Vercel no coincide, el switch familiar está encendido o el deployment previo no está disponible.

7. **manual — humo con el switch apagado.** En el dominio de producción, comprobar River y UFC y abrir la sección Deportes como miembro de la familia objetivo. **Esperado:** River/UFC operan como antes y Champions no aparece. **Reversión:** volver al deployment anterior y conservar el switch apagado. **NO SEGUIR SI:** River/UFC cambian o Champions aparece con el switch familiar apagado.

8. **manual — encender para cargar y verificar la Jornada 3.** Cuando nadie use la familia, iniciar sesión como su administrador y encender solo el switch familiar. Desde el dominio de producción, validar la vista previa del archivo de agenda y su `checkedAt` actualizado con la hora real de revalidación UEFA; confirmar la importación solo si hay 18 partidos, 36 equipos y cero errores. Verificar horarios argentinos 13:45/16:00, IDs UEFA, vista e hilo; repetir la confirmación del mismo archivo y comprobar que no cambia nada.
   **Esperado:** importación HTTP 200, 18 partidos, 36 equipos, 0 errores, segunda confirmación idempotente y Jornada 3 correcta. **Reversión:** si no se confirmó, descartar la vista previa; si se confirmó, apagar el switch y conservar filas para corrección auditada. **NO SEGUIR SI:** el `checkedAt` no es real, hay diferencias de fuentes/datos, errores o no se verifica la segunda confirmación.

9. **manual — privacidad, limpieza y prueba de apagado.** Con el switch encendido, usar dos cuentas reales de la familia: la primera guarda un pronóstico de prueba y la segunda, con rol de administrador, comprueba que no lo ve antes del cierre. Borrar el pronóstico de prueba. Probar apagar el switch y comprobar bloqueo de lecturas/escrituras Champions y continuidad de River/UFC; con aprobación explícita del operador, volver a encenderlo.
   **Esperado:** el administrador no ve la elección ajena; la elección de prueba queda eliminada; apagado bloquea Champions y preserva los datos; reencendido vuelve a habilitarlo. **Reversión:** si privacidad/apagado falla, dejar apagado y volver al deployment previo. **NO SEGUIR SI:** hay fuga, no se pudo borrar la elección, el apagado no bloquea o no se aprobó el reencendido.

10. **manual — registro y apertura.** Registrar hora argentina, operador, URL/ID del deployment, resultado de cada prueba y aprobación para la familia. Confirmar en producción que Jornada 3 y el hilo se ven con el switch encendido.
   **Esperado:** evidencia completa y pantalla de Jornada 3/hilo disponibles antes del **20/10/2026 13:45 (Argentina)**. **Reversión:** apagar el switch familiar; los datos quedan preservados. **NO SEGUIR SI:** falta evidencia/aprobación, Jornada 3 o el hilo no aparecen, o ya pasó la hora límite; mantener apagado y mover el estreno a Jornada 4.

## Variables

`db:migrate` y `db:verify` leen `DATABASE_URL_UNPOOLED` (ver `drizzle.config.ts` y `scripts/check-migrations.mjs`); la aplicación lee `DATABASE_URL`. Los comandos previos de respaldo y migración usan la conexión directa de producción. No imprimir, registrar ni guardar la URL en el repositorio.
