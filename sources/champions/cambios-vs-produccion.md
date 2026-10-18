# Diferencias de esta rama frente a producción

## Referencia y límites de verificación

La última publicación de Vercel con vínculo Git que pude identificar apunta a `main` en `884c3134ff450cb7f1edd68576caf254f6c94f91` (`Document sports production rollout and recovery procedure (#41)`). La implementación actual de producción también muestra una publicación desde CLI sin SHA ni rama en sus metadatos; por eso no se puede afirmar que ese `main` sea el código actualmente activo. La rama fuente activa de producción queda **no verificada**. La base de producción no se consultó.

**no verificado: main no contiene 0037 y no se consultó la base de producción**. Por lo tanto, tampoco se verificó en producción el cierre único UFC ni los puntajes UFC 5/3/1. En el `main` identificado arriba no está el archivo de migración `0037_ufc_card_closure.sql` ni su entrada de journal: no está en esa revisión Git.

El cierre UFC de evento único lo implementa 0037 mediante `sports_events.ufc_prediction_closes_at`, `ufc_prediction_closed_at` y `ufc_prediction_transition_at`, además de los guardas de votos/peleas. Si está activo en producción, proviene de esa migración o de una aplicación equivalente; la identidad exacta del SQL desplegado no se verificó directamente.

## Archivos no específicos de Champions que cambian en este release

La comparación de rutas usa `main` (`884c313…`) como último origen Git vinculado a una publicación; la tabla no afirma que sea la versión actualmente activa en producción. Los archivos de pruebas, configuración y documentación no alteran directamente datos ni pantallas de usuarios.

| Área | Archivo | Efecto para usuarios |
|---|---|---|
| UFC | `drizzle/0037_ufc_card_closure.sql` | UFC congela los pronósticos al cierre único derivado de la primera pelea elegible; preserva cierres y elegibilidad existentes. **no verificado: main no contiene 0037 y no se consultó la base de producción**. |
| Deportes / River | `src/app/deportes/AgendaApp.tsx` | La agenda distingue River y Champions sin cambiar el flujo de River cuando Champions está apagado. |
| Deportes / comentarios | `src/app/deportes/Comments.tsx` | Los comentarios se pueden asociar a una jornada Champions; se conserva el flujo existente de comentarios de Deportes. |
| UFC | `src/app/deportes/UfcPredictions.tsx` | El prode UFC presenta la elegibilidad/cierre de cartelera y conserva las selecciones existentes. |
| Deportes | `src/app/deportes/agenda.module.css` | Agrega estilos de pestañas, jornadas y estados de agenda; puede cambiar el aspecto compartido de Deportes. |
| Deportes | `src/app/deportes/page.tsx` | Carga la agenda multideporte con controles de Champions y respeta el interruptor por familia. |
| Esquema común de deportes | `src/db/schema.ts` | Describe columnas/tablas de Champions y las columnas derivadas del cierre UFC para que la aplicación lea el esquema actualizado. |
| Reglas compartidas | `src/lib/sports/config.ts` | Calcula disponibilidad de Champions usando la bandera de entorno y el switch de familia; no habilita River/UFC. |
| Reglas compartidas | `src/lib/sports/import-rules.ts` | Agrega reglas de importación para agenda/resultados de fútbol y mantiene la ruta legacy de River. |
| Reglas compartidas | `src/lib/sports/import-server.ts` | Mantiene el importador legado de River junto con validaciones e importaciones de fútbol por categoría. |
| Reglas de predicción | `src/lib/sports/prediction-rules.ts` | Aplica la categoría al flujo de fútbol, manteniendo las reglas existentes para el prode River. |
| Servidor de predicciones | `src/lib/sports/predictions-server.ts` | Selecciona predicciones por categoría de fútbol y conserva el endpoint de River. |
| Resultados | `src/lib/sports/results-server.ts` | Mantiene resultados legacy de River y comparte utilidades sin incluir Champions en sus cálculos. |
| Resultados UFC | `src/lib/sports/results-ufc-server.ts` | Lee y presenta el cierre único UFC y elegibilidad de peleas para resultados. |
| Reglas de dominio | `src/lib/sports/rules.ts` | Separa reglas de River/Champions y deja intactos los tipos de evento UFC. |
| Servidor de deportes | `src/lib/sports/server.ts` | Filtra por categoría en lecturas y escrituras de fútbol; mantiene la respuesta legacy de River. |
| Sincronización | `src/lib/sports/sync.ts` | Conserva la sincronización de River y tipa la identidad externa estable de fútbol; no sincroniza UFC como fútbol. |
| Tipos compartidos | `src/lib/sports/types.ts` | Expone la categoría de fútbol y metadatos de agenda sin modificar el contrato de peleas UFC. |
| Pruebas/reglas | `src/lib/sports/config.test.ts` | Comprueba apagado/aislamiento de Champions; es solo prueba. |
| Pruebas/reglas | `src/lib/sports/import-rules.test.ts` | Regresión de importaciones legacy y nuevas validaciones; es solo prueba. |
| Pruebas/reglas | `src/lib/sports/prediction-rules.test.ts` | Regresión de reglas de predicción por categoría; es solo prueba. |
| Pruebas/reglas | `src/lib/sports/rules.test.ts` | Regresión de reglas compartidas River/UFC/Champions; es solo prueba. |
| E2E Deportes | `tests/e2e/sports.spec.ts` | Verifica las pantallas existentes de Deportes y la administración; no cambia comportamiento en ejecución. |
| E2E Deportes | `tests/e2e/sports-next.spec.ts` | Prueba de navegador de la agenda siguiente; no cambia comportamiento en ejecución. |
| Rutas de Deportes | `tests/sports-routes.integration.mjs` | Regresión de endpoints legados y por categoría; no cambia comportamiento en ejecución. |
| UFC | `tests/postgres-ufc-closure.integration.test.mjs` | Valida preservación y cierre UFC definido en 0037; solo prueba. |
| Entorno | `.env.example` | Documenta variables nuevas de disponibilidad; no altera datos. |
| CI | `.github/workflows/ci.yml` | Ejecuta las suites Champions/Deportes; solo afecta validación de cambios. |
| Scripts de pruebas | `package.json` | Registra comandos y suites nuevas; no afecta el flujo del usuario. |
| Configuración Playwright | `playwright.config.ts`, `playwright.a11y.config.ts`, `playwright.sports-next.config.ts`, `playwright.champions.config.ts` | Separa recorridos de navegador; solo afecta las pruebas. |
| Snapshots de migración | `drizzle/meta/0037_snapshot.json`, `drizzle/meta/_journal.json` | Registra el cierre UFC 0037 y su ubicación en el historial local del esquema; no altera datos por sí solo. |

