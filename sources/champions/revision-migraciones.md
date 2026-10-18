# Revisión de seguridad de migraciones Champions

Revisión de `0027`–`0035` y de la corrección aditiva `0036`, contra PostgreSQL aislado. **no verificado: main no contiene 0037 y no se consultó la base de producción**. Esta revisión documenta `champions-fase-1`, cuyo journal local ubica 0037 después de `0026`; la rama alternativa `champions-sin-ufc` excluye 0037, su snapshot y su entrada de journal. Ninguna de esas secuencias prueba si 0037 se aplicó en producción. La copia de SQL completa al final permite revisión externa. No contiene credenciales ni datos de familias.

## Hallazgos por migración

| Migración | Hallazgo | Resolución / permisos / efectos |
|---|---|---|
| 0027 | Agrega identidad estable y fuentes UEFA/ESPN. No crea funciones `SECURITY DEFINER`. Normaliza el campo de categoría existente de UFC a `NULL`; River conserva `river`. | Excepción de compatibilidad: solo normaliza UFC, no altera elecciones/resultados/comentarios ni otro historial. `ALTER TABLE sports_events` y FK/checks toman locks DDL; el backfill escribe esa tabla. Apagar no borra datos. |
| 0028 | Crea seis funciones `SECURITY DEFINER` con `search_path = pg_catalog, public`. La primera `sports_football_choice_view` recibía `p_member` directamente, defecto de autorización. Revocaba `PUBLIC`, pero no cubría grants gestionados por rol. | 0029 la sustituye por una variante con token y elimina el overload inseguro. Reemplaza el CHECK de estado en `sports_events` (lock DDL). Helper de cierre y trigger no reciben identidad. Cierres se materializan contra horario anterior. |
| 0029 | Reemplaza `choice_view` por token; fija `search_path`; elimina el overload con UUID de integrante. Revoca `PUBLIC`/`anon`, no `authenticated`. SQL dinámico usa `regprocedure` y `format`, sin concatenar input. | `DROP FUNCTION` elimina solo el helper inseguro, no tablas ni filas. No toma locks de datos. 0036 corrige ACLs. Datos permanecen al apagar. |
| 0030 | Defaults de EXECUTE solo para el propietario que ejecuta la migración; no cubre `authenticated` ni otros propietarios. Funciones `sports_%` existentes: revoca `PUBLIC`/`anon`. | 0036 complementa permisos actuales y futuros. Producción debe chequear y aplicar defaults bajo su propietario real si difiere del local. Sin cambios de filas. |
| 0031 | Función de tabla familiar SECDEF tokenizada, `search_path` fijo, sin ID de integrante; puntúa solo partidos cerrados/resueltos y no expone elecciones. Revoca `PUBLIC`/`anon`, no `authenticated`. | 0036 revoca ACL restante. Crea tablas/índices; sin backfill. Apagado conserva resultados. |
| 0032 | Hilo nuevo por jornada, sin función SECDEF; FKs fijan familia, jornada y autor. | 0036 revoca ACLs directas a roles Data API. Crea tabla/índice; validación de FK toma locks en referencias. Apagado conserva comentarios. |
| 0033 | Switch, trigger de familia y API. SECDEF fija `search_path`; APIs toman token, trigger no recibe usuario. Revocación incompleta para `authenticated`. | Backfill de switch `false`; lock explícito `SHARE ROW EXCLUSIVE` en `families`. Orden: sesión/dispositivo/integrante → switch (`SHARE`, setter `UPDATE`) → partido (`UPDATE`). Importadores/resultados: switch → advisory de familia → partidos ordenados. No hay ciclo inverso identificado. Apagado conserva filas. |
| 0034 | Resolución oficial/anulación auditada; tabla solo suma partidos cerrados y resueltos. Función SECDEF tokenizada, search_path fijo; revoca `PUBLIC`/`anon`, no `authenticated`. | ACL corregida en 0036. Tabla nueva sin reescritura de historial; apagado conserva resoluciones. |
| 0035 | Correcciones con token, old/new, confirmación y bloqueo; vista previa muestra marcadores, nunca elecciones. No se identificó SQL dinámico concatenado. | Tabla nueva; solo confirmación cambia resultados. Bloquea partidos ordenados; no toca elecciones abiertas. Apagado conserva auditoría/correcciones. |
| 0036 | Hallazgo real: privilegio `authenticated` y ACL directa de tablas no estaban garantizados como revocados en Postgres gestionado. | Nueva migración: defaults de funciones/tablas para `anon`/`authenticated`, revoke efectivo actual sobre `sports_%` y tablas `sports_football_%`/switch. Objetos del catálogo se pasan por `regprocedure`/`regclass` y `format`. Sin cambios de datos. El test crea roles gestionados y verifica ACL efectiva. |

## Respuestas operativas por migración (incluye UFC 0037)

Las duraciones exactas no se midieron contra producción y dependen del volumen, la latencia y las transacciones concurrentes. Donde una migración toma un lock fuerte o recorre datos existentes, se indica el riesgo; no afirmo una duración de producción que no observé. “SQL dinámico por concatenación” se refiere a concatenar texto o datos no confiables para formar SQL; el uso de `format()` con identificadores del catálogo queda señalado aparte.

### 0027 — `sports_champions_identity.sql`

- **Orden de locks (familia, partido, interruptor):** en migración no toma locks de filas de familia, partido ni interruptor; el interruptor aún no existe. En runtime, los triggers de identidad no toman esos locks explícitamente. No hay ciclo de locks de aplicación identificado.
- **SQL dinámico por concatenación:** no.
- **Triggers eludibles con escritura directa:** una escritura SQL normal sigue ejecutando los triggers de normalización y sincronización. Un propietario/superusuario puede deshabilitarlos o usar `session_replication_role=replica`; el rol de aplicación no tiene escritura directa a las tablas Champions. La normalización de UFC también queda protegida por el CHECK de categoría.
- **Locks de tablas existentes / tiempo:** `ALTER TABLE sports_events` agrega columnas, índices/FK/CHECK y reemplaza restricciones, por lo que requiere locks DDL fuertes en `sports_events`; el backfill `UPDATE ... WHERE kind='ufc_card'` toma `ROW EXCLUSIVE` y locks de fila para todas las filas UFC que actualiza. También lee `families` y `members` al crear/validar FKs. El backfill escala con la cantidad de eventos UFC; duración real no medida.
- **Apagar bandera:** no revierte ni borra columnas, referencias, equipos, eventos ni historial. La bandera Champions no apaga River ni UFC.

### 0028 — `sports_football_predictions.sql`

- **Orden de locks:** las funciones nuevas no bloquean familia ni interruptor. Una escritura de pronóstico bloquea el partido (`sports_events ... FOR UPDATE`) antes de materializar el cierre y escribir la elección. No hay lock de switch en esta versión. No se observa un camino inverso que retenga una elección y luego espere el partido.
- **SQL dinámico por concatenación:** no.
- **Triggers eludibles:** una escritura directa normal sigue pasando por `sports_football_preserve_close`; no puede evitar el trigger desde SQL ordinario. Propietario/superusuario o replicación sí pueden deshabilitar triggers. Las tablas de elecciones/cierres no se conceden a roles Data API.
- **Locks existentes / tiempo:** cambia la restricción de estado de `sports_events` (lock DDL fuerte); FKs consultan/bloquean `families`, `members` y `sports_events` al validarse. Crea tablas e índices vacíos, sin backfill; el trabajo de validación depende de tablas referenciadas, duración no medida.
- **Apagar bandera:** no elimina ni modifica elecciones/cierres; permanecen almacenados.

