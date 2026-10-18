# Publicación directa — `champions-fase-1-rc6`

Runbook manual para una sola ejecución. No imprimir la URL de Neon ni pegarla en capturas, chats, historial de terminal o logs. La URL directa de Neon es la que **no** tiene `-pooler` en el host. La fecha límite para abrir el prode es **20/10/2026 13:45 (Argentina)**; si falta alguna comprobación, mantener Champions apagado y mover el estreno a Jornada 4.

## Bloqueo operativo detectado el 18/10/2026

El ensayo con un respaldo real aplicó las diez migraciones y conservó los hashes de los datos protegidos, pero `permisos-check.sql` rechazó una función preexistente: `public.show_db_tree()` permite EXECUTE a PUBLIC. Se confirmó también en producción mediante consulta de solo lectura. Es una función de inspección de catálogos, SECURITY INVOKER, sin referencias en el código de la aplicación. No pertenece a una extensión y no se debe ocultar su resultado agregando una excepción al verificador.

Antes de publicar, el responsable de la base debe decidir si esa función se conserva con ejecución restringida al rol operacional o se retira. La propuesta mínima a revisar es `REVOKE EXECUTE ON FUNCTION public.show_db_tree() FROM PUBLIC;` y volver a ejecutar el chequeo de permisos. **No se aplicó ese cambio en producción.** El ensayo completo sigue bloqueado hasta resolverlo.

## Variables

Preparar una terminal privada. Reemplazar las rutas solo si hace falta; mantener el dump fuera del repositorio. La URL de base se pide sin mostrarla:

```bash
export RC_DIR="$HOME/src/family-utils-champions-rc6"
export BACKUP_FILE="${TMPDIR:-/tmp}/family-utils-production.dump"
export RESTORE_LOG="${TMPDIR:-/tmp}/family-utils-restore.log"
export IMPORT_FILE="${TMPDIR:-/tmp}/family-utils-champions-agenda.json"
umask 077
export CHAMPIONS_TEST_URL="postgres://postgres:test@127.0.0.1:55440/champions_test"
read -rsp 'Pegá la URL directa de Neon (host sin -pooler): ' DATABASE_URL_UNPOOLED
printf '\n'
export DATABASE_URL_UNPOOLED
```

`DATABASE_URL_UNPOOLED` es la conexión directa de producción. No la imprimas ni la guardes en el repositorio. `SERVER_VERSION`, `SERVER_MAJOR` y `CHECKED_AT` se definen en los pasos que los usan.

## Pasos manuales

1. **manual — clonar el tag y preparar herramientas.**
   ```bash
   git clone --branch champions-fase-1-rc6 --single-branch https://github.com/RadikeCosa/family-utils.git "$RC_DIR"
   test -z "$(git -C "$RC_DIR" status --porcelain)"
   test "$(git -C "$RC_DIR" describe --tags --exact-match)" = champions-fase-1-rc6
   (cd "$RC_DIR" && ./scripts/preflight-publicacion.sh)
   cd "$RC_DIR"
   npm ci
   ```
   **Esperado:** copia limpia en el tag rc6, preflight aprobado y dependencias instaladas. **Reversión:** borrar solo `$RC_DIR`. **NO SEGUIR SI:** el tag no es exacto, el preflight falla o `npm ci` no termina correctamente.

