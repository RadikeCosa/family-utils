# Diferencias de `champions-sobre-produccion` frente a producción

La base operativa confirmada para este candidato es 0000–0026 más 0037, cuyo hash SHA-256 es `4d508cf9c2e6acbe5ac2860cdc8b60b4c7ceee927a675b114727baa49966c96a` y `when=1792046402706`. El usuario informó que el código del despliegue CLI `dpl_FbQmLAJYdz8vSq4oiNU9UWuWpocY` otorga 1 punto por acierto; la fuente inspeccionada en Vercel muestra `ufcRanking` sumando `+1`. No se obtuvo un SHA de Git del despliegue, por lo que `b2051b7d235320d6034d277df99afc3b5f2fe9a4` se usa como base provisional.

## Diff estadístico de archivos compartidos/no-Champions

Se excluyen artefactos de migración, rutas/componentes/lógica exclusivos de Champions, pruebas y documentación. El resumen se obtuvo con este filtro:

```sh
git diff --stat b2051b7 champions-sobre-produccion -- . \
  ':(exclude)drizzle/**' ':(exclude)tests/**' ':(exclude)**/*.test.*' \
  ':(exclude)sources/**' ':(exclude)src/lib/sports/champions*' \
  ':(exclude)src/lib/sports/football-predictions-server.ts' \
  ':(exclude)src/app/api/sports/champions/**' \
  ':(exclude)src/app/deportes/Champions*' \
  ':(exclude)playwright.champions.config.ts'
```

Salida:

```text
 .env.example                       |   1 +
 .github/workflows/ci.yml           |   1 +
 package.json                       |   7 +-
 playwright.a11y.config.ts          |   9 +-
 playwright.config.ts               |  16 ++-
 playwright.sports-next.config.ts   |   5 +-
 scripts/verificar-todo.sh          | 226 +++++++++++++++++++++++++++++++++++++
 src/app/deportes/AgendaApp.tsx     |  21 +++-
 src/app/deportes/Comments.tsx      |  43 ++++---
 src/app/deportes/agenda.module.css |  22 ++++
 src/app/deportes/page.tsx          |  19 +++-
 src/db/schema.ts                   | 166 ++++++++++++++++++++++++++-
 src/lib/sports/config.ts           |   4 +
 src/lib/sports/import-rules.ts     |   1 +
 src/lib/sports/import-server.ts    |  14 ++-
 src/lib/sports/results-server.ts   |   6 +-
 src/lib/sports/rules.ts            |   3 +-
 src/lib/sports/server.ts           |  16 ++-
 src/lib/sports/sync.ts             |   6 +-
 src/lib/sports/types.ts            |  13 ++-
 20 files changed, 552 insertions(+), 47 deletions(-)
```