### 0029 — `sports_football_function_access.sql`

- **Orden de locks:** igual al escritor de 0028: partido, sin lock de familia ni switch.
- **SQL dinámico por concatenación:** no. Itera firmas del catálogo y usa `format()` con `regprocedure`; no interpola entradas del usuario.
- **Triggers eludibles:** no añade triggers. Las reglas de cierre existentes siguen activas ante escrituras SQL normales; solo un rol privilegiado puede deshabilitarlas.
- **Locks existentes / tiempo:** reemplaza funciones y revoca permisos; no cambia filas ni toma locks de fila de `sports_events`. Los locks de catálogo son breves, pero no se midieron.
- **Apagar bandera:** conserva elecciones y cierres.

### 0030 — `sports_function_defaults.sql`

- **Orden de locks:** no toma locks de familia, partido o switch; actúa sobre ACLs y catálogo.
- **SQL dinámico por concatenación:** no. Usa `format()` para las firmas obtenidas del catálogo (`regprocedure`).
- **Triggers eludibles:** no añade ni altera triggers.
- **Locks existentes / tiempo:** cambia privilegios por defecto del propietario y ACLs de funciones existentes; no bloquea filas de negocio. Duración esperada corta por ser operaciones de catálogo, no medida.
- **Apagar bandera:** no afecta datos.

### 0031 — `sports_champions_results.sql`

- **Orden de locks:** no introduce escrituras con locks de familia/partido/switch; la función lee resultados y cierres ya persistidos.
- **SQL dinámico por concatenación:** no.
- **Triggers eludibles:** no añade triggers. La consulta solo agrega partidos cerrados y resueltos; una escritura directa privilegiada en tablas de resultados sigue fuera del flujo autorizado por API.
- **Locks existentes / tiempo:** crea/reemplaza función y ACL; no reescribe tablas existentes. Locks de catálogo breves, no medidos.
- **Apagar bandera:** la tabla conserva resultados y cierres; quedan inaccesibles mediante las rutas Champions apagadas.

### 0032 — `sports_champions_round_comments.sql`

- **Orden de locks:** no toma locks de familia, partido o switch durante la migración. Runtime bloquea la fila de comentario que se edita; no bloquea partidos. No se encontró un camino de comentario hacia partido/switch.
- **SQL dinámico por concatenación:** no.
- **Triggers eludibles:** no hay trigger de autorización; las FKs siguen protegiendo integridad ante escrituras directas, pero no reemplazan la autorización de la API. El rol de aplicación no recibe escritura de tabla.
- **Locks existentes / tiempo:** crea tabla e índices vacíos y valida FKs contra `families`, `members` y `sports_football_rounds`; sin backfill. La validación puede recorrer referencias, duración no medida.
- **Apagar bandera:** conserva comentarios y borradores; las rutas Champions no los devuelven mientras esté apagado.

### 0033 — `sports_champions_switch.sql`

- **Orden de locks:** durante migración, lock explícito `SHARE ROW EXCLUSIVE` sobre `families`, luego inserta switches apagados. En runtime, las escrituras toman primero el lock compartido de la fila switch, después el partido; los importadores/resultados toman switch antes del advisory lock familiar y de los partidos en orden estable. Apagar toma lock exclusivo de switch y no espera partidos. El setter autentica familia/rol y bloquea switch, pero no partido. No encontré un camino partido→switch, así que no hay ciclo que cierre interbloqueo entre esos locks.
- **SQL dinámico por concatenación:** no.
- **Triggers eludibles:** una inserción de familia normal dispara el trigger que crea el switch apagado. Un superusuario/propietario puede deshabilitar triggers o replicar; la aplicación no puede. Una escritura SQL normal no puede saltarse el trigger.
- **Locks existentes / tiempo:** el lock de `families` dura desde el `LOCK TABLE` hasta que termina la migración; bloquea escrituras de familia durante el backfill completo de una fila por familia. Cantidad de familias y duración no medidas en producción. FKs también consultan `families`/`members`.
- **Apagar bandera:** solo cambia `enabled` y deja auditoría; no borra switches ni datos Champions. Las filas quedan preservadas.

### 0034 — `champions_suspended_resolution.sql`

- **Orden de locks:** la migración no bloquea familia, partido o switch. En runtime, la resolución bloquea el partido; no toma lock de switch en SQL de la migración. La ruta de aplicación comprueba la habilitación antes de la mutación y retiene el lock compartido de switch durante su transacción.
- **SQL dinámico por concatenación:** no.
- **Triggers eludibles:** no crea triggers. Una escritura privilegiada directa en la tabla de resoluciones puede saltarse la autorización/auditoría de la ruta; los roles Data API no tienen ese permiso.
- **Locks existentes / tiempo:** crea tabla vacía y valida FKs a `families`, `sports_events`, `members`; actualiza la función de tabla. No reescribe datos previos; validación sin duración medida.
- **Apagar bandera:** conserva las resoluciones y auditoría, sin exponerlas en lecturas Champions apagadas.

### 0035 — `champions_result_corrections.sql`

- **Orden de locks:** la migración no toma locks de familia, partido o switch. En runtime, el importador toma switch, advisory lock familiar y partidos de la jornada ordenados por ID; la corrección no vuelve a bloquear una elección ni toca partidos abiertos. No hay ruta de partido→switch.
- **SQL dinámico por concatenación:** no.
- **Triggers eludibles:** no crea triggers. Un dueño de base podría insertar filas de auditoría/corrección directamente y omitir la confirmación de API; los roles de aplicación no tienen acceso directo a esas tablas.
- **Locks existentes / tiempo:** crea tabla vacía y valida FKs a `families`, `sports_events`, `members`; no reescribe resultados previos. Sin duración medida.
- **Apagar bandera:** conserva resultados, historial de corrección y auditoría; no elimina datos.

### 0036 — `champions_managed_grants.sql`

- **Orden de locks:** no toma locks de familia, partido o switch; actualiza ACLs de objetos.
- **SQL dinámico por concatenación:** no concatena datos de usuario. Sí ejecuta SQL construido con `format()` sobre firmas (`regprocedure`), relaciones (`regclass`) y nombres de roles del catálogo.
- **Triggers eludibles:** no crea ni cambia triggers.
- **Locks existentes / tiempo:** toma locks de catálogo/ACL sobre funciones y tablas `sports_%` / `sports_football_%` y el switch; no bloquea filas de negocio ni hace backfill. Duración esperada corta, no medida.
- **Apagar bandera:** los permisos permanecen cerrados y todos los datos existentes se conservan.

### 0037 — `ufc_card_closure.sql` (UFC; estado en producción no verificado)