2. **manual — respaldar, restaurar y ensayar en local.** Consultar la versión del servidor; usar en Docker la versión mayor correspondiente a `SHOW server_version` (la auditoría del 18/10 verificó PostgreSQL 18.6 en producción). Como camino principal, el contenedor ejecuta `pg_dump` sin imprimir la URL. Alternativamente usar `pg_dump` local solo si su versión es igual o mayor que la del servidor.
   ```bash
   SERVER_VERSION="$(psql "$DATABASE_URL_UNPOOLED" -X -A -t -v ON_ERROR_STOP=1 -c 'SHOW server_version')"
   SERVER_MAJOR="${SERVER_VERSION%%.*}"
   docker run --rm -e DATABASE_URL_UNPOOLED "postgres:${SERVER_MAJOR}" \
     sh -c 'pg_dump --format=custom "$DATABASE_URL_UNPOOLED"' > "$BACKUP_FILE"
   docker run --rm -i "postgres:${SERVER_MAJOR}" pg_restore --list < "$BACKUP_FILE" > "${BACKUP_FILE}.list"
   head "${BACKUP_FILE}.list"
   # Alternativa local: pg_dump debe ser de versión igual o mayor que SERVER_VERSION.
   pg_dump --version
   # Si la versión local es compatible, usar esta línea en lugar del docker run de pg_dump:
   # pg_dump --format=custom --file="$BACKUP_FILE" "$DATABASE_URL_UNPOOLED"
   ```
   Restaurar ese respaldo en la base local descartable:
   ```bash
   RESTORE_STATUS=0
   docker run --rm -i --network host -e CHAMPIONS_TEST_URL "postgres:${SERVER_MAJOR}" \
     sh -c 'pg_restore --clean --if-exists --no-owner --no-acl --dbname="$CHAMPIONS_TEST_URL"' \
     < "$BACKUP_FILE" >"$RESTORE_LOG" 2>&1 || RESTORE_STATUS=$?
   cat "$RESTORE_LOG"
   psql "$CHAMPIONS_TEST_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
   SELECT format('SELECT %L AS tabla, count(*) AS filas FROM %I.%I;', schemaname, tablename)
   FROM pg_catalog.pg_tables
   WHERE schemaname='public' AND tablename LIKE 'sports\_%' ESCAPE '\'
   ORDER BY tablename
   \gexec
   SQL
   ```
   Neon puede incluir extensiones o roles propios que generen errores al restaurar. Se pueden aceptar solo si se revisa y conserva el log, el resto de la restauración está disponible y las tablas `public.sports_*` con datos se restauraron. No ignorar errores sin revisar filas por tabla. Ejecutar el ensayo sobre la copia local:
   ```bash
   CHAMPIONS_RESTORE_DATABASE_URL="$CHAMPIONS_TEST_URL" "$RC_DIR/sources/champions/ensayo-restauracion.sh"
   ```
   **Esperado:** dump legible; restauración local revisada; conteos por tabla visibles; ensayo con guardia local aprobado y sin alertas en datos protegidos. **Reversión:** descartar la base local y conservar el respaldo protegido. **NO SEGUIR SI:** el dump no se puede listar, la base destino no es local `champions_test`, hay errores de restauración no explicados o aparecen cambios inesperados en las tablas protegidas.

3. **manual — cotejar el historial productivo y comparar UFC antes de migrar.** Antes de cualquier escritura, comprobar el prefijo completo de las 28 migraciones contra el código del candidato:
   ```bash
   node --input-type=module <<'NODE'
   import { readFileSync } from 'node:fs';
   import { createHash } from 'node:crypto';
   import pg from 'pg';
   const entries = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
   const expected = entries.slice(0, 28).map(entry => ({
     timestamp: String(entry.when),
     hash: createHash('sha256').update(readFileSync(`drizzle/${entry.tag}.sql`)).digest('hex'),
   }));
   const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
   try {
     await client.connect();
     await client.query('BEGIN READ ONLY');
     const { rows } = await client.query('SELECT created_at::text AS timestamp, hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id');
     if (JSON.stringify(rows) !== JSON.stringify(expected)) throw new Error('El historial productivo no coincide con el prefijo esperado de 28 migraciones; detener publicación.');
     await client.query('ROLLBACK');
     console.log('OK: 28 migraciones con timestamps y hashes originales, incluida 0037.');
   } finally { await client.end(); }
   NODE
   ```
   **NO SEGUIR SI:** falta una fila o difiere cualquier timestamp/hash. La última fila debe ser `created_at=1792046402706`, `hash=4d508cf9c2e6acbe5ac2860cdc8b60b4c7ceee927a675b114727baa49966c96a`.

   **Comparación UFC.** Ejecutar esta consulta en el editor SQL de Neon y guardar los cuatro resultados. En la app de producción, anotar para una cartelera resuelta los puntos de los participantes y, para la próxima cartelera, el estado de cierre mostrado.
   ```sql
   SELECT 'predicciones' AS tabla, count(*) FROM sports_predictions
   UNION ALL SELECT 'resultados', count(*) FROM sports_fight_results
   UNION ALL SELECT 'peleas', count(*) FROM sports_fights
   UNION ALL SELECT 'eventos', count(*) FROM sports_events;
   ```
   **Esperado:** quedan registrados los cuatro conteos, los puntos UFC (1 por acierto) y el cierre de la próxima cartelera para compararlos después del despliegue. **Reversión:** ninguna; es lectura. **NO SEGUIR SI:** no se pudo registrar la referencia previa o ya se observa una diferencia inexplicada.

