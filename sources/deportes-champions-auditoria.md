# Auditoría Champions — Fase 1

Orden consolidado por bloques 1–8. Los cierres intermedios se conservan como registros históricos, con sus estados aclarados; el estado vigente aparece en el cierre final.

## Bloque 1 — Datos y regresión (completo)

Sin acceso a producción. Migraciones y pruebas únicamente sobre PostgreSQL local aislado.

Búsqueda sistemática: `rg -n 'football_match|isRiverMatch|sports_events|sportsEvents' src/lib/sports src/app/deportes src/app/api/sports`.

| Área | Coincidencias | Resolución |
| --- | --- | --- |
| Lecturas y selección | `server.ts` loadSportsData; `rules.ts` selectRiverEvent; `AgendaApp.tsx` filtrado football_match | Excluir Champions en consulta base y selección River. |
| Edición y formaciones | `server.ts` mutateSportsEvent, mutateFormation | Rechazar Champions en rutas legadas. |
| Importador | `import-server.ts` findExisting, cobertura, upsert; `import-rules.ts` fútbol implica River | Acotar búsquedas y cobertura a clasificación River; rechazar referencia coincidente Champions. |
| Resultados | `results-server.ts` inspect y plantilla | Aceptar exclusivamente fútbol River. |
| Plantillas | `templates.ts`, `results-server.ts` | Agenda ficticia sigue River; filtrar plantilla real de resultados. |
| Comentarios | `server.ts` lectura/escritura river_match y edición de comentarios | Validar clasificación del evento; no habilitar contextos Champions en este bloque. |
| Sincronización legada | `sync.ts` upsertRiver y ausencias | Acotar escrituras y búsquedas a River aunque automatización esté deshabilitada. |

## Decisiones de modelo

- Identidades de temporada, jornada y equipos por familia; claves foráneas compuestas impiden referencias cruzadas y jornadas de otra temporada.
- Champions exige temporada, jornada y dos equipos distintos con ID estable. River conserva nombres y IDs existentes; sus nuevas referencias son opcionales para no reescribir historia ni adivinar equipos por alias.
- La ventana original de jornada se guarda separada de los horarios de partidos.
- Referencias reservadas: `tie_reference`, `next_round_id`, `next_slot`, sin lógica de eliminatorias.
- **Excepción de compatibilidad:** default `river` para fútbol; el trigger `sports_normalize_football_category` normaliza exclusivamente inserts UFC a NULL porque los importadores antiguos omiten esa columna. No cambia River ni Champions, ni actualiza otros eventos; se prueba explícitamente.
- Referencias externas por proveedor de equipos y partidos; backfill de referencias de partidos existentes. Otro trigger mantiene actualizado el mapa cuando cambia la referencia legada. No se inventan IDs de proveedores para equipos históricos.
- Los accesos legados excluyen Champions independientemente de las banderas del futuro bloque 6. El selector puro tolera fixtures históricos sin categoría y excluye Champions explícito.
- Colisión exacta de referencia de Champions con una importación River: conflicto y rollback de la categoría River; no se altera Champions.
- Las pruebas de borrado verifican SQLSTATE 23503 y restricción concreta, sin depender de la redacción de PostgreSQL.
- Copia temporal de WebKit en `/tmp/champions-browsers` y dependencias extraídas en `/tmp/champions-webkit-deps`; no se instalaron paquetes del sistema.

## Verificación

- Tipos y lint: aprobados.
- Historial de migraciones: 28 entradas ordenadas; hash aplicado comprobado en ensayo de upgrade y segunda aplicación sin cambios.
- `npm test`: 92 pruebas aprobadas, cero omisiones; incluye conservación de partidos, peleas, elecciones UFC, comentarios y formaciones al pasar de 0026 a 0027.
- `npm run build`: aprobado con conexión dirigida a la base local aislada.
- `npm run test:routes`: 59 pruebas aprobadas, cero omisiones; 7 corresponden a Deportes incluyendo su suite contenedora.
- Recorridos legados `tests/e2e/sports.spec.ts`: 6 aprobados, cero omisiones.
- `npm run test:sports-next`: 12 recorridos aprobados, cero omisiones, en iPhone/Android/Chromium escritorio/WebKit. Todos incluyen un evento Champions cuyo participante se llama River Plate.
- Cobertura específica: Champions no aparece en página/API ni plantilla de resultados; edición, formación, comentario y resultado por rutas River rechazados; importaciones y cobertura River no lo modifican; colisiones de referencia rechazadas; aislamiento por familia y temporada verificado.
- Contenedor exclusivo `family-champions-block1`, PostgreSQL 17, puerto local 55439. Sin copia de datos reales, acceso a producción ni migraciones en otras bases.

## Coincidencias individuales revisadas

Búsqueda ampliada a todo `src`, excluyendo pruebas y el esquema (cubierto por la migración). Cada fila registra una coincidencia del comando `rg -n 'football_match|isRiverMatch|sportsEvents|sports_events' src --glob '!**/*.test.ts' --glob '!src/db/schema.ts'`. Extractos abreviados; ubicación correspondiente a este bloque.