- **Orden de locks:** no toma locks de familia ni switch. La API de pronósticos, resultados y cambios de cartelera serializa por fila de evento UFC; triggers de pelea/resultado refrescan el cierre bloqueando su evento. No existe lock Champions en ese flujo.
- **SQL dinámico por concatenación:** no concatena entrada de usuario. El bloque de permisos usa `format()` con nombres de roles de `pg_roles`.
- **Triggers eludibles:** las protecciones de cierre siguen aplicándose a escrituras SQL normales, incluso directas. Dueño/superusuario y `session_replication_role=replica` pueden deshabilitarlas; las credenciales de aplicación no tienen esos privilegios.
- **Locks existentes / tiempo:** agrega columnas a `sports_events`/`sports_fights` (DDL con lock fuerte), instala/reemplaza triggers y recorre todas las filas `sports_events` de UFC para derivar horarios/cierres/transiciones. Las filas UFC actualizadas quedan bloqueadas durante ese backfill. No toca filas de pronósticos ni resultados. Volumen y tiempo real de producción no se consultaron desde esta tarea; el test usa datos sintéticos.
- **Apagar bandera Champions:** no apaga ni borra la función de cierre UFC ni sus columnas, cierres, elegibilidad, pronósticos o resultados.

**Conclusión del orden:** para Champions el orden de runtime comprobado es identidad de familia → switch compartido → partido (y, donde corresponda, advisory lock de familia antes de bloquear los partidos ordenados). El apagado espera el lock compartido y luego obtiene el exclusivo del switch; no intenta adquirir partido. Los endpoints de importación/resultados y las predicciones no adquieren el switch después de un partido. Esto descarta el ciclo de interbloqueo entre familia/partido/switch que se buscó en el código; no equivale a una garantía contra cualquier deadlock externo o SQL privilegiado.

## Controles transversales

- Todas las funciones SECDEF de 0027–0035 fijan `search_path = pg_catalog, public`. El helper inicial que recibía un ID arbitrario fue reemplazado en 0029 por uno que autentica token. El catálogo tras 0036 verifica que `PUBLIC`, `anon` y `authenticated` no ejecutan funciones deportivas. Permisos de propietario y service role son deliberados.
- La función de pronóstico devuelve solo `ownChoice` antes del cierre y `choices: []`; la tabla agrega elecciones solo de partidos completados con cierre. Las vistas previas de resultado/corrección nunca incluyen elecciones.
- Los triggers se ejecutan en la escritura de fila y materializan cierre comparando OLD antes de reemplazar horario/estado. Rutas revocan escritura directa a roles Data API. Superusuario y `session_replication_role=replica` pueden eludir triggers, pero no se entregan a usuarios de aplicación.
- Las migraciones crean columnas/tablas/índices. Excepciones literales a “sin DROP”: 0027/0028 reemplazan CHECK constraints y 0029 elimina la función insegura. 0027 normaliza exclusivamente UFC a categoría `NULL`; no reescribe elecciones ni resultados de River/UFC. DDL de `sports_events` requiere lock fuerte de ALTER TABLE; 0033 toma `SHARE ROW EXCLUSIVE` en `families`; FKs bloquean referencias para validación.
- Apagar la bandera no elimina identidades, elecciones, comentarios, cierres, resultados, resoluciones ni correcciones.

## Funciones SECURITY DEFINER y permisos efectivos esperados tras 0036

| Firma | search_path | Parámetro usuario/integrante | PUBLIC | anon | authenticated |
|---|---|---|---:|---:|---:|
| `sports_champions_enabled(uuid, boolean)` | `pg_catalog, public` | No | No | No | No |
| `sports_champions_family_created()` | `pg_catalog, public` | No (trigger) | No | No | No |
| `sports_champions_set_enabled(text, boolean)` | `pg_catalog, public` | No (token) | No | No | No |
| `sports_football_choice_view(public.sports_events, text)` | `pg_catalog, public` | No (token) | No | No | No |
| `sports_football_materialize_close(uuid, uuid, timestamptz, text)` | `pg_catalog, public` | No | No | No | No |
| `sports_football_predictions_api(text, uuid, text, text)` | `pg_catalog, public` | No (token) | No | No | No |
| `sports_football_preserve_close()` | `pg_catalog, public` | No (trigger) | No | No | No |
| `sports_football_round_table(text, uuid)` | `pg_catalog, public` | No (token) | No | No | No |
| `sports_football_session_actor(text)` | `pg_catalog, public` | No (token) | No | No | No |

Los permisos efectivos se verifican en la integración local. `permisos-check.sql` debe ejecutarse de nuevo contra producción después de migrar; este reporte no certifica una base de producción.

## SQL completo de las migraciones


### `0027_sports_champions_identity.sql`