4. **manual — aplicar migraciones sin pausa larga.** Los pasos 4, 5 y 6 deben ejecutarse seguidos, en la misma ventana de trabajo. El esquema agregado de Champions es compatible durante ese intervalo: Champions seguirá apagado por familia y las migraciones no cambian la puntuación UFC ni los datos históricos protegidos.
   ```bash
   cd "$RC_DIR"
   env -u DATABASE_URL DATABASE_URL_UNPOOLED="$DATABASE_URL_UNPOOLED" npm run db:migrate
   env -u DATABASE_URL DATABASE_URL_UNPOOLED="$DATABASE_URL_UNPOOLED" npm run db:verify
   psql "$DATABASE_URL_UNPOOLED" -X -A -t -v ON_ERROR_STOP=1 -c 'SELECT count(*) FROM drizzle.__drizzle_migrations'
   ```
   Volver a ejecutar la consulta UFC del paso 3 en el editor SQL de Neon y comparar los cuatro conteos con el registro previo. En la app, volver a mirar puntos de la misma cartelera resuelta y el estado de cierre de la próxima cartelera.
   **Esperado:** 0038–0047 aplicadas; 38 migraciones; hashes verificados; cuatro conteos, puntos y cierre UFC iguales a la referencia. **Reversión:** no revertir migraciones; mantener el switch apagado y hacer rollback de código si hace falta. **NO SEGUIR SI:** falla `db:verify`, no quedan 38 filas o cualquiera de los cuatro conteos, los puntos UFC o el cierre difiere.

5. **manual — comprobar permisos inmediatamente después de migrar.** Ejecutar el chequeo y continuar directamente al despliegue del paso 6 si pasa.
   ```bash
   psql "$DATABASE_URL_UNPOOLED" -X -v ON_ERROR_STOP=1 -f "$RC_DIR/sources/champions/permisos-check.sql"
   ```
   **Esperado:** funciones propias sin ejecución para PUBLIC/anon/authenticated; extensiones clasificadas aparte. **Reversión:** ninguna, el chequeo es de solo lectura. **NO SEGUIR SI:** falla una función de Deportes o aparece señalada una función ajena a Deportes; parar y consultar, sin hacer REVOKE manual sobre esa función.

6. **manual — preparar Vercel y desplegar rc6 apagado por familia.** La variable `SPORTS_CHAMPIONS_ENABLED=true` no está hoy configurada en Production: crearla antes del despliegue desde el proyecto ya vinculado. Usar `vercel env add` y responder `true` cuando el CLI solicite el valor, o crear la misma variable desde la consola de Vercel. No cambiar las otras banderas de Deportes. Tras `vercel link`, confirmar que `.vercel/project.json` tiene el `orgId` y `projectId` esperados; `.vercel/` está ignorado por Git. No se pasa `--project` a `vercel deploy`; el CLI local de esta revisión no está instalado, por lo que no se pudo comprobar su `--help`.
   ```bash
   cd "$RC_DIR"
   vercel link --yes --scope team_2UTQTPZVu8pM5PQfUR3qQAvy --project prj_SYvr9uLiDCRbuOLyZjNLVaVKn9bO
   cat .vercel/project.json
   vercel env add SPORTS_CHAMPIONS_ENABLED production
   test -z "$(git status --porcelain)"
   test "$(git describe --tags --exact-match)" = champions-fase-1-rc6
   vercel deploy --prod --yes --scope team_2UTQTPZVu8pM5PQfUR3qQAvy
   ```
   Confirmar que el switch persistido de la familia sigue apagado. Conservar el deployment anterior `dpl_FbQmLAJYdz8vSq4oiNU9UWuWpocY`; no borrarlo, es el rollback de código. **Esperado:** proyecto Vercel correcto, rc6 desplegado con la variable de entorno activa y Champions todavía apagado para la familia. **Reversión:** en Vercel, promover el deployment anterior `dpl_FbQmLAJYdz8vSq4oiNU9UWuWpocY`; las migraciones no se revierten. **NO SEGUIR SI:** el proyecto vinculado no coincide, la variable no figura en Production, el switch familiar está encendido, el tag/árbol no es el esperado o el deployment anterior no está disponible.

7. **manual — humo con variable verdadera y switch familiar apagado.** En `/deportes`, revisar River y UFC con una cuenta administradora y una de integrante. Para confirmar el estado en Vercel, revisar la variable de Production sin mostrar su valor en capturas.
   **Esperado:** ambos roles ven River/UFC como antes; ningún integrante ve la pestaña ni la agenda Champions; el administrador ve el control de Champions apagado, pero no la pestaña ni la agenda. **Reversión:** promover el deployment anterior y mantener apagado el switch familiar. **NO SEGUIR SI:** River/UFC cambia, un integrante ve Champions o el control informa que la familia está encendida.