| Ubicación | Extracto | Resolución |
| --- | --- | --- |
| `src/lib/sports/results-server.ts:63` | `"SELECT id,title,kind,football_category,status,updated_at FROM sports_events WHERE id=$1 AND family_` | Inspección valida River; plantilla solo River y UFC habilitada; escritura sobre evento ya validado. |
| `src/lib/sports/results-server.ts:66` | `if (!event \|\| event.kind !== "football_match" \|\| event.football_category !== "river")` | Inspección valida River; plantilla solo River y UFC habilitada; escritura sobre evento ya validado. |
| `src/lib/sports/results-server.ts:165` | `"UPDATE sports_events SET status='completed',result=$3,updated_at=now() WHERE id=$1 AND family_id=$2` | Inspección valida River; plantilla solo River y UFC habilitada; escritura sobre evento ya validado. |
| `src/lib/sports/results-server.ts:231` | `"SELECT id,title,event_date,kind FROM sports_events WHERE family_id=$1 AND ((kind='football_match' A` | Inspección valida River; plantilla solo River y UFC habilitada; escritura sobre evento ya validado. |
| `src/lib/sports/results-server.ts:240` | `event.kind === "football_match"` | Inspección valida River; plantilla solo River y UFC habilitada; escritura sobre evento ya validado. |
| `src/app/deportes/AgendaApp.tsx:6` | `import { sportsNowDay, isRiverMatch } from "@/lib/sports/rules";` | Sin cambios: recibe solo River/UFC de la consulta base y no consulta la base directamente. |
| `src/app/deportes/AgendaApp.tsx:60` | `event.kind === (sport === "river" ? "football_match" : "ufc_card") &&` | Sin cambios: recibe solo River/UFC de la consulta base y no consulta la base directamente. |
| `src/app/deportes/AgendaApp.tsx:62` | `isRiverMatch(event.firstParticipant, event.secondParticipant)) &&` | Sin cambios: recibe solo River/UFC de la consulta base y no consulta la base directamente. |
| `src/lib/sports/import-server.ts:56` | `if (item.kind !== "football_match") return false;` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:92` | `"SELECT *,event_date::text AS event_date FROM sports_events WHERE family_id=$1 AND kind=$2 AND sourc` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:99` | `"SELECT *,event_date::text AS event_date FROM sports_events WHERE family_id=$1 AND kind=$2 AND (kind` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:103` | `if (item.kind === "football_match")` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:143` | `if (item.kind === "football_match") {` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:185` | `"INSERT INTO sports_events(family_id,kind,title,competition,first_participant,second_participant,eve` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:223` | `"UPDATE sports_events SET title=$1,competition=$2,first_participant=$3,second_participant=$4,event_d` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:315` | `"INSERT INTO sports_events(family_id,kind,title,event_date,early_preliminaries_starts_at,preliminary` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:351` | `"UPDATE sports_events SET title=$1,event_date=$2,early_preliminaries_starts_at=$3,preliminary_starts` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:381` | `UPDATE sports_events SET ${columns[field]}=$1 WHERE id=$2 AND family_id=$3,` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:514` | `"SELECT e.id FROM sports_events e WHERE e.family_id=$1 AND e.kind=$2 AND e.source_provider='ufc_offi` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:532` | `"UPDATE sports_events SET source_absent_at=now(),updated_at=now() WHERE family_id=$1 AND kind=$2 AND` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:585` | `const riverItems = parsed.bundle.events.filter(event => event.kind === "football_match");` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/import-server.ts:587` | `const river = await importCategory(actor, riverItems, parsed.bundle, "football_match", parsed.bundle` | Referencia exacta Champions rechazada; equivalencias/cobertura filtran River; nuevos partidos siguen default River. |
| `src/lib/sports/results-ufc-server.ts:36` | `"SELECT * FROM sports_events WHERE id=$1 AND family_id=$2 AND kind='ufc_card' FOR UPDATE",` | Sin cambios: la entrada SQL exige ufc_card, por lo que un partido Champions no puede alcanzar estas escrituras. |
| `src/lib/sports/results-ufc-server.ts:169` | `"UPDATE sports_events SET card_status=$3,status=$4,updated_at=now() WHERE id=$1 AND family_id=$2",` | Sin cambios: la entrada SQL exige ufc_card, por lo que un partido Champions no puede alcanzar estas escrituras. |
| `src/lib/sports/predictions-server.ts:207` | `SELECT * FROM sports_events WHERE id=$1 AND family_id=$2 AND kind='ufc_card' AND hidden=false ${requ` | Sin cambios: la entrada SQL exige ufc_card y usa la identidad de esa cartelera para el resto de las operaciones. |
| `src/lib/sports/sync.ts:20` | `return {riverEvents:events.filter(e=>e.kind==="football_match"&&e.football_category==="river"),ufcEv` | Hechos/búsquedas/ausencias filtran River; automatización de proveedores sigue desactivada. |
| `src/lib/sports/sync.ts:24` | `c.query("SELECT * FROM sports_events WHERE family_id=$1 AND hidden=false",[familyId]),` | Hechos/búsquedas/ausencias filtran River; automatización de proveedores sigue desactivada. |
| `src/lib/sports/sync.ts:59` | `const r=await c.query("SELECT * FROM sports_events WHERE family_id=$1 AND kind='football_match' AND ` | Hechos/búsquedas/ausencias filtran River; automatización de proveedores sigue desactivada. |
| `src/lib/sports/sync.ts:64` | `if(existing){const previous=existing.automatic_data??{};const {merged,overrides}=mergeOverrides(prev` | Hechos/búsquedas/ausencias filtran River; automatización de proveedores sigue desactivada. |
| `src/lib/sports/sync.ts:65` | `else await c.query("INSERT INTO sports_events(family_id,kind,title,competition,first_participant,sec` | Hechos/búsquedas/ausencias filtran River; automatización de proveedores sigue desactivada. |
| `src/lib/sports/sync.ts:74` | `try{const result=await fetchRiverSchedule(started+NETWORK_BUDGET_MS);if(Date.now()-started>PROCESSIN` | Hechos/búsquedas/ausencias filtran River; automatización de proveedores sigue desactivada. |
| `src/lib/sports/sync.ts:79` | `try{const networkDeadline=started+NETWORK_BUDGET_MS;const listings=await fetchUfcListing(networkDead` | Hechos/búsquedas/ausencias filtran River; automatización de proveedores sigue desactivada. |
| `src/lib/sports/sync.ts:83` | `const c=await getPool().connect();try{await c.query("BEGIN");await persistenceGuard(c,familyId,"ufc"` | Hechos/búsquedas/ausencias filtran River; automatización de proveedores sigue desactivada. |
| `src/lib/sports/sync.ts:87` | `const all=(await c.query("SELECT * FROM sports_events WHERE family_id=$1 AND kind='ufc_card'",[famil` | Hechos/búsquedas/ausencias filtran River; automatización de proveedores sigue desactivada. |
| `src/lib/sports/sync.ts:91` | `if(existing){const {merged,overrides}=mergeOverrides(existing.automatic_data??{},automatic,existing.` | Hechos/búsquedas/ausencias filtran River; automatización de proveedores sigue desactivada. |
| `src/lib/sports/sync.ts:92` | `else{const {rows:[inserted]}=await c.query("INSERT INTO sports_events(family_id,kind,title,event_dat` | Hechos/búsquedas/ausencias filtran River; automatización de proveedores sigue desactivada. |
| `src/lib/sports/import-rules.ts:9` | `export type CuratedFootballEvent = { kind: "football_match"; sourceProvider: "espn"; externalReferen` | Formato v1 sigue River/UFC; categoría Champions explícita rechazada; conteos solo sobre ese contrato. |
| `src/lib/sports/import-rules.ts:71` | `if (!record(raw) \|\| (raw.kind !== "football_match" && raw.kind !== "ufc_card")) return invalid();` | Formato v1 sigue River/UFC; categoría Champions explícita rechazada; conteos solo sobre ese contrato. |
| `src/lib/sports/import-rules.ts:78` | `if (raw.kind === "football_match") {` | Formato v1 sigue River/UFC; categoría Champions explícita rechazada; conteos solo sobre ese contrato. |
| `src/lib/sports/import-rules.ts:84` | `events.push({ kind: "football_match", sourceProvider: "espn", externalReference, source: raw.source ` | Formato v1 sigue River/UFC; categoría Champions explícita rechazada; conteos solo sobre ese contrato. |
| `src/lib/sports/import-rules.ts:110` | `if (events.some(event => event.kind === "football_match" && event.payload.eventDate !== null && even` | Formato v1 sigue River/UFC; categoría Champions explícita rechazada; conteos solo sobre ese contrato. |
| `src/lib/sports/import-rules.ts:115` | `const river = bundle.events.filter(event => event.kind === "football_match").length;` | Formato v1 sigue River/UFC; categoría Champions explícita rechazada; conteos solo sobre ese contrato. |
| `src/lib/sports/templates.ts:18` | `kind: "football_match",` | Sin cambios: es un ejemplo ficticio River sin consultas a eventos almacenados. |
| `src/lib/sports/server.ts:6` | `import { members, sportsComments, sportsEvents, sportsFights, sportsFormations, sportsWeeks } from "` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:8` | `import { sportsEnabled, sportsNowDay, sportsWeek, selectRiverEvent, selectUfcEvent, formationInput, ` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:69` | `.from(sportsEvents)` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:72` | `eq(sportsEvents.familyId, actor.familyId),` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:73` | `eq(sportsEvents.hidden, false),` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:74` | `or(eq(sportsEvents.kind, "ufc_card"), eq(sportsEvents.footballCategory, "river")),` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:75` | `...(features.agenda ? [] : [isNull(sportsEvents.sourceAbsentAt)]),` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:80` | `isNull(sportsEvents.eventDate),` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:81` | `gte(sportsEvents.eventDate, week.start),` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:120` | `event.kind === "football_match" &&` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:121` | `isRiverMatch(event.firstParticipant, event.secondParticipant),` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:134` | `selected?.kind === "football_match"` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:139` | `events.filter((event) => event.kind === "football_match"),` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:232` | `if (body.kind === "football_match") {` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:236` | `const { rows: [event] } = await tx.query("INSERT INTO sports_events(family_id,kind,title,competition` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:237` | `await tx.query("UPDATE sports_events SET venue=$1 WHERE id=$2 AND family_id=$3", [input.venue, event` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:245` | `const { rows: [event] } = await tx.query("INSERT INTO sports_events(family_id,kind,title,event_date,` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:265` | `const { rows: [current] } = await tx.query("SELECT * FROM sports_events WHERE id=$1 AND family_id=$2` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:270` | `const overrides=(current.manual_overrides??[]).filter((key:string)=>key!==field.key);await tx.query(` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:276` | `const overrides=current.manual_overrides??[];await tx.query("UPDATE sports_events SET manual_fights=` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:279` | `await tx.query("UPDATE sports_events SET hidden=true,manually_edited=true,updated_by_member_id=$1,up` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:299` | `current.kind === "football_match" &&` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:317` | `if (current.kind === "football_match") {` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:321` | `await tx.query("UPDATE sports_events SET title=$1,competition=$2,first_participant=$3,second_partici` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:329` | `await tx.query("UPDATE sports_events SET title=$1,event_date=$2,early_preliminaries_starts_at=$3,pre` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:348` | `const allowed = await getDb().select({ id: sportsEvents.id }).from(sportsEvents).where(and(eq(sports` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:383` | `const { rows:[event] } = await tx.query("SELECT id,first_participant,second_participant FROM sports_` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:385` | `if (contextKind === "river_match" && !isRiverMatch(event.first_participant,event.second_participant)` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:395` | `const { rows: [event] } = await tx.query("SELECT football_category FROM sports_events WHERE id=$1 AN` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:429` | `const { rows: [event] } = await tx.query("SELECT first_participant,second_participant FROM sports_ev` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/server.ts:430` | `if (!event \|\| !isRiverMatch(event.first_participant,event.second_participant)) fail(404,"NOT_FOUND` | Consulta base limita River/UFC; edición, formación y comentarios validan categoría; creación legada queda River. |
| `src/lib/sports/rules.ts:5` | `export const SPORTS_KINDS = ["football_match", "ufc_card"] as const;` | Tipos genéricos se conservan; selector River excluye Champions antes de aplicar nombres. |
| `src/lib/sports/rules.ts:18` | `export function isRiverMatch(first: string \| null \| undefined, second: string \| null \| undefined` | Tipos genéricos se conservan; selector River excluye Champions antes de aplicar nombres. |
| `src/lib/sports/rules.ts:171` | `isRiverMatch(event.firstParticipant, event.secondParticipant) &&` | Tipos genéricos se conservan; selector River excluye Champions antes de aplicar nombres. |
| `src/lib/sports/types.ts:4` | `kind: "football_match" \| "ufc_card";` | Discriminante footballCategory agregado al tipo compartido sin romper fixtures históricos. |

## Coincidencias en pruebas y mantenimiento

- `tests/e2e/sports-next.spec.ts`: selector SQL de River filtrado por categoría; todos los recorridos incluyen Champions. Limpieza de referencias antes de eventos, luego jornadas/temporadas/equipos.
- `tests/sports-routes.integration.mjs`: Champions presente tanto al leer como al importar River; verificadas colisiones y conservación del evento.
- `tests/e2e/sports.spec.ts`: limpieza de referencias externas antes de eventos.
- `tests/postgres-champions-migration.integration.test.mjs`: nueva prueba integrada en `npm test`, base descartable por ejecución; upgrade poblado, idempotencia, hash, defaults y restricciones de identidad.
- `scripts/cleanup-sports-test-data.mjs`: no ejecutado; el orden histórico de limpieza no contempla referencias nuevas y deberá ampliarse antes de usarlo con fixtures posteriores a 0027. No interviene en las suites del bloque.

## Estado al cierre del Bloque 1 (histórico)

En ese corte el Bloque 1 aún no habilitaba pronósticos y faltaban los bloques posteriores. Los bloques 2–8 se completaron luego; el estado de salida vigente está al final de este documento. Se conserva el corte del 19/10/2026 a las 18:00 Argentina y la regla de pasar a Jornada 4 si falta una verificación obligatoria.

## Bloque 2 — Pronósticos, cierre y privacidad (completo)

- Autorizado el bloque 2; sin refactor de otras funciones de Deportes ni implementación de agenda, puntos, tabla o comentarios Champions.
- Se usarán funciones PostgreSQL que validan una sesión Better Auth real, sin confiar en un memberId/familyId elegido por el cliente.
- Pruebas de privacidad con sesión de administrador real y conexión SQL sin SUPERUSER, BYPASSRLS, propiedad de tablas ni SELECT directo de elecciones.
- No aplica RLS de Supabase: esta aplicación usa Better Auth y PostgreSQL mediante pg; se implementa un contrato de funciones SQL con acceso directo revocado.

### Implementación y decisiones del bloque 2

- Migración `0028_sports_football_predictions`: tablas de elecciones/cierres de fútbol independientes de UFC y claves foráneas compuestas por familia. Se amplía exclusivamente para Champions el CHECK de estado con `suspended`; River/UFC siguen rechazándolo.
- Única regla temporal en `sports_football_choice_open`: reloj PostgreSQL estrictamente anterior al inicio confirmado, sin cierre persistido y estado `scheduled`. La función pública nunca recibe una hora del cliente.
- `sports_football_predictions_api` autentica una sesión Better Auth vigente mediante token opaco y vínculo activo a integrante/dispositivo; deriva familia e integrante en SQL. No permite elegir otro sujeto. La sesión no se incorpora a respuestas, auditoría ni logs.
- Contrato SQL con SECURITY DEFINER, búsqueda fijada y helpers privados. Acceso directo a tablas y EXECUTE de helpers revocados a PUBLIC; solo se expone la función de sesión que ya filtra. No se exige crear roles nuevos en la migración; el rol limitado de las pruebas es temporal.
- `sports_football_choice_view` devuelve siempre eventId, closesAt, closed, canPredict, ownChoice y choices. Antes del cierre consulta solo la elección propia y entrega choices=[] incluso a administradores, sin conteos ajenos ni cambios de esquema/ramas según participación ajena. No se promete tiempo constante de red.
- Todas las operaciones se serializan por partido con bloqueo de fila. La escritura final vuelve a evaluar la misma regla con clock_timestamp(), incluso después de esperar otro bloqueo.
- Cierre perezoso en lecturas y escrituras, almacenando el inicio previsto. El trigger de actualización evalúa OLD antes de sustituir horario/estado y también NEW: conserva el cierre aunque no haya habido visitas. Si un estado terminal/suspendido llega antes del horario previsto, cierra al instante de registro de ese estado (o al inicio previsto si ya pasó), evitando elecciones en partidos cancelados/suspendidos.
- Una escritura tardía devuelve conflicto como resultado de la función, sin lanzar una excepción que revierta el cierre recién materializado; la consulta confirma ese cierre. No hay función pública de reapertura.
- Postergación anterior al inicio con horario desconocido: conserva elecciones, bloquea cambios y no materializa cierre. Otro horario confirmado futuro permite cambiarlas si no existía cierre. Postergación posterior al inicio original nunca reabre.
- La identidad de equipo, jornada, temporada, familia y categoría no puede reemplazarse después de una elección o cierre; se rechaza en la base. Evita reinterpretar local/visitante o mover elecciones existentes.
- Auditoría: actor, partido y acción saved/changed/deleted; metadata solo eventId, sin valor de elección. Repetir la misma elección no duplica su auditoría.
- Ruta nueva: GET/PUT/DELETE `/api/sports/champions/events/<uuid>/predictions`; PUT recibe `{choice:"home"|"draw"|"away"}` y no admite memberId/familyId. La aplicación transmite la sesión al contrato SQL, sin leer elecciones ni filtrar privacidad en JavaScript.
- La ruta permanece apagada por defecto y exige Deportes, agenda y SPORTS_CHAMPIONS_ENABLED=true. El interruptor persistido y su coordinación transaccional corresponden al bloque 6; no se habilita todavía Champions para publicación.
- Sin cambios en la interfaz, el importador Champions, resultados/puntos, tabla o hilos: corresponden a bloques posteriores.

### Evidencia de verificación del bloque 2

- `npm run typecheck`, `npm run lint`, `npm run db:check` y `npm run build`: aprobados; 29 migraciones registradas.
- `npm test`: 92 aprobadas, cero omisiones. El ensayo desde 0026 ejecuta 0027/0028 y comprueba que un insert UFC antiguo no altera ninguna columna de los eventos River/Champions existentes. Verifica también que `suspended` siga rechazado para River/UFC.
- `npm run test:routes`: 72 aprobadas, cero omisiones. Incluye 13 de la nueva suite `tests/sports-football-predictions.integration.mjs` (12 escenarios más contenedor).
- Privacidad comprobada con cookie/sesión real de integrante y de un integrante cuyo rol almacenado es administrator; las lecturas SQL usan un LOGIN temporal NOSUPERUSER/NOBYPASSRLS/NOINHERIT, sin propiedad ni SELECT sobre elecciones, cierres, sesiones o auditoría. La conexión privilegiada se limita a fixtures, preparación de permisos/horarios y comprobaciones de almacenamiento; no se usa para demostrar filtrado de elecciones.
- Respuesta SQL y HTTP del administrador idéntica antes/después de que otra persona guarde una elección abierta; elecciones reveladas solo después del cierre; suplantación por body rechazada, familias aisladas y sesiones inexistentes/expiradas/revocadas/archivadas rechazadas en PostgreSQL.
- Predicado SQL verificado un microsegundo antes, en igualdad y un microsegundo después del inicio. Petición HTTP enviada antes del inicio queda esperando un bloqueo real y se rechaza después: no usa el reloj de la petición ni el timestamp inicial de transacción.
- Cierre persistente en lectura y escritura rechazada, sin visitas previas; cambio a horario posterior, corrección hacia uno anterior, postergación después del inicio, suspensión/cancelación y escrituras simultáneas. Se conserva una sola elección por integrante/partido.
- Auditoría inspeccionada sin valor de elección y salida real del servidor comprobada sin payload de elecciones ni tokens de las sesiones de prueba.
- `npm run test:sports-next`: 12 recorridos aprobados, cero omisiones, con datos Champions presentes; River/UFC y accesibilidad conservados en Chromium móvil/escritorio y WebKit.
- Todo ejecutado en PostgreSQL local descartable, puerto 55439. Sin acceso a producción ni publicación.

### Cierre y riesgo para el corte

Estado histórico al cierre del Bloque 2: en ese momento quedaban pendientes los Bloques 3–6; se completaron después. Este cierre parcial no habilitaba por sí solo la apertura. Se mantuvo el corte duro del 19/10/2026 a las 18:00 Argentina, sin recortar verificaciones. El contenedor local quedó detenido conservando los fixtures.

## Aclaraciones solicitadas antes del bloque 3

### Reconciliación de los 18 y los 12 recorridos

No se borró ni se deshabilitó ningún caso. En el bloque 2 faltó volver a ejecutar la suite legada de 6 y el reporte solo incluyó los otros 12. En el bloque 3 se ejecutaron nuevamente los 18 completos, además de 8 casos nuevos.

| Archivo / nombre exacto del caso | Perfiles | Bloque 1 | Ejecutados en bloque 2 | Reejecutados en bloque 3 |
| --- | --- | --- | --- | --- |
| `sports.spec.ts`: Deportes ofrece importación curada y no intenta sincronizar fuentes | Chromium iPhone, Android y escritorio | 3 | 0 | 3 |
| `sports.spec.ts`: JSON curado carga River y UFC y conserva formación, comentario e identidad al reprogramar | Chromium iPhone, Android y escritorio | 3 | 0 | 3 |
| `sports-next.spec.ts`: agenda: all events, independent drafts, templates and mobile accessibility | Chromium iPhone, Android, escritorio y WebKit iPhone | 4 | 4 | 4 |
| `sports-next.spec.ts`: River results: preview, concurrency, corrections and idempotence | Los mismos cuatro perfiles | 4 | 4 | 4 |
| `sports-next.spec.ts`: UFC: private picks, stable fighters, cancellations, results and corrections | Los mismos cuatro perfiles | 4 | 4 | 4 |
| **Total anterior** | | **18** | **12** | **18** |

Los 92 de reglas/base no incluían la suite nueva de cierre/privacidad: esta vive en `tests/sports-football-predictions.integration.mjs` y se ejecuta mediante `npm run test:routes`. En el bloque 2 también se ampliaron aserciones dentro del ensayo de migración existente, sin crear otro caso contable. Ahora reglas/base suma 96 por los cuatro casos nuevos de `champions-rules.test.ts`.

### Pruebas explícitas y corrección de permisos

- `lazy read and rejected write persist the intended kickoff, not observation time`: crea cada partido después de su inicio previsto, verifica cero cierres y realiza lectura, guardado SQL o guardado HTTP sin visitas previas. El guardado devuelve 409; una conexión independiente consulta directamente la tabla, sin una lectura de API que pudiera recrear el cierre, y comprueba closed_at=inicio previsto. Esto demuestra persistencia después del rechazo y de la transacción de la función.
- La API SQL del bloque 2 tenía EXECUTE para PUBLIC. No cumplía la aclaración nueva: se corrigió con **0029**, sin modificar la migración ya aplicada 0028. También se reemplazó el helper de vista que recibía un integrante: ahora recibe la sesión y deriva la identidad.
- `definers pin search_path, accept no user ID and deny PUBLIC and anon`: consulta pg_proc/proconfig y las ACL efectivas de todas las funciones SECURITY DEFINER de fútbol; exige search_path=pg_catalog, public, ausencia de parámetros de usuario/integrante y ningún EXECUTE para PUBLIC/anon. Además cambia realmente a SET LOCAL ROLE anon y verifica que llamar la API falla con SQLSTATE 42501.
- La conexión de aplicación de este proyecto es propietaria de sus funciones. Un runtime con otro rol de confianza requiere permisos explícitos, nunca PUBLIC/anon. La conexión SQL limitada de las pruebas recibe solo EXECUTE de la API, y utiliza sesiones Better Auth reales de administrador/integrante; los helpers siguen privados.

## Bloque 3 — Importador de agenda y vista (completo)

### Contrato y decisiones

- Formato separado y versionado: schemaVersion=1, sport=champions. **Un archivo por jornada completa**; cada confirmación es una única transacción. Se conservan sin cambios los formatos River/UFC.
- Agenda con temporada, equipos/referencias UEFA y ESPN, jornada/ventana original y partidos con fuentes. Se admite startsAt con zona explícita o localStart con date/time/timeZone IANA; se normaliza a UTC al validar. eventDate corresponde al día argentino.
- UEFA es la fuente prioritaria: sin kickoffConfirmed por UEFA, startsAt debe ser null. La referencia ESPN no habilita un horario por sí sola. Los errores de formato, equipos, fuentes y conflictos previstos se reúnen antes de escribir.
- No se aceptan resultados en agenda. Un partido nuevo no puede importarse finalizado; uno con resultado existente no puede volver a programado por este importador.
- Vista previa sin escrituras; token HMAC firmado, ligado al administrador, familia, archivo, estado base y expiración de 15 minutos. Validación de estado con bloqueo/advisory lock al confirmar. Dos administradores sobre el mismo estado dejan un éxito y un conflicto, sin sobrescritura.
- La huella conservadora incluye metadatos de fútbol, equipos, fuentes y cierres de la familia; **no consulta ni incorpora elecciones**. Una elección ajena no invalida ni modifica la vista previa o su token. No se divulgan conteos de participación. El JSON se canoniza al comparar datos para que el orden de propiedades JSONB no produzca actualizaciones falsas.
- Se rechaza omitir partidos existentes, trasladarlos de jornada, cambiar sus equipos/identidades externas o alterar la ventana original. Estas reglas son iguales haya o no pronósticos, evitando señalar participación privada. Reprogramar conserva ID, elecciones y cierres.
- Un conflicto tardío al reservar una referencia externa produce 409 y rollback: ON CONFLICT solo tolera el vínculo idéntico de la misma entidad/proveedor, nunca omite una referencia apropiada por otra entidad. Se prueba reservando una referencia después de la vista previa mediante un trigger controlado.
- Un fallo inesperado durante la escritura revierte toda la jornada, incluidas temporada/equipos/jornada que se estuvieran creando. No se intentan continuar escrituras después de un fallo de base.
- Plantilla de ejemplo ficticio validable pero no confirmable; descarga de una jornada existente conserva IDs de proveedores y revisión guardada, sin elecciones. Reimportar un archivo idéntico no cambia timestamps ni duplica auditorías.
- API nueva: GET /api/sports/champions?round=<uuid>, POST /api/sports/champions/import, GET /api/sports/champions/templates. Permisos y banderas comprobados en el servidor. Resultados, puntos, tabla, hilo y apagado persistido siguen en bloques posteriores.
- Vista con pestaña Champions, jornadas anteriores/próximas por ventana original, indicador Parcial, partidos por día, horarios argentinos de 24 h, Horario a confirmar, sede neutral nominal y progreso exclusivamente propio. La función SQL del bloque 2 sigue siendo la autoridad para pronósticos y privacidad.
- Consulta de pronósticos de la jornada agrupada en una llamada SQL, sin cargar elecciones crudas en JavaScript. Refresco cada 30 segundos contra la base propia, sin proveedores; respuestas de refresco anteriores a un guardado no pisan la elección recién confirmada.
- Administración conserva errores juntos y foco accesible, carga/pegado de JSON, límite de 900 KB, vista previa y confirmación. Cliente solo recibe tipos de servidor, sin incluir dependencias de base/criptografía en el navegador.
- El mapa de referencias Champions no usa el par legado source_provider/external_reference. Se agregó al importador River una comprobación del mapa para que no pueda apropiarse de una referencia ESPN ya vinculada a Champions; conflicto 409 y preservación verificados.

### Verificación del bloque 3

- Tipos, lint, compilación, diff e historial de 30 migraciones: aprobados.
- Reglas/base: 96 aprobadas, cero omisiones. Incluye horario europeo a ambos lados del 25/10, salvaguarda de hora ambigua, conversión durante parseo, prioridad UEFA, errores múltiples y selección de jornada por ventana original.
- Rutas: 82 aprobadas, cero omisiones; 14 de cierre/privacidad y 9 del importador Champions, incluyendo contenedores. Cubren permisos, vista previa sin escritura, ejemplos, token firmado realmente vencido, archivo/actor/familia/estado diferentes, dos administradores, rollback provocado por trigger, idempotencia, identidades externas, agenda que conserva pronósticos y ausencia de filtraciones por vista/plantilla/token.
- Navegadores: **26 aprobados, cero omisiones = 18 anteriores + 8 nuevos**. Los nuevos son dos recorridos (importación/prode y navegación/privacidad) en iPhone/Android/escritorio Chromium y WebKit iPhone. Verificación con teclado, desbordamiento y axe; capturas con datos ficticios revisadas.
- Los 18 anteriores se ejecutan con test:sports-next y la selección sports.spec.ts del config legado. Los 8 nuevos tienen test:champions propio e integración en CI; están excluidos del config genérico para no ejecutarse con la bandera deshabilitada.
- No se redujo ningún conjunto de pruebas para cumplir el corte. Se corrigió un selector que también encontraba el anunciador de rutas de Next; las sesiones ficticias usan IPs de prueba independientes para no interferir entre perfiles con los límites de acceso.

### Punto de control crítico

**Punto de control registrado al cierre del Bloque 3 (histórico):** entonces la Jornada 3 no podía abrirse en producción; faltaban resultados/tabla, hilo, apagado y carga final. Esos bloques se completaron después. La publicación y revalidación final siguen sujetas al corte del 19/10/2026 a las 18:00 Argentina; si falta cualquier verificación obligatoria, el estreno pasa a Jornada 4.

### Nuevas coincidencias sistemáticas del bloque 3

Comando: rg -n 'football_match|sports_events|sports_football_predictions' src/lib/sports/champions*.ts src/lib/sports/import-server.ts (excluyendo pruebas). Cada fila explica el acceso relevante; las coincidencias históricas se conservan arriba.

| Ubicación | Extracto | Resolución |
| --- | --- | --- |
| `src/lib/sports/champions-import-server.ts:39` | `const matches = (await c.query<Match>(SELECT *,event_date::text FROM sports_events WHERE family_id=$` | Metadatos de fútbol para checksum/conflictos; nunca consulta elecciones. Escrituras solo Champions con identidad estable y transacción por jornada. |
| `src/lib/sports/champions-import-server.ts:123` | `if (!current) { eventId = (await c.query<{ id: string }>("INSERT INTO sports_events(family_id,kind,f` | Metadatos de fútbol para checksum/conflictos; nunca consulta elecciones. Escrituras solo Champions con identidad estable y transacción por jornada. |
| `src/lib/sports/champions-import-server.ts:127` | `if (hmac(actual) !== hmac(next)) { await c.query("UPDATE sports_events SET title=$6,first_participan` | Metadatos de fútbol para checksum/conflictos; nunca consulta elecciones. Escrituras solo Champions con identidad estable y transacción por jornada. |
| `src/lib/sports/champions-server.ts:22` | `EXISTS(SELECT 1 FROM sports_events e WHERE e.family_id=r.family_id AND e.round_id=r.id AND e.hidden=` | Lectura limitada a familia/competición Champions; elecciones devueltas exclusivamente por la API SQL de sesión. |
| `src/lib/sports/champions-server.ts:29` | `FROM sports_events WHERE family_id=$1 AND round_id=$2 AND football_category='champions' AND hidden=f` | Lectura limitada a familia/competición Champions; elecciones devueltas exclusivamente por la API SQL de sesión. |
| `src/lib/sports/champions-server.ts:31` | `const responses = (await c.query<{ id: string; response: { status: number; data: FootballPredictionV` | Lectura limitada a familia/competición Champions; elecciones devueltas exclusivamente por la API SQL de sesión. |
| `src/lib/sports/champions-server.ts:67` | `const rows = (await pool.query<{ first_team_id: string; second_team_id: string; id: string; event_da` | Lectura limitada a familia/competición Champions; elecciones devueltas exclusivamente por la API SQL de sesión. |
| `src/lib/sports/import-server.ts:56` | `if (item.kind !== "football_match") return false;` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:91` | `if (item.kind === "football_match") {` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:92` | `const linked = await tx.query("SELECT e.football_category FROM sports_football_event_sources s JOIN ` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:96` | `"SELECT *,event_date::text AS event_date FROM sports_events WHERE family_id=$1 AND kind=$2 AND sourc` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:103` | `"SELECT *,event_date::text AS event_date FROM sports_events WHERE family_id=$1 AND kind=$2 AND (kind` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:107` | `if (item.kind === "football_match")` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:147` | `if (item.kind === "football_match") {` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:189` | `"INSERT INTO sports_events(family_id,kind,title,competition,first_participant,second_participant,eve` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:227` | `"UPDATE sports_events SET title=$1,competition=$2,first_participant=$3,second_participant=$4,event_d` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:319` | `"INSERT INTO sports_events(family_id,kind,title,event_date,early_preliminaries_starts_at,preliminary` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:355` | `"UPDATE sports_events SET title=$1,event_date=$2,early_preliminaries_starts_at=$3,preliminary_starts` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:385` | `UPDATE sports_events SET ${columns[field]}=$1 WHERE id=$2 AND family_id=$3,` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:518` | `"SELECT e.id FROM sports_events e WHERE e.family_id=$1 AND e.kind=$2 AND e.source_provider='ufc_offi` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:536` | `"UPDATE sports_events SET source_absent_at=now(),updated_at=now() WHERE family_id=$1 AND kind=$2 AND` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:589` | `const riverItems = parsed.bundle.events.filter(event => event.kind === "football_match");` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |
| `src/lib/sports/import-server.ts:591` | `const river = await importCategory(actor, riverItems, parsed.bundle, "football_match", parsed.bundle` | River conserva su formato; valida referencias del mapa y excluye Champions de equivalencias, cobertura y cambios. |

Cierre histórico del bloque 3: contenedor local de pruebas detenido y conservado. Cambios locales sin publicación ni commit; no se tocó producción ni se aplicaron migraciones fuera de las bases aisladas.

## Pedidos previos al Bloque 4

- Migración 0030: las funciones están en `public`, compartido. Se revoca el privilegio global predeterminado de EXECUTE del creador de migraciones para PUBLIC y, si existe, anon. Un REVOKE limitado a un esquema no elimina la concesión global predeterminada de PostgreSQL. Esto exige conservar el mismo rol propietario para futuras migraciones; otro creador debe configurar sus propios privilegios predeterminados. No se cambian permisos de funciones preexistentes ajenas a Deportes.
- La prueba `definers pin search_path, accept no user ID and deny PUBLIC and anon` enumera **todas** las funciones de `public`, sin lista fija, prefijo ni filtro SECURITY DEFINER. Comprueba EXECUTE para todas y, para las SECURITY DEFINER, search_path e identidad. Crea además `champions_default_acl_probe` para verificar funciones futuras.

### Mapa de verificaciones del Bloque 3

| Verificación | Prueba y archivo | Estado al revisar / resolución |
| --- | --- | --- |
| Dos administradores simultáneos | `signed token binds file, administrator, family, expiry and base state` — `tests/sports-champions-agenda.integration.mjs` | Existente: Promise.all, una confirmación 200 y otra 409. |
| Token obsoleto | Mismo caso anterior (carrera); nuevo `obsolete preview rejects metadata changes; foreign jornada errors are complete with no writes` — mismo archivo | Se agregó una modificación de metadatos entre vista previa y confirmación, rechazo 409. |
| Partido de otra jornada, errores completos y ninguna escritura | Nuevo caso `obsolete preview rejects metadata changes; foreign jornada errors are complete with no writes` — mismo archivo | Faltaba el caso directo: dos partidos ajenos informados juntos; comparación de todas las filas antes/después. |
| Partido inexistente | Agenda **crea** partidos por diseño; `preview is read-only; permissions, complete errors and examples` rechaza participantes inexistentes y acumula errores | Para **resultados**, inexistente debe rechazarse: se incorpora y prueba en Bloque 4, donde sí aplica. No se declara cubierto por una prueba de agenda. |
| Rollback transaccional de agenda | `database failure rolls the whole jornada back, including new round and earlier match`; `late provider reservation conflict cannot silently omit a Champions identity` — mismo archivo | Existentes: fallo real a mitad de escritura, rollback de jornada y referencias. |
| Reimportación sin duplicar equipos/eventos | `reimport is idempotent; template retains provider identities and no picks` — mismo archivo | Se amplió: comparación exacta de equipos, sus fuentes, fuentes de partidos, temporadas y jornadas, además de eventos y auditoría. |
| Conversión antes/después del 25/10 | `European kickoff is converted on each side of the October DST change` — `src/lib/sports/champions-rules.test.ts` | Existente: 20/10 y 04/11 con desplazamientos UTC diferentes. |
| Horario a confirmar bloquea pronósticos | `Champions: errors together, preview without writes, import and own predictions` — `tests/e2e/champions.spec.ts` (cuatro perfiles); `unconfirmed kickoff and postponed state prevent writes without deleting choices` — `tests/sports-football-predictions.integration.mjs` | Existente: botones deshabilitados y rechazo autoritativo en PostgreSQL. |

Desde este bloque, el cierre incluye reglas/base, rutas, **todos** los recorridos generales y deportivos y accesibilidad; los conteos de recorridos deportivos anteriores no representaban la suite general completa.

## Bloque 4 — Resultados, puntos y tabla

### Búsqueda sistemática adicional

- `sports_football_results` en esquema, importador legado, consultas y nuevas rutas: se conserva la tabla existente y se aísla Champions por familia, categoría y jornada. No se modifica el cálculo ni la carga de River.
- `sports_football_predictions` / `choice` en servidor de resultados: **ninguna lectura de elecciones**. La función PostgreSQL `sports_football_round_table` es la única agregadora; requiere sesión real, deriva identidad y exige partido cerrado + resultado + estado definitivo. Devuelve solo puesto/nombre/puntos, sin cantidades de elecciones ajenas.
- Plantillas y vista previa de resultados: solo identidades de partidos, marcador y fuente; sin pronósticos. El hash base excluye elecciones privadas.
- Resultados en pestaña Champions: muestra marcador de 90 minutos y fuente; tabla semántica reutiliza los estilos de Deportes. En ese cierre, hilo y borradores todavía no se habían cambiado; quedaron implementados en el Bloque 5.
- Sincronización legada **sin cambios**: continúa limitada a River/UFC y ya rechaza referencias Champions; resultados Champions entran únicamente por el importador nuevo.

### Decisiones explícitas

- Un punto por acertar 1/X/2 a los 90 minutos más descuento; 0 si no hay elección o no acierta. Puestos con `rank`: 1, 1, 3. Sin desempate adicional.
- La tabla incluye integrantes activos de la familia, aunque tengan 0 puntos, pero aparece recién con el primer resultado computable. La lista no expresa participación. Se actualiza al cargar resultados, no hay puntos persistidos que se puedan desincronizar.
- Una carga puede contener el subconjunto ya finalizado de **una** jornada; toda esa carga es atómica. No hay marcador parcial de suspendidos, ni alargue, penales o global.
- Antes del inicio confirmado, sin horario, postergados, suspendidos y cancelados se rechazan. Registrar un resultado definitivo de un partido iniciado cambia su estado a `completed`; el trigger existente preserva el cierre. La administración declara el carácter definitivo al usar el formato `period: 90_minutes`.
- Repetir el mismo marcador y fuente no modifica registros ni auditoría. Cambiar marcador o fuente de un resultado existente se rechaza: requiere el flujo de correcciones del Bloque 8.
- Resultados usan vista previa firmada de 15 minutos ligada a familia/administrador/archivo/estado, con revalidación bajo bloqueo y el mismo bloqueo familiar que agenda. No se crean partidos, equipos ni jornadas.
- La habilitación depende de Champions y agenda, independiente de `SPORTS_RIVER_RESULTS_ENABLED`, cuyo nombre y alcance corresponden a River.

### Nuevas pruebas y cobertura

- `src/lib/sports/champions-results-rules.test.ts`: resultado 0–0 válido, rechazo de alargue/penales/global/parcial, todos los errores de goles/fuentes/duplicados juntos.
- `tests/sports-champions-results.integration.mjs`:
  - `results template and preview require real family administrator; foreign sessions cannot read table`.
  - `future and unconfirmed matches reject all results; open votes and stray results cannot affect table`.
  - `missing and other-jornada matches return every item error and preserve all data` — completa el punto pendiente del mapa del Bloque 3: inexistente + otra jornada + válido, todos los errores y cero escrituras.
  - `mid-import failure rolls back earlier score, status and audit for the whole jornada`.
  - `concurrent administrators consume one preview; draw awards one point and shared positions`.
  - `partial table and correction rejection never reveal or change an open match`.
  - `final table uses only 90-minute outcome; identical imports do not duplicate or audit again`.
- La privacidad de la tabla se prueba con conexión PostgreSQL limitada (sin superusuario, BYPASSRLS ni acceso a tablas) y tokens reales de integrante y administrador, además de solicitudes HTTP reales. La conexión propietaria solo prepara datos, induce fallos y comprueba almacenamiento.
- `tests/e2e/champions.spec.ts`: `Champions: results preview, 90-minute score and partial/final family table`, en cuatro perfiles, con semántica/axe y comprobación de ancho móvil. La navegación por teclado sigue cubierta por el recorrido anterior; se conservan los ocho recorridos anteriores.

### Cierre del Bloque 4 y carga inicial autorizada

Verificación completa, sin pruebas eliminadas ni omitidas: tipos, lint, compilación, 32 migraciones ordenadas; **98 reglas/base, 91 rutas, 111 recorridos generales, 12 deportivos anteriores, 12 Champions y 3 de accesibilidad**. Los 18 recorridos deportivos originales se mantienen (6 en generales + 12 en sports-next). Los 8 de Champions del Bloque 3 se mantienen y se agregan 4 de resultados/tabla. Total navegador/accesibilidad: 138. Revisión visual realizada sobre captura iPhone del flujo real.

Luego de dejar el Bloque 4 en verde, se preparó `sources/champions/2026-27-jornada-3-agenda.borrador.json` con los datos del calendario oficial UEFA de la fase liga, actualizado el 14/10/2026, y los IDs de la página oficial de clubes, consultados el 17/10/2026; los horarios se corroboraron contra Sky Sports, la web oficial del FC Barcelona y otros calendarios GMT/CET. ESPN no tiene cobertura de esta temporada. Queda pendiente revalidación humana el 19/10/2026 por la mañana (Argentina); se registró la discrepancia CET/CEST. No se consultaron ni modificaron datos de producción. En esa etapa todavía faltaban 36 referencias UEFA de equipos y 18 de partidos; luego se completaron desde la página oficial de clubes y el calendario UEFA, sin inventar IDs. ESPN se omite porque no cubre esta temporada. Los nombres adicionales del borrador son etiquetas para revisión, no IDs de proveedor.

Procedencia y corte temporal: el calendario oficial UEFA de fase liga actualizado el 14/10/2026 y la página oficial de clubes se consultaron el 17/10/2026; los horarios se corroboraron con Sky Sports, la web oficial del FC Barcelona y otros calendarios GMT/CET. ESPN no cubre esta temporada. La revalidación humana queda pendiente para el 19/10/2026 por la mañana (Argentina). `checkedAt` se conserva provisional en 00:00 UTC del 17/10 y no afirma una hora exacta de consulta; debe reemplazarse por el instante real al revalidar. `importReady` es metadata informativa, no una autorización.

Vista previa HTTP real en base aislada, con administrador real: **400**, 90 errores acumulados (36 equipos, 18 partidos y 36 vínculos de participantes); sin token ni confirmación, cero registros deportivos nuevos. Se guardó respuesta completa sanitizada y tabla de horarios en `sources/champions/2026-27-jornada-3-vista-previa.json`. La conversión de los 18 instantes se ejecutó en PostgreSQL con zonas IANA: **4×13:45 + 14×16:00 Argentina; 9 por día**. La familia y sesión de prueba se eliminaron.

Estado histórico al cierre del Bloque 4: entonces faltaban Bloques 5 y 6, las referencias UEFA y una vista previa válida. Los pedidos posteriores añadieron referencias y una vista previa correcta; los bloques 5–8 se completaron después. La publicación y revalidación permanecen como pasos operativos del usuario, bajo el corte duro del 19/10/2026 18:00 Argentina.

## Ajustes aprobados después del Bloque 4 y Jornada 3

- La prueba anterior `different score reimport fails clearly and preserves events, results, picks, closures and audit` cubría el rechazo previo a implementar correcciones. El Bloque 8 reemplazó ese flujo: ahora un marcador distinto se presenta en `two administrators race on a correction; stale previews reject and confirmation records old/new`, y solo cambia tras token válido y confirmación explícita.
- Se conservó el valor de `checkedAt`, marcado como provisional en el JSON; se consigna literalmente la revalidación del **19/10/2026 por la mañana (Argentina)** para registrar la hora real. No se creó una automatización ni se adelantó esa revisión.
- Se incorporaron exclusivamente 36 IDs numéricos UEFA de equipos y 18 de partidos tomados de la página oficial de clubes y el calendario de la fase liga, consultados el 17/10/2026. Se completaron las referencias local/visitante; no se incorporaron IDs ESPN ni otros proveedores. La revalidación humana queda pendiente para el 19/10/2026 por la mañana (Argentina).
- La vista previa habitual emitía un token de confirmación. Para cumplir el pedido expreso de **no emitir token**, se agregó `issueToken:false` a la vista previa: ejecuta las mismas validaciones/lecturas, pero no llama al firmante ni devuelve un token. No habilita escrituras ni cambia las reglas de confirmación.
- `unsigned preview repeated twice is identical and never creates teams, matches or confirmation tokens` (`tests/sports-champions-agenda.integration.mjs`): dos respuestas 200 idénticas, resumen con equipos, errores vacíos, sin token y sin filas deportivas nuevas.
- Jornada 3: dos vistas previas HTTP reales en base aislada, administrador real, **200 / 18 partidos / 36 equipos / 0 errores** en ambas; idénticas. Se contrastó cada tripleta ID de partido/local/visitante con las páginas oficiales UEFA registradas, además de comprobar nombres, instantes y los 18 horarios argentinos. La revalidación humana de las fuentes sigue pendiente para el 19/10 por la mañana. **0 confirmaciones y 0 tokens de Jornada 3**, cero registros deportivos nuevos. Respuesta completa sin credenciales: `sources/champions/2026-27-jornada-3-vista-previa.json`. No se tocó producción.

## Bloque 5 — Hilo único y borradores

### Búsquedas sistemáticas del supuesto fútbol = River

Búsqueda realizada con `rg -n 'football_day|river_match|ufc_card|context_kind|contextKind'` en `Comments.tsx`, `server.ts`, `schema.ts` y `rules.ts`; y `rg -n 'comment|draft|borrador'` en `AgendaApp.tsx`, servidor y tipos deportivos.

| Coincidencia | Resolución y razón |
| --- | --- |
| `src/db/schema.ts`, `sports_comments.context_kind`, índice por fecha y las tres ramas del check `sports_comments_context_shape` | **Sin cambios:** representan conversaciones existentes de día/River/UFC; Champions necesita identidad de jornada y almacenamiento separado para conservar su aislamiento. Se agrega `sports_football_round_comments` con FK compuesta familia/jornada y familia/autor. |
| `src/lib/sports/rules.ts`, `isSportsContext`, ramas football_day/river_match/ufc_card | **Sin cambios:** sigue siendo el contrato del endpoint legado; no se amplía para impedir el ingreso accidental de Champions por esa vía. |
| `src/lib/sports/server.ts`, `readSportsComments`: selección por tipo, fecha, evento, filtro River y priorDates | **Sin cambios:** lee solamente la tabla legada y sus contextos válidos; no puede leer la tabla nueva. Prueba explícita de rechazo del contexto Champions genérico. |
| `src/lib/sports/server.ts`, `mutateSportsComment`: validación de tipo/fecha/evento, selección River/UFC, creación, edición, retiro y auditoría | **Sin cambios:** las identidades nuevas no se encuentran en esa tabla; POST genérico rechazado y PATCH genérico con ID Champions devuelve 404. |
| `src/app/api/sports/comments/route.ts` y `[commentId]/route.ts` | **Sin cambios:** delegan al contrato legado cerrado. Nuevas rutas por UUID de jornada, con controles propios de familia/sesión/autoría. |
| `src/app/deportes/Comments.tsx`, unión ContextKind y encabezados por contexto | Agrega `champions_round` como presentación del hilo; no agrega días ni eventos. |
| `Comments.tsx`, GET/POST y PATCH de CommentItem con rutas genéricas fijas | Agrega `apiPath` opcional, cuyo valor por defecto es el endpoint previo. Champions usa solo su endpoint por jornada. `loadPrior` **sin cambios**, porque solo se usa en las conversaciones históricas de River. |
| `Comments.tsx`, estados locales de texto/edición, limpiar después de guardar | Agrega edición controlada opcional para Champions. Guardar una edición conserva el borrador de comentario nuevo; una respuesta atrasada solo limpia el texto/edición que efectivamente envió, no texto posterior. El comportamiento de limpieza legado se conserva. |
| `AgendaApp.tsx`, mapa de borradores por evento y comentarios River/UFC | **Sin cambios:** conserva su identidad anterior. Agrega un mapa Champions separado por familia/integrante/jornada, por encima de los componentes que se desmontan al navegar. |
| `ChampionsAgenda.tsx`, key de revisión y navegación sport/round | Conserva actualización de partidos; hilo único al final de la jornada, enlace desde portada, borradores externos a la vista. Tras elegir jornada con teclado el foco va a su encabezado. |
| `page.tsx`, montaje de AgendaApp | Key por familia/integrante para que un cambio de identidad no herede borradores de otra persona. |
| `types.ts`, SportsComment | Campo opcional authorName para mostrar autores históricos archivados en el hilo nuevo; la búsqueda de miembros legada sigue como fallback. |
| Importadores, resultados, plantillas y sincronización legada | **Sin cambios por el hilo:** no referencian comentarios ni tienen que reconstruirlos; una reprogramación conserva el UUID de jornada y no toca la tabla nueva. Los únicos cambios previos son la vista previa sin token y el archivo inicial, autorizados expresamente. |

### Decisiones y límites explícitos

- La identidad del hilo es el UUID de jornada; existe conceptualmente aunque aún no tenga comentarios. No se crea un hilo por día ni partido. Jornadas con las mismas fechas siguen separadas.
- Almacenamiento aditivo separado de `sports_comments`; no hay traslado ni reescritura de conversaciones River/UFC.
- Autor edita sus comentarios; autor o administrador pueden retirarlos. El retiro conserva fila, autor y auditoría. Cambios concurrentes requieren versión esperada: uno gana y otro recibe 409. Se usa el rol vigente bloqueado en la base, no un rol desactualizado del cliente.
- Borradores nuevos y de edición viven **en memoria de la pantalla Deportes**, separados por familia/integrante/jornada. Sobreviven cambios de jornada, pestañas River/UFC/Champions y renovación de la vista de Deportes; no se promete persistencia al recargar el navegador, cerrar la pestaña o salir de Deportes. No se guardan en almacenamiento compartido del dispositivo ni se sincronizan entre dispositivos.
- Una respuesta demorada de una vista anterior no borra un borrador posterior. Un fallo de red o conflicto de versión conserva el texto para revisarlo.
- Se reutiliza el componente visual de comentarios. La comprobación axe detectó contraste insuficiente del timestamp reutilizado; se corrigió con CSS limitado al hilo Champions. No se alteró el estilo legado.
- La búsqueda de recomendaciones UX sobre borradores no produjo una coincidencia específica; se aplicó como criterio de producto la conservación requerida, sin atribuir a la skill una regla no encontrada. Se revisaron etiquetas, foco, botones nativos, ancho móvil y feedback accesible.
- No se implementó el interruptor persistido ni se inició el Bloque 6. Los endpoints nuevos respetan la habilitación por entorno ya existente.

### Pruebas nuevas

`tests/sports-champions-comments.integration.mjs` usa sesiones reales y prueba creación/lectura, hilo único entre días, cambio de horario y fecha, jornadas con fechas idénticas, aislamiento familiar, claves foráneas compuestas, validación del cuerpo, rechazo de rutas genéricas, autoría, retiro administrativo, versiones simultáneas, rol vigente, revocación, archivo y auditoría sin contenido.

`tests/e2e/champions.spec.ts` conserva todos los casos anteriores y agrega tres escenarios en cuatro perfiles (12 recorridos nuevos):

- `Champions: one thread per jornada preserves independent drafts across rounds, tabs and reprogramming`.
- `Champions: edit drafts survive navigation and saving an edit preserves the independent new-comment draft`.
- `Champions: a delayed comment response cannot erase newer text after returning to the jornada`.

Incluyen navegación por teclado y foco, cambio River/UFC/Champions, jornadas independientes, envío con falla y recuperación, cambio remoto concurrente, envío demorado, reprogramación, comprobación de ancho y axe con comentarios publicados.

### Cierre del Bloque 5

Suite completa en verde, sin eliminar ni omitir casos: tipos, lint, compilación, **33 migraciones aplicadas y hashes verificados**, **98 reglas/base**, **100 rutas**, **111 recorridos generales**, **12 deportivos anteriores**, **24 Champions** y **3 de accesibilidad**. Total navegador/accesibilidad: **150**. Las 98 reglas/base se conservan; los casos nuevos de importación, permisos del hilo y concurrencia viven en rutas (91 → 100). Champions conserva los 12 recorridos del Bloque 4 y agrega 12 de hilo/borradores. El ensayo adicional de capturas no sustituye ninguna suite.

Estado histórico al cierre del Bloque 5: estaban pendientes el Bloque 6, la revalidación de `checkedAt` y la publicación; después se completó el Bloque 6 y luego los Bloques 7 y 8. No se tocó producción. Se mantiene el corte del 19/10/2026 a las 18:00 Argentina y el traslado a Jornada 4 si falta algún requisito obligatorio en verde.

Revisión visual final: capturas reales del hilo publicado en iPhone y escritorio, con dos comentarios y acciones de autor. Ambos recorridos adicionales de captura pasan; se revisaron las imágenes. No reemplazan los 150 recorridos de la suite completa. Al finalizar se detuvo el contenedor PostgreSQL aislado, conservando el entorno local sin servidores de prueba activos.

## Bloque 6 — Interruptor y aislamiento

### Búsqueda sistemática de supuestos fútbol = River y rutas de lectura/escritura

Se revisaron `src/app/api/sports/**`, `src/app/deportes/page.tsx`, servicios de agenda, comentarios, pronósticos, resultados, importadores y plantillas con búsquedas de rutas Champions, IDs de jornada/partido y servicios genéricos. Resoluciones que evitan que el interruptor cambie el comportamiento legado:

| Coincidencia | Resolución y razón |
| --- | --- |
| `src/app/api/sports/events`, `predictions`, `formation`, `comments`, `results`, `results/import`, `import`, `template` y `events/[id]` | **Sin cambios al contrato legado:** sirven exclusivamente el modelo River/UFC. Se agregan pruebas con IDs Champions que verifican rechazo/sin mutación y que River/UFC siguen operativos con Champions encendido y apagado. |
| `src/lib/sports/server.ts`, consultas de eventos y filtros River/UFC | **Sin cambios:** el servicio legado sigue aislado de tablas Champions; las rutas dedicadas nuevas consultan su servicio propio y exigen la habilitación efectiva. |
| `src/app/deportes/page.tsx`, carga de agenda | Añade lectura fresca del interruptor por familia en cada solicitud y solo carga agenda Champions cuando entorno y registro de familia están activos. River/UFC conservan su carga y comportamiento. |
| `src/lib/sports/champions-server.ts`, `champions-import-server.ts`, `champions-results-server.ts`, `champions-comments-server.ts`, `football-predictions-server.ts` | Cada lectura/escritura de dominio evalúa el interruptor efectivo en base dentro de la transacción; las escrituras sostienen bloqueo compartido hasta confirmar. La denegación ocurre antes de devolver agenda, contenido de comentarios, validación de archivo/resultados o datos de elecciones. |
| Rutas `/api/sports/champions/**` de agenda, pronósticos, comentarios, plantillas e importadores/resultados | Gate común en el servidor, sin caché; apagado responde con el mismo rechazo opaco y bloquea endpoints dedicados y accesos indirectos. La ruta `/switch` es la única excepción necesaria para administrar y apagar. |
| `sports_champions_enabled` y `sports_champions_set_enabled` en la migración 0033 | El primero fija `search_path`, deriva familia de sesión y puede tomar `FOR SHARE`; el segundo deriva administrador de la sesión, fija `search_path` y toma `FOR UPDATE`. No reciben un ID de integrante ni permiten activar si el entorno/dependencias están apagados. |
| Inserción de familia y valores existentes del interruptor | Backfill y trigger asignan `false`; así las familias previas y futuras quedan apagadas al desplegar. Apagar solo cambia el interruptor: datos y migraciones se conservan. |
| `.env.example`, `src/lib/sports/config.ts` | Añade `SPORTS_CHAMPIONS_ENABLED=false`; la habilitación efectiva requiere Deportes, agenda y bandera de entorno, además del valor persistido por familia. Lectura ambiental dinámica por solicitud, sin caché. |

### Verificación del Bloque 6 y ensayo de Jornada 3

La prueba concurrente vive en `tests/sports-champions-switch.integration.mjs`: una solicitud HTTP autenticada de pronóstico se detiene dentro de su transacción tras adquirir el bloqueo compartido; el apagado administrativo queda esperando el bloqueo exclusivo. La prueba comprueba que la escritura confirmada precede a la respuesta de apagado y que, cuando el apagado queda confirmado, nuevas escrituras se rechazan. El trigger de espera se instala y elimina solo en la base aislada de pruebas.

`sources/champions/2026-27-jornada-3-ensayo.json` conserva el ensayo autorizado en PostgreSQL local aislado (`127.0.0.1:55439/champions_test`). La repetición final con las 36 migraciones está detallada y fechada en el mismo JSON. Producción no fue consultada ni modificada.

El runbook de publicación de una sola ejecución está en `sources/champions/publicacion-runbook.md`; cubre respaldo/restauración aislada, ensayo y migraciones, despliegue apagado, importación en despliegue temporal protegido, habilitación, retiro del acceso temporal, comprobaciones y reversión de cada paso. No se ejecutó ninguna acción de publicación.

### Cierre del Bloque 6

Migración 0033 agregada; total **34 migraciones**, hashes verificados. Validaciones de ese corte: tipos, lint, compilación, base/reglas **98/98**, rutas **102/102**, recorridos generales **111/111**, recorridos deportivos previos **12/12**, Champions **28/28** y accesibilidad **3/3**. No se omitieron pruebas. El bloque conserva todas las verificaciones de River/UFC y agrega aislamiento por familia, entorno apagado, bloqueo de todos los endpoints y la carrera real entre escritura y apagado.

Al repetir accesibilidad en ese corte, se detectó que el runner no pasaba `FAMILY_UTILS_TEST_DATABASE_URL` al servidor Next, por lo que una repetición inicial rechazó correctamente crear fixtures en una base distinta. `playwright.a11y.config.ts` pasó a fijar `DATABASE_URL` a esa misma URL aislada; con la conexión local explícita las tres pruebas terminaron pasando. No se deshabilitó ni redujo ningún caso.

Estado histórico al cierre del Bloque 6: seguían pendientes la publicación operativa y los Bloques 7 y 8; estos últimos se completaron después. El estado vigente de salida se detalla en el cierre final. No se tocó producción.

## Bloques 7 y 8 — suspendidos y correcciones (completos)

- `0034_champions_suspended_resolution.sql` agrega resoluciones administrativas sin cambiar el estado deportivo de una anulación: conserva `suspended`, guarda el motivo y la auditoría la distingue de una cancelación oficial. El resultado oficial requiere fuente UEFA y marcador completo a 90 minutos; se rechazan marcadores parciales, alargue y penales. Cancelados y anulados quedan fuera de la cuenta computable y de los puntos.
- `0035_champions_result_corrections.sql` registra marcador anterior/nuevo y fuente. La vista previa identifica correcciones y nunca incluye pronósticos. Confirmar requiere bandera explícita, token firmado de 15 minutos ligado a actor/familia/archivo/estado y revalidación bajo bloqueo. Los puestos se recalculan a partir de los resultados vigentes.
- Cobertura obligatoria: `two administrators race on a correction; stale previews reject and confirmation records old/new`; `correcting a closed result does not modify or expose an open match election`; `final table uses only 90-minute outcome; identical imports do not duplicate or audit again`; `suspended matches resolve to an official result or an audited prode void without partial scores` (`tests/sports-champions-results.integration.mjs`). Los recorridos UI asociados están en `tests/e2e/champions.spec.ts`.
- El ajuste pedido al runner de accesibilidad es únicamente pasar la URL de PostgreSQL aislado al servidor de Playwright. El diff no toca nombres, aserciones, filtros ni perfiles. Se ejecutó la suite accesible final: 3/3.
- `playwright.config.ts` también pasa al servidor general la base aislada y el secreto de prueba que esperan sus fixtures. River/UFC genera fechas futuras para que la regresión no dependa de que la hora de kickoff ya haya pasado. No se removió ningún recorrido. La suite de rutas se serializa porque varias pruebas comparten la creación y revocación del rol `anon`; con serialización: 103/103.
- La matriz completa de requisitos y nombres de prueba está en `sources/champions/verificaciones-fase-1.md`; SQL de permisos y procedimiento productivo, en `sources/champions/permisos-check.sql` y `sources/champions/publicacion-runbook.md`.

## Cierre final de verificación local

- Reglas/base 106/106 reglas/base e integraciones; rutas 103/103; navegador general 111/111; recorridos deportivos River/UFC 20/20 en cuatro perfiles; Champions 32/32; accesibilidad 3/3. Cero omitidas. Tipos y compilación aprobados; lint sin errores (una advertencia preexistente por parámetro sin uso); 38 migraciones y hashes comprobados.
- El chequeo SQL actualizado enumeró las 19 funciones del esquema `public` en la base aislada: PUBLIC, anon y authenticated sin EXECUTE en todas; terminó sin excepción.
- Todos los cambios y pruebas usaron PostgreSQL aislado local. Ninguna migración, vista previa, escritura, consulta ni despliegue se ejecutó contra producción.
- **Bloqueante de publicación:** el runbook aún debe ejecutarse por el operador, incluido el chequeo de permisos en la base productiva, revalidación del archivo con `checkedAt` real, importación protegida, retiro comprobado del acceso temporal y prueba de apagado. Si esos pasos no terminan antes del 19/10/2026 18:00 Argentina, mover el estreno a Jornada 4.


## Cierre final para RC1 (2026-10-17)

UFC se incorporó como base publicada en `2000606`, incluyendo la puntuación 5/3/1 y el cierre de pronósticos; el commit agrega `0037_ufc_card_closure` con el hash y timestamp ya aplicados en producción, inmediatamente después de `0026`. Las diez migraciones Champions quedan después de UFC. No se modificaron las migraciones publicadas ni se consultó producción. El árbol final se validará desde un worktree limpio del tag RC1.


## Revalidación desde copia limpia con UFC publicado integrado

La rama se basa en el UFC publicado (incluidos el cierre de pronósticos y la puntuación 5/3/1), seguido de los ocho commits Champions. En el worktree limpio `cb1a789`, `npm ci`, tipos, lint, compilación y las 38 migraciones con hashes pasaron; no se omitieron casos. Las suites completas registraron: reglas/base 107/107, rutas 103/103, recorridos generales 111/111, Deportes 24/24, Champions 32/32 (iPhone, Android, WebKit iPhone y escritorio) y accesibilidad 3/3. WebKit corrió con una copia del navegador y dependencias dentro de `/tmp`, sin cambiar el sistema, código ni pruebas.

El ensayo autenticado de Jornada 3 en esa copia confirmó con token: HTTP 200, 36 equipos, 18 partidos, 0 errores; segunda confirmación HTTP 200 y `changed:false`, con estado de dominio y auditoría idénticos. Se verificaron los 18 pares UEFA de partido/local/visitante, 9 por día, con 4 horarios argentinos a las 13:45 y 14 a las 16:00. Dos integrantes autenticados recibieron solo su elección, y el administrador recibió `choices: []`. La base aislada se usó; producción no se tocó. El JSON de ensayo consigna el commit y las 38 migraciones.

Antes de publicar todavía son bloqueantes el respaldo y ensayo de restauración, migraciones y chequeo productivos de permisos, revalidación humana/`checkedAt` real, importación en despliegue temporal protegido, habilitación, retiro verificado del acceso temporal y prueba productiva de apagado. Si no concluyen antes del corte duro 19/10/2026 18:00 Argentina, el estreno pasa a Jornada 4. No se hizo merge, despliegue ni escritura en producción.