```sql
CREATE TABLE "sports_football_event_sources" (
	"family_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"external_id" varchar(200) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_football_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"reference" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"original_from" date NOT NULL,
	"original_through" date NOT NULL,
	CONSTRAINT "sports_football_rounds_window" CHECK ("sports_football_rounds"."original_from" <= "sports_football_rounds"."original_through")
);
--> statement-breakpoint
CREATE TABLE "sports_football_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"competition" varchar(40) NOT NULL,
	"name" varchar(40) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_football_team_sources" (
	"family_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"external_id" varchar(200) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_football_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "football_category" varchar(16) DEFAULT 'river';
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "season_id" uuid;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "round_id" uuid;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "first_team_id" uuid;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "second_team_id" uuid;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "tie_reference" varchar(200);
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "next_round_id" uuid;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD COLUMN "next_slot" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_event_sources_reference_unique" ON "sports_football_event_sources" USING btree ("family_id","provider","external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_event_sources_provider_unique" ON "sports_football_event_sources" USING btree ("family_id","event_id","provider");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_rounds_family_id_unique" ON "sports_football_rounds" USING btree ("family_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_rounds_season_id_unique" ON "sports_football_rounds" USING btree ("family_id","season_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_rounds_reference_unique" ON "sports_football_rounds" USING btree ("family_id","season_id","reference");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_seasons_family_id_unique" ON "sports_football_seasons" USING btree ("family_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_seasons_name_unique" ON "sports_football_seasons" USING btree ("family_id","competition","name");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_team_sources_reference_unique" ON "sports_football_team_sources" USING btree ("family_id","provider","external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_team_sources_provider_unique" ON "sports_football_team_sources" USING btree ("family_id","team_id","provider");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_teams_family_id_unique" ON "sports_football_teams" USING btree ("family_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_teams_name_unique" ON "sports_football_teams" USING btree ("family_id","name");
--> statement-breakpoint
CREATE UNIQUE INDEX "sports_events_family_id_unique" ON "sports_events" USING btree ("family_id","id");
--> statement-breakpoint
CREATE INDEX "sports_events_family_category_date_idx" ON "sports_events" USING btree ("family_id","football_category","event_date");
--> statement-breakpoint
-- Column default preserves old football inserts. Normalize old UFC inserts too.
UPDATE sports_events SET football_category=NULL WHERE kind='ufc_card';
--> statement-breakpoint
CREATE FUNCTION sports_normalize_football_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'ufc_card' THEN NEW.football_category := NULL; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sports_events_football_category_default BEFORE INSERT ON sports_events
FOR EACH ROW EXECUTE FUNCTION sports_normalize_football_category();
--> statement-breakpoint
ALTER TABLE "sports_football_event_sources" ADD CONSTRAINT "sports_football_event_sources_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_event_sources" ADD CONSTRAINT "sports_event_sources_family_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."sports_events"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_rounds" ADD CONSTRAINT "sports_football_rounds_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_rounds" ADD CONSTRAINT "sports_rounds_family_season_fk" FOREIGN KEY ("family_id","season_id") REFERENCES "public"."sports_football_seasons"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_seasons" ADD CONSTRAINT "sports_football_seasons_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_team_sources" ADD CONSTRAINT "sports_football_team_sources_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_team_sources" ADD CONSTRAINT "sports_team_sources_family_team_fk" FOREIGN KEY ("family_id","team_id") REFERENCES "public"."sports_football_teams"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_football_teams" ADD CONSTRAINT "sports_football_teams_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_family_season_fk" FOREIGN KEY ("family_id","season_id") REFERENCES "public"."sports_football_seasons"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_family_round_fk" FOREIGN KEY ("family_id","round_id") REFERENCES "public"."sports_football_rounds"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_round_season_fk" FOREIGN KEY ("family_id","season_id","round_id") REFERENCES "public"."sports_football_rounds"("family_id","season_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_first_team_fk" FOREIGN KEY ("family_id","first_team_id") REFERENCES "public"."sports_football_teams"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_second_team_fk" FOREIGN KEY ("family_id","second_team_id") REFERENCES "public"."sports_football_teams"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_next_round_fk" FOREIGN KEY ("family_id","next_round_id") REFERENCES "public"."sports_football_rounds"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_football_category" CHECK (("sports_events"."kind" = 'football_match' AND "sports_events"."football_category" IS NOT NULL AND "sports_events"."football_category" IN ('river','champions')) OR ("sports_events"."kind" = 'ufc_card' AND "sports_events"."football_category" IS NULL));
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_champions_shape" CHECK ("sports_events"."football_category" IS DISTINCT FROM 'champions' OR ("sports_events"."season_id" IS NOT NULL AND "sports_events"."round_id" IS NOT NULL AND "sports_events"."first_team_id" IS NOT NULL AND "sports_events"."second_team_id" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_football_metadata" CHECK ("sports_events"."kind" = 'football_match' OR ("sports_events"."season_id" IS NULL AND "sports_events"."round_id" IS NULL AND "sports_events"."first_team_id" IS NULL AND "sports_events"."second_team_id" IS NULL AND "sports_events"."tie_reference" IS NULL AND "sports_events"."next_round_id" IS NULL AND "sports_events"."next_slot" IS NULL));
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_distinct_teams" CHECK ("sports_events"."first_team_id" IS NULL OR "sports_events"."second_team_id" IS NULL OR "sports_events"."first_team_id" <> "sports_events"."second_team_id");
--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_next_slot" CHECK ("sports_events"."next_slot" IS NULL OR ("sports_events"."next_slot" > 0 AND "sports_events"."next_round_id" IS NOT NULL));
--> statement-breakpoint
-- Preserve provider identities without changing legacy identifiers or payloads.
INSERT INTO sports_football_event_sources(family_id,event_id,provider,external_id)
SELECT family_id,id,source_provider,external_reference FROM sports_events
WHERE kind='football_match' AND source_provider IS NOT NULL AND external_reference IS NOT NULL;
--> statement-breakpoint
-- Keep the legacy provider pair and the multi-provider identity map in sync.
CREATE FUNCTION sports_sync_football_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'football_match' AND NEW.source_provider IS NOT NULL AND NEW.external_reference IS NOT NULL THEN
    INSERT INTO sports_football_event_sources(family_id,event_id,provider,external_id)
    VALUES(NEW.family_id,NEW.id,NEW.source_provider,NEW.external_reference)
    ON CONFLICT(family_id,event_id,provider) DO UPDATE SET external_id=excluded.external_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sports_events_source_identity AFTER INSERT OR UPDATE OF source_provider, external_reference ON sports_events
FOR EACH ROW EXECUTE FUNCTION sports_sync_football_source();

```

### `0028_sports_football_predictions.sql`