Los demás archivos añadidos bajo `src/app/api/sports/champions/`, `src/app/deportes/Champions*`, `src/lib/sports/champions*`, `src/lib/sports/football-predictions-server.ts`, y las migraciones `0027`–`0036` son específicos de Champions o infraestructura requerida por Champions y por eso no se repiten en la lista de cambios no-Champions.

## Filas afectadas por migraciones 0027–0037

“Solo agrega” incluye nuevas columnas/tablas, restricciones, índices, funciones, triggers y ACL; no significa que la migración sea necesariamente invisible para lecturas. “Puede reescribir filas existentes” identifica migraciones con `UPDATE`/`INSERT` o backfill sobre tablas ya pobladas.

| Migración | Filas/columnas y clasificación |
|---|---|
| 0027 | **Puede reescribir filas existentes.** `sports_events.football_category`: asigna `NULL` a filas `kind='ufc_card'`; las filas River existentes reciben el default `river` por la columna nueva. `sports_football_event_sources(family_id,event_id,provider,external_id)`: copia una fila por evento de fútbol existente con `source_provider` y `external_reference`. **Solo agrega** tablas `sports_football_event_sources`, `sports_football_rounds`, `sports_football_seasons`, `sports_football_team_sources`, `sports_football_teams`; columnas `sports_events.season_id`, `round_id`, `first_team_id`, `second_team_id`, `tie_reference`, `next_round_id`, `next_slot`; constraints, índices, funciones y triggers. |
| 0028 | **Solo agrega.** Tablas `sports_football_predictions(family_id,event_id,member_id,choice,created_at,updated_at)` y `sports_football_closures(family_id,event_id,scheduled_close_at,closed_at)`; reemplaza el CHECK de estado de `sports_events`, sin actualizar filas. |
| 0029 | **Solo agrega/cambia catálogo.** Funciones y ACL; no modifica filas de negocio. |
| 0030 | **Solo agrega/cambia catálogo.** Privilegios por defecto y ACL de funciones; no modifica filas de negocio. |
| 0031 | **Solo agrega/cambia catálogo.** Función de tabla y ACL; no modifica filas. |
| 0032 | **Solo agrega.** Tabla `sports_football_round_comments` con sus columnas de familia/jornada/miembro/contenido/fechas, índices y restricciones; no backfill. |
| 0033 | **Solo agrega con filas nuevas.** Tabla `sports_champions_switches(family_id,enabled,updated_at,updated_by)`; inserta una fila `enabled=false` por familia existente. Trigger para nuevas familias y funciones de lectura/escritura del switch. No modifica filas de familias ni datos previos de Deportes. |
| 0034 | **Solo agrega.** Tabla `sports_football_resolutions` (resultado oficial o anulación, motivo/fuente/auditoría); función; sin backfill ni cambios a eventos existentes. |
| 0035 | **Solo agrega.** Tabla `sports_football_result_corrections` con marcador anterior/nuevo, fuente, instante, actor; sin backfill ni cambios a resultados existentes. |
| 0036 | **Solo agrega/cambia catálogo.** Defaults y revocaciones de privilegios sobre funciones/tablas deportivas; no modifica filas de negocio. |
| 0037 | **Puede reescribir filas existentes.** `sports_events.ufc_prediction_closes_at`, `ufc_prediction_closed_at`, `ufc_prediction_transition_at`: actualiza todos los eventos `kind='ufc_card'` para derivar cierre/transición y preservar cierres previos. `sports_fights.prode_eligible`: agrega columna `NOT NULL DEFAULT true`, que queda `true` para filas existentes. No actualiza `sports_predictions`, `sports_fight_results` ni `sports_block_closures`. Funciones, triggers y ACL son cambios de catálogo. |

El SQL en el checkout permite comprobar los efectos descritos. No se obtuvieron recuentos de filas de producción ni tiempos de bloqueo, y no se consultaron valores de tablas de producción.
