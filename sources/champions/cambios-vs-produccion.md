# Diff de usuario: b2051b7 → champions-fase-1-rc5

El bloque siguiente corresponde a este comando exacto (los patrones adicionales también son archivos o runners de pruebas):

```sh
git diff --stat b2051b7 champions-fase-1-rc5 -- . \
  ':!src/lib/sports/champions*' \
  ':!src/app/api/sports/champions*' \
  ':!src/app/deportes/Champions*' \
  ':!src/lib/sports/football-predictions-server.ts' \
  ':!**/*.test.*' ':!tests' ':!sources' ':!drizzle' \
  ':!playwright*.ts' ':!scripts/verificar-todo.sh'
```

Se excluyen los módulos exclusivos de Champions, pruebas y documentación bajo `sources` y `drizzle`. Las configuraciones de Playwright y el runner de verificación de suites también se excluyen porque solo ejecutan pruebas.

```text
 .env.example                       |   1 +
 .github/workflows/ci.yml           |   1 +
 package.json                       |   7 +-
 scripts/preflight-publicacion.sh   | 231 +++++++++++++++++++++++++++++++++++++
 src/app/deportes/AgendaApp.tsx     |  21 +++-
 src/app/deportes/Comments.tsx      |  43 ++++---
 src/app/deportes/agenda.module.css |  22 ++++
 src/app/deportes/page.tsx          |  19 ++-
 src/db/schema.ts                   | 166 +++++++++++++++++++++++++-
 src/lib/sports/config.ts           |   4 +
 src/lib/sports/import-rules.ts     |   1 +
 src/lib/sports/import-server.ts    |  10 +-
 src/lib/sports/results-server.ts   |   6 +-
 src/lib/sports/rules.ts            |   3 +-
 src/lib/sports/server.ts           |  16 ++-
 src/lib/sports/sync.ts             |   6 +-
 src/lib/sports/types.ts            |  13 ++-
 17 files changed, 530 insertions(+), 40 deletions(-)
```

## Efecto por archivo compartido

- `.env.example` — agrega `SPORTS_CHAMPIONS_ENABLED=false`; sin efecto visible mientras siga apagada.
- `.github/workflows/ci.yml` — amplía verificaciones automáticas; no cambia el comportamiento durante el uso.
- `package.json` — registra suites Champions y serializa pruebas de rutas; no cambia reglas ni puntos de River/UFC.
- `scripts/preflight-publicacion.sh` — comprobaciones de herramientas y estado local para el operador; sin efecto en usuarios.
- `src/app/deportes/AGENDAAPP.TSX` — agrega pestaña/vista Champions; la selección `sport=ufc` sigue usando `UfcPredictions` y River conserva su vista.
- `src/app/deportes/COMMENTS.TSX` — generaliza el componente de comentarios y añade contexto Champions; River/UFC conservan sus rutas API predeterminadas y sus tipos de hilo.
- `src/app/deportes/agenda.module.css` — estilos de la agenda compartida; las reglas nuevas se aplican a los elementos Champions, sin cambios visuales buscados en UFC/River.
- `src/app/deportes/PAGE.TSX` — carga Champions solo cuando están activos el flag de entorno y el switch familiar; la carga River/UFC sigue por `loadSportsData`.
- `src/db/SCHEMA.TS` — agrega temporada/equipos/llaves/resultados de fútbol; migración 0038 normaliza `football_category` de las filas UFC a `NULL` y conserva los datos deportivos; no cambia sus puntos ni cierres.
- `src/lib/sports/CONFIG.TS` — agrega el gate de Champions dependiendo de Deportes/agenda; el gate UFC permanece idéntico.
- `src/lib/sports/IMPORT-RULES.TS` — rechaza una categoría Champions enviada por el importador genérico de River; el importador de carteleras UFC conserva su validación.
- `src/lib/sports/IMPORT-SERVER.TS` — evita que el importador River reclame referencias Champions; las consultas de UFC siguen incluyendo `kind='ufc_card'`, por lo que sus equivalencias, cierres y detección de ausencias conservan el comportamiento de b2051b7.
- `src/lib/sports/RESULTS-SERVER.TS` — restringe el importador de resultados de fútbol a categoría River; UFC sigue manejado por su ruta separada y la plantilla conserva la condición `SPORTS_UFC_PREDICTIONS_ENABLED`.
- `src/lib/sports/RULES.TS` — excluye partidos Champions del selector River; `selectUfcEvent` no cambia.
- `src/lib/sports/SERVER.TS` — separa la lectura/edición de eventos Champions del CRUD genérico; los eventos UFC siguen admitidos por `kind='ufc_card'`.
- `src/lib/sports/SYNC.TS` — filtra por categoría solo la sincronización River; el estado, elegibilidad, reintentos y escritura UFC quedan intactos.
- `src/lib/sports/TYPES.TS` — amplía tipos para fútbol Champions y autores de comentarios; no altera los campos ni valores de resultados UFC.

Se marcaron en mayúsculas los módulos compartidos que también contienen tipos o rutas UFC. No se editaron durante este endurecimiento. Ninguna migración nueva se agregó: la función `sports_football_choice_view(sports_events, uuid)` ya fue retirada por 0040 y no existe en la base con 38 migraciones; por eso no se generó 0048.