```sql
CREATE TABLE "sports_football_closures" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"closed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_football_predictions" (
	"event_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"choice" varchar(4) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_football_predictions_choice" CHECK ("sports_football_predictions"."choice" IN ('home','draw','away'))
);
--> statement-breakpoint
ALTER TABLE "sports_events" DROP CONSTRAINT "sports_events_status";--> statement-breakpoint
ALTER TABLE "sports_football_closures" ADD CONSTRAINT "sports_football_closures_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_closures" ADD CONSTRAINT "sports_football_closures_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."sports_events"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_predictions" ADD CONSTRAINT "sports_football_predictions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_predictions" ADD CONSTRAINT "sports_football_predictions_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."sports_events"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_predictions" ADD CONSTRAINT "sports_football_predictions_member_fk" FOREIGN KEY ("member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_predictions_member_event_unique" ON "sports_football_predictions" USING btree ("event_id","member_id");--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_status" CHECK ("sports_events"."status" IN ('scheduled', 'postponed', 'completed', 'cancelled') OR ("sports_events"."football_category" IS NOT DISTINCT FROM 'champions' AND "sports_events"."status" = 'suspended'));--> statement-breakpoint
-- The only time comparison used by reads and final writes. Equality is closed.
-- p_now is internal; the public session API never accepts a caller-supplied clock.
CREATE FUNCTION public.sports_football_choice_open(p_start timestamptz, p_closed timestamptz, p_status text, p_now timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT p_start IS NOT NULL AND p_closed IS NULL AND p_status = 'scheduled' AND p_now < p_start;
$$;
--> statement-breakpoint
CREATE FUNCTION public.sports_football_materialize_close(p_family uuid, p_event uuid, p_start timestamptz, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_now timestamptz := clock_timestamp();
BEGIN
  IF (p_start IS NOT NULL AND p_start <= v_now) OR p_status IN ('suspended','completed','cancelled') THEN
    INSERT INTO public.sports_football_closures(family_id,event_id,closed_at)
    VALUES(p_family,p_event,CASE WHEN p_start IS NOT NULL THEN LEAST(p_start,v_now) ELSE v_now END)
    ON CONFLICT(event_id) DO NOTHING;
  END IF;
END;
$$;
--> statement-breakpoint
-- Every schedule/status update closes against OLD before it can replace the deadline.
-- This also works without any reads between kickoff and a later postponement.
CREATE FUNCTION public.sports_football_preserve_close()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.kind = 'football_match' AND OLD.football_category = 'champions' THEN
    PERFORM public.sports_football_materialize_close(OLD.family_id,OLD.id,OLD.starts_at,OLD.status);
    IF ROW(NEW.id,NEW.family_id,NEW.kind,NEW.football_category,NEW.season_id,NEW.round_id,NEW.first_team_id,NEW.second_team_id)
       IS DISTINCT FROM ROW(OLD.id,OLD.family_id,OLD.kind,OLD.football_category,OLD.season_id,OLD.round_id,OLD.first_team_id,OLD.second_team_id)
       AND (EXISTS(SELECT 1 FROM public.sports_football_predictions WHERE event_id=OLD.id)
            OR EXISTS(SELECT 1 FROM public.sports_football_closures WHERE event_id=OLD.id)) THEN
      RAISE EXCEPTION 'No se puede cambiar la identidad de un partido con elecciones o cierre.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.kind = 'football_match' AND NEW.football_category = 'champions' THEN
    PERFORM public.sports_football_materialize_close(NEW.family_id,NEW.id,NEW.starts_at,NEW.status);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sports_events_preserve_football_close BEFORE UPDATE ON public.sports_events
FOR EACH ROW EXECUTE FUNCTION public.sports_football_preserve_close();
--> statement-breakpoint
-- Resolve identity from an unexpired real Better Auth session, not caller-provided IDs.
CREATE FUNCTION public.sports_football_session_actor(p_token text)
RETURNS TABLE(family_id uuid, member_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY SELECT m.family_id,m.id FROM public.session s
    JOIN public.member_devices d ON d.auth_user_id=s.user_id
    JOIN public.members m ON m.id=d.member_id
    WHERE s.token=p_token AND s.expires_at>clock_timestamp()
      AND d.revoked_at IS NULL AND m.archived_at IS NULL
    FOR SHARE OF s,d,m;
END;
$$;
--> statement-breakpoint
-- The database builds the response. Before closure, it never reads other choices
-- into the response and never returns counts of other members' participation.
CREATE FUNCTION public.sports_football_choice_view(p_event public.sports_events, p_member uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_closed timestamptz; v_own text; v_choices jsonb := '[]'::jsonb;
BEGIN
  SELECT closed_at INTO v_closed FROM public.sports_football_closures WHERE event_id=p_event.id;
  SELECT choice INTO v_own FROM public.sports_football_predictions WHERE event_id=p_event.id AND member_id=p_member;
  IF v_closed IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('memberId',p.member_id,'name',m.name,'choice',p.choice) ORDER BY p.member_id),'[]'::jsonb)
      INTO v_choices FROM public.sports_football_predictions p JOIN public.members m ON m.id=p.member_id AND m.family_id=p.family_id
      WHERE p.event_id=p_event.id AND p.family_id=p_event.family_id;
  END IF;
  RETURN jsonb_build_object('eventId',p_event.id,'closesAt',COALESCE(v_closed,p_event.starts_at),
    'closed',v_closed IS NOT NULL,
    'canPredict',public.sports_football_choice_open(p_event.starts_at,v_closed,p_event.status,clock_timestamp())
      AND p_event.first_team_id IS NOT NULL AND p_event.second_team_id IS NOT NULL
      AND length(btrim(p_event.first_participant))>0 AND length(btrim(p_event.second_participant))>0,
    'ownChoice',v_own,'choices',v_choices);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.sports_football_predictions_api(p_token text, p_event uuid, p_action text DEFAULT 'read', p_choice text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor record; v_event public.sports_events; v_closed timestamptz;
  v_before text; v_changed boolean := false;
BEGIN
  SELECT * INTO v_actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'data',jsonb_build_object('error','Ingresá a tu familia.')); END IF;
  SELECT * INTO v_event FROM public.sports_events WHERE id=p_event AND family_id=v_actor.family_id
    AND kind='football_match' AND football_category='champions' AND hidden=false AND source_absent_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'data',jsonb_build_object('error','No encontramos este partido.')); END IF;
  PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
  IF p_action IS NULL OR p_action NOT IN ('read','put','delete') OR (p_action='put' AND (p_choice IS NULL OR p_choice NOT IN ('home','draw','away'))) THEN
    RETURN jsonb_build_object('status',400,'data',jsonb_build_object('error','Pronóstico inválido.'));
  END IF;
  IF p_action <> 'read' THEN
    SELECT closed_at INTO v_closed FROM public.sports_football_closures WHERE event_id=p_event;
    IF NOT public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      OR v_event.first_team_id IS NULL OR v_event.second_team_id IS NULL
      OR length(btrim(v_event.first_participant))=0 OR length(btrim(v_event.second_participant))=0 THEN
      RETURN jsonb_build_object('status',409,'data',jsonb_build_object('error','El partido no admite cambios de pronóstico.'));
    END IF;
    SELECT choice INTO v_before FROM public.sports_football_predictions WHERE event_id=p_event AND member_id=v_actor.member_id;
    IF p_action='put' THEN
      INSERT INTO public.sports_football_predictions(family_id,event_id,member_id,choice)
      SELECT v_actor.family_id,p_event,v_actor.member_id,p_choice
      WHERE public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      ON CONFLICT(event_id,member_id) DO UPDATE SET choice=excluded.choice,updated_at=clock_timestamp()
      WHERE public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      RETURNING true INTO v_changed;
    ELSE
      DELETE FROM public.sports_football_predictions WHERE event_id=p_event AND member_id=v_actor.member_id
        AND public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      RETURNING true INTO v_changed;
    END IF;
    IF NOT COALESCE(v_changed,false) AND (p_action='put' OR v_before IS NOT NULL OR NOT public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())) THEN
      PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
      RETURN jsonb_build_object('status',409,'data',jsonb_build_object('error','El partido no admite cambios de pronóstico.'));
    END IF;
    IF (p_action='put' AND v_before IS DISTINCT FROM p_choice) OR (p_action='delete' AND v_before IS NOT NULL) THEN
      INSERT INTO public.audit_events(family_id,actor_member_id,entity_type,entity_id,action,"after")
      VALUES(v_actor.family_id,v_actor.member_id,'sports_football_prediction',p_event,
        CASE WHEN p_action='delete' THEN 'deleted' WHEN v_before IS NULL THEN 'saved' ELSE 'changed' END,
        jsonb_build_object('eventId',p_event));
    END IF;
  END IF;
  -- A read or a successful mutation may have crossed kickoff; persist before disclosure.
  PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
  RETURN jsonb_build_object('status',200,'data',public.sports_football_choice_view(v_event,v_actor.member_id));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON public.sports_football_predictions, public.sports_football_closures FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sports_football_choice_open(timestamptz,timestamptz,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sports_football_materialize_close(uuid,uuid,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sports_football_preserve_close() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sports_football_session_actor(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sports_football_choice_view(public.sports_events,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) TO PUBLIC;

```

### `0029_sports_football_function_access.sql`