| Archivo | Efecto visible o funcional para River/UFC |
|---|---|
| `.env.example` | Documenta Champions apagado por defecto; los valores de Deportes siguen apagados por separado. |
| `.github/workflows/ci.yml` | Agrega validaciones automatizadas; no cambia pantallas ni datos. |
| `package.json` | Registra suites/scripts adicionales; no cambia el cálculo ni cierre UFC. |
| `playwright.a11y.config.ts` | Aísla el servidor de accesibilidad contra la base de test; solo afecta las pruebas. |
| `playwright.config.ts` | Separa recorridos generales de Deportes/Champions; solo afecta las pruebas. |
| `playwright.sports-next.config.ts` | Hace configurable el puerto de la suite de Deportes; no cambia la aplicación. |
| `scripts/verificar-todo.sh` | Ejecuta las verificaciones completas contra `champions_test`; no es código de runtime. |
| `src/app/deportes/AgendaApp.tsx` | Añade Champions como pestaña condicional; los controles River y UFC existentes permanecen disponibles. |
| `src/app/deportes/Comments.tsx` | Permite usar el hilo de jornada Champions conservando las rutas y borradores River/UFC. |
| `src/app/deportes/agenda.module.css` | Añade presentación de jornadas y pestañas; River/UFC mantienen sus estilos y contenido. |
| `src/app/deportes/page.tsx` | Carga el panel Champions solo con sus dos habilitaciones; River/UFC conservan su selección. |
| `src/db/schema.ts` | Describe columnas/tablas deportivas Champions y el esquema UFC 0037 ya existente; no agrega puntajes UFC. |
| `src/lib/sports/config.ts` | Calcula Champions con entorno y switch; no altera las banderas de River/UFC. |
| `src/lib/sports/import-rules.ts` | Conserva el contrato legacy River/UFC y agrega reglas tipadas de fútbol por categoría. |
| `src/lib/sports/import-server.ts` | Aísla importación por categoría; las escrituras Champions no entran a River/UFC. |
| `src/lib/sports/results-server.ts` | Mantiene el importador de resultados legacy acotado a River; UFC sigue en su servidor específico. |
| `src/lib/sports/rules.ts` | Distingue River y Champions en la selección de fútbol; no modifica reglas UFC. |
| `src/lib/sports/server.ts` | Excluye Champions de endpoints genéricos y preserva datos River/UFC. |
| `src/lib/sports/sync.ts` | Limita sincronización legacy de fútbol a River; el flujo UFC permanece separado. |
| `src/lib/sports/types.ts` | Añade tipos para identidad y datos de fútbol; no cambia el contrato de peleas UFC. |

No tienen diff frente a `b2051b7`: `src/lib/sports/prediction-rules.ts`, `src/lib/sports/predictions-server.ts`, `src/lib/sports/results-ufc-server.ts`, `src/app/deportes/UfcPredictions.tsx` y el SQL/snapshot/journal de 0037 salvo que el journal ahora incluye 0038–0047 después de aquella fila.

## Cambios de datos por migración

La migración 0037 es byte a byte la de producción y conserva `when=1792046402706`; esta release no modifica su SQL ni el puntaje UFC. La simulación aislada recorrió 0000–0026 y 0037 antes de aplicar las diez migraciones nuevas.

| Migración | Cambios sobre datos existentes en producción |
|---|---|
| 0037 UFC | Ya aplicada; se preserva. Agrega columnas de cierre/elegibilidad y dispara el cierre correspondiente de las filas UFC según su SQL original; no se vuelve a ejecutar si la fila 28 ya está aplicada. |
| 0038 Champions identity | **Puede actualizar filas existentes:** `sports_events.football_category` queda `river` para fútbol existente y `NULL` para `ufc_card`; copia referencias externas existentes de eventos de fútbol a `sports_football_event_sources`. No altera votos, resultados, peleas, formaciones ni comentarios. Agrega las tablas/columnas de identidad de temporada, jornada/equipos y referencias de llave. |
| 0039 fútbol pronósticos | Solo crea tablas, índices, restricciones y funciones vacías; no backfill de pronósticos. |
| 0040 acceso de funciones | Reemplaza funciones y privilegios; no modifica filas de negocio. |
| 0041 privilegios por defecto | Cambia ACL/default ACL de funciones; no modifica filas de negocio. |
| 0042 resultados y tabla Champions | Crea función/estructura de resultados; no rellena filas históricas. |
| 0043 comentarios por jornada | Crea tabla e índices vacíos; no migra comentarios existentes. |
| 0044 switch familiar | **Inserta una fila apagada por familia existente** en `sports_champions_switches`; no modifica `families` ni datos River/UFC. |
| 0045 resolución de suspendidos | Crea tabla vacía para resoluciones auditadas; no cambia estados ni resultados existentes. |
| 0046 correcciones | Crea tabla vacía de auditoría/correcciones; no cambia resultados existentes. |
| 0047 grants gestionados | Ajusta ACLs de funciones/tablas deportivas; no modifica filas de negocio. |

Al apagar Champions se conservan switches, identidades, elecciones, resultados, comentarios y auditoría. River/UFC no dependen del switch Champions.