8. **manual — revalidar UEFA, preparar el archivo y validar la vista previa.** En la mañana del 19/10 (o el día de publicación si es posterior), comparar los 18 partidos del archivo `sources/champions/2026-27-jornada-3-agenda.borrador.json` con el calendario UEFA: equipo local, visitante, día y horario argentino de cada fila. Confirmar los 18 pares local/visitante y las horas Argentina 13:45 o 16:00. Solo después de esa revisión, consignar la hora UTC real en `checkedAt`:
   ```bash
   CHECKED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
   cp "$RC_DIR/sources/champions/2026-27-jornada-3-agenda.borrador.json" "$IMPORT_FILE"
   node --input-type=module - "$IMPORT_FILE" "$CHECKED_AT" <<'NODE'
   import { readFile, writeFile } from 'node:fs/promises';
   const file = process.argv[2];
   const checkedAt = process.argv[3];
   const data = JSON.parse(await readFile(file, 'utf8'));
   data.checkedAt = checkedAt;
   data.preparation.checkedAtConvention = `Revalidado el ${checkedAt}; hora real UTC de revisión UEFA.`;
   data.preparation.checkedAtProvisional = false;
   data.preparation.independentVerificationInThisRun = true;
   await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
   console.log(`checkedAt actualizado: ${checkedAt}`);
   NODE
   ```
   La copia revalidada queda en `$IMPORT_FILE`, fuera del repositorio; el árbol del tag permanece limpio. Cuando nadie esté usando la familia, encender el switch familiar desde su control. En la pantalla `/deportes?sport=champions&round=<UUID-DE-JORNADA-3>`, abrir **Administrar Champions → Importar agenda de una jornada**, elegir `$IMPORT_FILE`, pulsar **Validar agenda Champions** y revisar la sección **Vista previa · todavía no se guardó**. Confirmar la importación únicamente si la vista previa informa 18 partidos, 36 equipos, cero errores, horarios y equipos correctos.
   **Esperado:** fecha de revalidación real, 18 partidos cotejados, vista previa sin errores y luego importación correcta. **Reversión:** antes de confirmar, cerrar/descartar la vista previa y dejar apagado el switch; después de confirmar, apagar el switch y conservar los registros para corrección auditada. **NO SEGUIR SI:** no se revisó UEFA, el `checkedAt` no es la hora real, cualquier pareja/fecha/hora difiere o la vista previa no da 18 partidos, 36 equipos y cero errores.

9. **manual — privacidad, apagado y reencendido aprobado.** Usar dos cuentas reales de la misma familia: una de integrante y otra administradora. Con el integrante, guardar un pronóstico en un partido del 20/10. En la sesión administradora, abrir DevTools → Network y consultar la agenda `GET /api/sports/champions?round=<UUID-DE-JORNADA-3>`; en la respuesta, ubicar ese partido en `matches` y comprobar `prediction.choices` igual a `[]` y `prediction.ownChoice` igual a `null`. También se puede consultar el endpoint individual `GET /api/sports/champions/events/<EVENT-ID>/predictions` (parámetro de ruta `eventId`; sin query string): devuelve `{eventId, closesAt, closed, canPredict, ownChoice, choices}`. No compartir ni copiar tokens de sesión. Después, con el integrante, borrar el pronóstico desde la interfaz y confirmar que dejó de aparecer como elección propia.
   Cuando nadie use la familia, apagar el switch desde el control `Champions: encendido`; confirmar que la agenda se oculta y que sus endpoints quedan bloqueados. Solo volver a encenderlo con aprobación explícita del operador responsable.
   **Esperado:** el administrador no ve la elección ajena, el pronóstico de prueba se borra y el apagado bloquea Champions sin borrar datos; reencendido aprobado restaura la vista. **Reversión:** dejar el switch apagado ante cualquier fuga o fallo; para rollback de código, promover el deployment anterior indicado en el paso 6. Las migraciones no se revierten. **NO SEGUIR SI:** aparece una elección ajena, no se puede borrar el pronóstico, apagado no bloquea o falta aprobación para reencender.

10. **manual — verificar, registrar y abrir.** Con la variable de entorno en `true` y el switch familiar encendido por aprobación del operador, confirmar en el dominio de producción que la Jornada 3 y su hilo único son visibles. Registrar hora argentina, operador, deployment y resultados de todas las pruebas. El despliegue rc6, migraciones, permisos e importación deben haberse completado antes del **20/10/2026 13:45 (Argentina)**.
   **Esperado:** evidencia registrada y Jornada 3/hilo visibles antes del corte. **Reversión:** apagar el switch familiar; los datos quedan preservados. Para revertir el código, promover en Vercel `dpl_FbQmLAJYdz8vSq4oiNU9UWuWpocY`; no revertir migraciones. **NO SEGUIR SI:** falta aprobación/evidencia, la jornada o hilo no aparecen, hay una discrepancia UFC/privacidad o pasó la hora límite; dejar apagado y mover el estreno a Jornada 4.

## Cierre de la operación

Tras registrar los resultados y confirmar que ya no hace falta repetir el ensayo, eliminar la copia local de producción y su base temporal. Conservar un respaldo operacional solo en el destino privado aprobado por el operador; no dejar dumps con datos familiares en `/tmp` indefinidamente. Eliminar también `$IMPORT_FILE`, `$RESTORE_LOG` y `${BACKUP_FILE}.list` cuando termine la operación.