```sql
-- Access is for the trusted application database owner, never PUBLIC/anon.
-- Non-owner runtime roles must receive an explicit grant to the session API.
REVOKE ALL ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.sports_football_choice_view(p_event public.sports_events, p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_closed timestamptz; v_own text; v_choices jsonb := '[]'::jsonb; v_actor record;
BEGIN
  SELECT * INTO v_actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND OR v_actor.family_id <> p_event.family_id THEN RETURN NULL; END IF;
  SELECT closed_at INTO v_closed FROM public.sports_football_closures WHERE event_id=p_event.id;
  SELECT choice INTO v_own FROM public.sports_football_predictions WHERE event_id=p_event.id AND member_id=v_actor.member_id;
  IF v_closed IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('memberId',p.member_id,'name',m.name,'choice',p.choice) ORDER BY p.member_id),'[]'::jsonb)
      INTO v_choices FROM public.sports_football_predictions p JOIN public.members m ON m.id=p.member_id AND m.family_id=p.family_id
      WHERE p.event_id=p_event.id AND p.family_id=p_event.family_id;
  END IF;
  RETURN jsonb_build_object('eventId',p_event.id,'closesAt',COALESCE(v_closed,p_event.starts_at),
    'closed',v_closed IS NOT NULL,
    'canPredict',public.sports_football_choice_open(p_event.starts_at,v_closed,p_event.status,clock_timestamp())
      AND p_event.first_team_id IS NOT NULL AND p_event.second_team_id IS NOT NULL
      AND length(btrim(p_event.first_participant))>0 AND length(btrim(p_event.second_participant))>0,
    'ownChoice',v_own,'choices',v_choices);
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_football_predictions_api(p_token text, p_event uuid, p_action text DEFAULT 'read', p_choice text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor record; v_event public.sports_events; v_closed timestamptz;
  v_view jsonb; v_before text; v_changed boolean := false;
BEGIN
  SELECT * INTO v_actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'data',jsonb_build_object('error','Ingresá a tu familia.')); END IF;
  SELECT * INTO v_event FROM public.sports_events WHERE id=p_event AND family_id=v_actor.family_id
    AND kind='football_match' AND football_category='champions' AND hidden=false AND source_absent_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'data',jsonb_build_object('error','No encontramos este partido.')); END IF;
  PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
  IF p_action IS NULL OR p_action NOT IN ('read','put','delete') OR (p_action='put' AND (p_choice IS NULL OR p_choice NOT IN ('home','draw','away'))) THEN
    RETURN jsonb_build_object('status',400,'data',jsonb_build_object('error','Pronóstico inválido.'));
  END IF;
  IF p_action <> 'read' THEN
    SELECT closed_at INTO v_closed FROM public.sports_football_closures WHERE event_id=p_event;
    IF NOT public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      OR v_event.first_team_id IS NULL OR v_event.second_team_id IS NULL
      OR length(btrim(v_event.first_participant))=0 OR length(btrim(v_event.second_participant))=0 THEN
      RETURN jsonb_build_object('status',409,'data',jsonb_build_object('error','El partido no admite cambios de pronóstico.'));
    END IF;
    SELECT choice INTO v_before FROM public.sports_football_predictions WHERE event_id=p_event AND member_id=v_actor.member_id;
    IF p_action='put' THEN
      INSERT INTO public.sports_football_predictions(family_id,event_id,member_id,choice)
      SELECT v_actor.family_id,p_event,v_actor.member_id,p_choice
      WHERE public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      ON CONFLICT(event_id,member_id) DO UPDATE SET choice=excluded.choice,updated_at=clock_timestamp()
      WHERE public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      RETURNING true INTO v_changed;
    ELSE
      DELETE FROM public.sports_football_predictions WHERE event_id=p_event AND member_id=v_actor.member_id
        AND public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      RETURNING true INTO v_changed;
    END IF;
    IF NOT COALESCE(v_changed,false) AND (p_action='put' OR v_before IS NOT NULL OR NOT public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())) THEN
      PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
      RETURN jsonb_build_object('status',409,'data',jsonb_build_object('error','El partido no admite cambios de pronóstico.'));
    END IF;
    IF (p_action='put' AND v_before IS DISTINCT FROM p_choice) OR (p_action='delete' AND v_before IS NOT NULL) THEN
      INSERT INTO public.audit_events(family_id,actor_member_id,entity_type,entity_id,action,"after")
      VALUES(v_actor.family_id,v_actor.member_id,'sports_football_prediction',p_event,
        CASE WHEN p_action='delete' THEN 'deleted' WHEN v_before IS NULL THEN 'saved' ELSE 'changed' END,
        jsonb_build_object('eventId',p_event));
    END IF;
  END IF;
  -- A read or a successful mutation may have crossed kickoff; persist before disclosure.
  PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
  v_view := public.sports_football_choice_view(v_event,p_token);
  IF v_view IS NULL THEN RETURN jsonb_build_object('status',403,'data',jsonb_build_object('error','Ingresá a tu familia.')); END IF;
  RETURN jsonb_build_object('status',200,'data',v_view);
END;
$$;

--> statement-breakpoint
DROP FUNCTION public.sports_football_choice_view(public.sports_events,uuid);
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_football_choice_view(public.sports_events,text) FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE v_function record;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    FOR v_function IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'sports_football_%' AND p.prosecdef
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',v_function.signature);
    END LOOP;
  END IF;
END;
$$;

```

### `0030_sports_function_defaults.sql`

```sql
-- PostgreSQL grants function EXECUTE to PUBLIC globally by default; a schema-only
-- REVOKE cannot subtract that global grant. Apply to this migration owner, also
-- the owner required for subsequent migrations. Existing unrelated ACLs stay intact.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE f record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM anon';
  END IF;
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'sports\_%' ESCAPE '\'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC',f.signature);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon',f.signature);
    END IF;
  END LOOP;
END $$;

```

### `0031_sports_champions_results.sql`

```sql
-- Only this session-based function aggregates predictions. Open matches never
-- participate in totals, standings or the public results collection.
CREATE FUNCTION public.sports_football_round_table(p_token text, p_round uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor record; resolved integer; total integer; scores jsonb; standings jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'data',jsonb_build_object('error','Ingresá a tu familia.')); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sports_football_rounds r JOIN public.sports_football_seasons s ON s.id=r.season_id AND s.family_id=r.family_id WHERE r.id=p_round AND r.family_id=actor.family_id AND s.competition='champions') THEN
    RETURN jsonb_build_object('status',404,'data',jsonb_build_object('error','No encontramos esta jornada.'));
  END IF;
  SELECT count(*) INTO total FROM public.sports_events e WHERE e.round_id=p_round AND e.family_id=actor.family_id AND e.football_category='champions' AND NOT e.hidden AND e.source_absent_at IS NULL AND e.status<>'cancelled';
  SELECT count(*),COALESCE(jsonb_agg(jsonb_build_object('eventId',e.id,'homeGoals',r.home_goals,'awayGoals',r.away_goals,'source',r.source,'checkedAt',r.checked_at) ORDER BY e.id),'[]'::jsonb)
    INTO resolved,scores FROM public.sports_events e
    JOIN public.sports_football_results r ON r.event_id=e.id AND r.family_id=e.family_id
    JOIN public.sports_football_closures c ON c.event_id=e.id AND c.family_id=e.family_id
    WHERE e.round_id=p_round AND e.family_id=actor.family_id AND e.football_category='champions' AND NOT e.hidden AND e.source_absent_at IS NULL AND e.status='completed' AND c.closed_at<=clock_timestamp();
  IF resolved>0 THEN
    WITH points AS (
      SELECT m.id,m.name,COALESCE(sum(CASE WHEN p.choice=CASE WHEN r.home_goals>r.away_goals THEN 'home' WHEN r.home_goals<r.away_goals THEN 'away' ELSE 'draw' END THEN 1 ELSE 0 END),0)::integer AS points
      FROM public.members m
      LEFT JOIN (public.sports_football_predictions p
        JOIN public.sports_events e ON e.id=p.event_id AND e.family_id=p.family_id AND e.round_id=p_round AND e.football_category='champions' AND NOT e.hidden AND e.source_absent_at IS NULL AND e.status='completed'
        JOIN public.sports_football_results r ON r.event_id=e.id AND r.family_id=e.family_id
        JOIN public.sports_football_closures c ON c.event_id=e.id AND c.family_id=e.family_id AND c.closed_at<=clock_timestamp())
        ON p.member_id=m.id AND p.family_id=m.family_id
      WHERE m.family_id=actor.family_id AND m.archived_at IS NULL GROUP BY m.id,m.name
    ), ranked AS (SELECT id,name,points,rank() OVER(ORDER BY points DESC)::integer AS position FROM points)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('memberId',id,'name',name,'points',points,'position',position) ORDER BY position,name,id),'[]'::jsonb) INTO standings FROM ranked;
  END IF;
  RETURN jsonb_build_object('status',200,'data',jsonb_build_object('roundId',p_round,'partial',resolved<total,'resolvedMatches',resolved,'totalMatches',total,'standings',standings,'results',scores));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_football_round_table(text,uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.sports_football_round_table(text,uuid) FROM anon;
  END IF;
END $$;

```

### `0032_sports_champions_round_comments.sql`

```sql
CREATE TABLE "sports_football_round_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"body" varchar(2000) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"retired_at" timestamp with time zone,
	"retired_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_round_comments_body_length" CHECK (char_length(btrim("sports_football_round_comments"."body")) BETWEEN 1 AND 2000),
	CONSTRAINT "sports_round_comments_version" CHECK ("sports_football_round_comments"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "sports_football_round_comments" ADD CONSTRAINT "sports_football_round_comments_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_round_comments" ADD CONSTRAINT "sports_football_round_comments_retired_by_member_id_members_id_fk" FOREIGN KEY ("retired_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_round_comments" ADD CONSTRAINT "sports_round_comments_family_round_fk" FOREIGN KEY ("family_id","round_id") REFERENCES "public"."sports_football_rounds"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_round_comments" ADD CONSTRAINT "sports_round_comments_family_author_fk" FOREIGN KEY ("family_id","author_member_id") REFERENCES "public"."members"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sports_round_comments_thread_created_idx" ON "sports_football_round_comments" USING btree ("family_id","round_id","created_at","id");
```

### `0033_sports_champions_switch.sql`

```sql
CREATE TABLE "sports_champions_switches" (
	"family_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by_member_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sports_champions_switches" ADD CONSTRAINT "sports_champions_switches_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_champions_switches" ADD CONSTRAINT "sports_champions_switches_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
LOCK TABLE public.families IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO public.sports_champions_switches(family_id,enabled) SELECT id,false FROM public.families ON CONFLICT(family_id) DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION public.sports_champions_family_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.sports_champions_switches(family_id,enabled) VALUES(NEW.id,false) ON CONFLICT(family_id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sports_champions_switch_default AFTER INSERT ON public.families
FOR EACH ROW EXECUTE FUNCTION public.sports_champions_family_created();
--> statement-breakpoint
--> statement-breakpoint
REVOKE ALL ON public.sports_champions_switches FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.sports_champions_enabled(p_family uuid, p_lock boolean DEFAULT true)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_enabled boolean;
BEGIN
  IF p_lock THEN
    SELECT enabled INTO v_enabled FROM public.sports_champions_switches WHERE family_id=p_family FOR SHARE;
  ELSE
    SELECT enabled INTO v_enabled FROM public.sports_champions_switches WHERE family_id=p_family;
  END IF;
  RETURN COALESCE(v_enabled,false);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.sports_champions_set_enabled(p_token text, p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor record; v_role text;
BEGIN
  SELECT * INTO v_actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Ingresá a tu familia.' USING ERRCODE='42501'; END IF;
  SELECT role INTO v_role FROM public.members WHERE id=v_actor.member_id AND family_id=v_actor.family_id AND archived_at IS NULL FOR SHARE;
  IF v_role IS DISTINCT FROM 'administrator' THEN RAISE EXCEPTION 'Solo administración puede cambiar el interruptor.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.sports_champions_switches WHERE family_id=v_actor.family_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No encontramos el interruptor de esta familia.' USING ERRCODE='P0002'; END IF;
  UPDATE public.sports_champions_switches SET enabled=p_enabled,updated_by_member_id=v_actor.member_id,updated_at=clock_timestamp() WHERE family_id=v_actor.family_id;
  INSERT INTO public.audit_events(family_id,actor_member_id,entity_type,entity_id,action,"after")
  VALUES(v_actor.family_id,v_actor.member_id,'sports_champions_switch',v_actor.family_id,CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END,jsonb_build_object('enabled',p_enabled));
  RETURN p_enabled;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_football_predictions_api(p_token text, p_event uuid, p_action text DEFAULT 'read', p_choice text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor record; v_event public.sports_events; v_closed timestamptz;
  v_before text; v_changed boolean := false;
BEGIN
  SELECT * INTO v_actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'data',jsonb_build_object('error','Ingresá a tu familia.')); END IF;
  IF NOT public.sports_champions_enabled(v_actor.family_id,true) THEN
    RETURN jsonb_build_object('status',404,'data',jsonb_build_object('error','No encontrado.'));
  END IF;
  SELECT * INTO v_event FROM public.sports_events WHERE id=p_event AND family_id=v_actor.family_id
    AND kind='football_match' AND football_category='champions' AND hidden=false AND source_absent_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'data',jsonb_build_object('error','No encontramos este partido.')); END IF;
  PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
  IF p_action IS NULL OR p_action NOT IN ('read','put','delete') OR (p_action='put' AND (p_choice IS NULL OR p_choice NOT IN ('home','draw','away'))) THEN
    RETURN jsonb_build_object('status',400,'data',jsonb_build_object('error','Pronóstico inválido.'));
  END IF;
  IF p_action <> 'read' THEN
    SELECT closed_at INTO v_closed FROM public.sports_football_closures WHERE event_id=p_event;
    IF NOT public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      OR v_event.first_team_id IS NULL OR v_event.second_team_id IS NULL
      OR length(btrim(v_event.first_participant))=0 OR length(btrim(v_event.second_participant))=0 THEN
      RETURN jsonb_build_object('status',409,'data',jsonb_build_object('error','El partido no admite cambios de pronóstico.'));
    END IF;
    SELECT choice INTO v_before FROM public.sports_football_predictions WHERE event_id=p_event AND member_id=v_actor.member_id;
    IF p_action='put' THEN
      INSERT INTO public.sports_football_predictions(family_id,event_id,member_id,choice)
      SELECT v_actor.family_id,p_event,v_actor.member_id,p_choice
      WHERE public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      ON CONFLICT(event_id,member_id) DO UPDATE SET choice=excluded.choice,updated_at=clock_timestamp()
      WHERE public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      RETURNING true INTO v_changed;
    ELSE
      DELETE FROM public.sports_football_predictions WHERE event_id=p_event AND member_id=v_actor.member_id
        AND public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      RETURNING true INTO v_changed;
    END IF;
    IF NOT COALESCE(v_changed,false) AND (p_action='put' OR v_before IS NOT NULL OR NOT public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())) THEN
      PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
      RETURN jsonb_build_object('status',409,'data',jsonb_build_object('error','El partido no admite cambios de pronóstico.'));
    END IF;
    IF (p_action='put' AND v_before IS DISTINCT FROM p_choice) OR (p_action='delete' AND v_before IS NOT NULL) THEN
      INSERT INTO public.audit_events(family_id,actor_member_id,entity_type,entity_id,action,"after")
      VALUES(v_actor.family_id,v_actor.member_id,'sports_football_prediction',p_event,
        CASE WHEN p_action='delete' THEN 'deleted' WHEN v_before IS NULL THEN 'saved' ELSE 'changed' END,
        jsonb_build_object('eventId',p_event));
    END IF;
  END IF;
  PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
  RETURN jsonb_build_object('status',200,'data',public.sports_football_choice_view(v_event,p_token));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_champions_enabled(uuid,boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_champions_set_enabled(text,boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_champions_family_created() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.sports_champions_enabled(uuid,boolean) FROM anon;
    REVOKE ALL ON FUNCTION public.sports_champions_set_enabled(text,boolean) FROM anon;
    REVOKE ALL ON FUNCTION public.sports_champions_family_created() FROM anon;
    REVOKE ALL ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) FROM anon;
    REVOKE ALL ON public.sports_champions_switches FROM anon;
  END IF;
END $$;

```

### `0034_champions_suspended_resolution.sql`

```sql
CREATE TABLE "sports_football_resolutions" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"reason" varchar(500),
	"source" varchar(1000),
	"actor_member_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_football_resolutions_shape" CHECK (("sports_football_resolutions"."kind" = 'official_result' AND "sports_football_resolutions"."reason" IS NULL AND "sports_football_resolutions"."source" IS NOT NULL) OR ("sports_football_resolutions"."kind" = 'void_for_prode' AND length(btrim("sports_football_resolutions"."reason")) > 0 AND "sports_football_resolutions"."source" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "sports_football_resolutions" ADD CONSTRAINT "sports_football_resolutions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_resolutions" ADD CONSTRAINT "sports_football_resolutions_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."sports_events"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_resolutions" ADD CONSTRAINT "sports_football_resolutions_actor_fk" FOREIGN KEY ("actor_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_football_round_table(p_token text, p_round uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor record; resolved integer; total integer; scores jsonb; standings jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'data',jsonb_build_object('error','Ingresá a tu familia.')); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sports_football_rounds r JOIN public.sports_football_seasons s ON s.id=r.season_id AND s.family_id=r.family_id WHERE r.id=p_round AND r.family_id=actor.family_id AND s.competition='champions') THEN
    RETURN jsonb_build_object('status',404,'data',jsonb_build_object('error','No encontramos esta jornada.'));
  END IF;
  SELECT count(*) INTO total FROM public.sports_events e
    WHERE e.round_id=p_round AND e.family_id=actor.family_id AND e.football_category='champions' AND NOT e.hidden AND e.source_absent_at IS NULL AND e.status<>'cancelled'
      AND NOT EXISTS(SELECT 1 FROM public.sports_football_resolutions x WHERE x.event_id=e.id AND x.family_id=e.family_id AND x.kind='void_for_prode');
  SELECT count(*),COALESCE(jsonb_agg(jsonb_build_object('eventId',e.id,'homeGoals',r.home_goals,'awayGoals',r.away_goals,'source',r.source,'checkedAt',r.checked_at) ORDER BY e.id),'[]'::jsonb)
    INTO resolved,scores FROM public.sports_events e
    JOIN public.sports_football_results r ON r.event_id=e.id AND r.family_id=e.family_id
    JOIN public.sports_football_closures c ON c.event_id=e.id AND c.family_id=e.family_id
    WHERE e.round_id=p_round AND e.family_id=actor.family_id AND e.football_category='champions' AND NOT e.hidden AND e.source_absent_at IS NULL AND e.status='completed' AND c.closed_at<=clock_timestamp();
  IF resolved>0 THEN
    WITH points AS (
      SELECT m.id,m.name,COALESCE(sum(CASE WHEN p.choice=CASE WHEN r.home_goals>r.away_goals THEN 'home' WHEN r.home_goals<r.away_goals THEN 'away' ELSE 'draw' END THEN 1 ELSE 0 END),0)::integer AS points
      FROM public.members m
      LEFT JOIN (public.sports_football_predictions p
        JOIN public.sports_events e ON e.id=p.event_id AND e.family_id=p.family_id AND e.round_id=p_round AND e.football_category='champions' AND NOT e.hidden AND e.source_absent_at IS NULL AND e.status='completed'
        JOIN public.sports_football_results r ON r.event_id=e.id AND r.family_id=e.family_id
        JOIN public.sports_football_closures c ON c.event_id=e.id AND c.family_id=e.family_id AND c.closed_at<=clock_timestamp())
        ON p.member_id=m.id AND p.family_id=m.family_id
      WHERE m.family_id=actor.family_id AND m.archived_at IS NULL GROUP BY m.id,m.name
    ), ranked AS (SELECT id,name,points,rank() OVER(ORDER BY points DESC)::integer AS position FROM points)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('memberId',id,'name',name,'points',points,'position',position) ORDER BY position,name,id),'[]'::jsonb) INTO standings FROM ranked;
  END IF;
  RETURN jsonb_build_object('status',200,'data',jsonb_build_object('roundId',p_round,'partial',resolved<total,'resolvedMatches',resolved,'totalMatches',total,'standings',standings,'results',scores));
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_football_round_table(text,uuid) FROM PUBLIC;--> statement-breakpoint
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON FUNCTION public.sports_football_round_table(text,uuid) FROM anon; END IF; END $$;

```

### `0035_champions_result_corrections.sql`

```sql
CREATE TABLE "sports_football_result_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"previous_home_goals" integer NOT NULL,
	"previous_away_goals" integer NOT NULL,
	"new_home_goals" integer NOT NULL,
	"new_away_goals" integer NOT NULL,
	"previous_source" varchar(1000) NOT NULL,
	"new_source" varchar(1000) NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"actor_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_football_result_corrections_score" CHECK ("sports_football_result_corrections"."previous_home_goals" >= 0 AND "sports_football_result_corrections"."previous_away_goals" >= 0 AND "sports_football_result_corrections"."new_home_goals" >= 0 AND "sports_football_result_corrections"."new_away_goals" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sports_football_result_corrections" ADD CONSTRAINT "sports_football_result_corrections_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_result_corrections" ADD CONSTRAINT "sports_football_result_corrections_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."sports_events"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_result_corrections" ADD CONSTRAINT "sports_football_result_corrections_actor_fk" FOREIGN KEY ("actor_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;
```

### `0036_champions_managed_grants.sql`

```sql
-- Close managed-Postgres default grants for Champions' server-only API and data.
-- Default ACLs apply only to the role executing this migration; production must
-- also check/revoke ACLs for a different migration owner (see runbook).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
DO $lockdown$
DECLARE
  f record;
  t record;
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
    END IF;
  END LOOP;

  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'sports\_%' ESCAPE '\'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', f.signature);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I', f.signature, role_name);
      END IF;
    END LOOP;
  END LOOP;

  FOR t IN
    SELECT c.oid::regclass AS relation
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND (c.relname LIKE 'sports\_football\_%' ESCAPE '\' OR c.relname = 'sports_champions_switches')
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC', t.relation);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM %I', t.relation, role_name);
      END IF;
    END LOOP;
  END LOOP;
END
$lockdown$;

```
