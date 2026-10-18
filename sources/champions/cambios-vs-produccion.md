# Diff de archivos fuera de Champions: b2051b7 → champions-fase-1-rc5

Salida del diff completa para archivos fuera de los módulos exclusivos de Champions, pruebas, documentación y migraciones. No se filtró por coincidencias de palabras clave.

```sh
git diff --stat b2051b7 champions-fase-1-rc5 -- . \
  ':!src/lib/sports/champions*' ':!src/app/api/sports/champions*' \
  ':!src/app/deportes/Champions*' ':!tests/**' ':!tests' \
  ':!sources/**' ':!sources' ':!drizzle/**' ':!drizzle'
```

```text
 .env.example                                  |   1 +
 .github/workflows/ci.yml                      |   1 +
 package.json                                  |   7 +-
 playwright.a11y.config.ts                     |   9 +-
 playwright.champions.config.ts                |   3 +
 playwright.config.ts                          |  16 +-
 playwright.sports-next.config.ts              |   5 +-
 scripts/preflight-publicacion.sh              | 231 ++++++++++++++++++++++++++
 scripts/verificar-todo.sh                     | 226 +++++++++++++++++++++++++
 src/app/deportes/AgendaApp.tsx                |  21 ++-
 src/app/deportes/Comments.tsx                 |  43 +++--
 src/app/deportes/agenda.module.css            |  22 +++
 src/app/deportes/page.tsx                     |  19 ++-
 src/db/schema.ts                              | 166 +++++++++++++++++-
 src/lib/sports/config.test.ts                 |   7 +-
 src/lib/sports/config.ts                      |   4 +
 src/lib/sports/football-predictions-server.ts |  42 +++++
 src/lib/sports/import-rules.ts                |   1 +
 src/lib/sports/import-server.ts               |  10 +-
 src/lib/sports/results-server.ts              |   6 +-
 src/lib/sports/rules.test.ts                  |   8 +
 src/lib/sports/rules.ts                       |   3 +-
 src/lib/sports/server.ts                      |  16 +-
 src/lib/sports/sync.ts                        |   6 +-
 src/lib/sports/types.ts                       |  13 +-
 25 files changed, 840 insertions(+), 46 deletions(-)
```

## Efecto por archivo

- `.env.example` — agrega la bandera de Champions apagada; no cambia River ni UFC.
- `.github/workflows/ci.yml` — ejecuta validaciones adicionales; no cambia el comportamiento de usuarios.
- `package.json` — agrega comandos de suites y serializa algunas pruebas; sin efecto de producto.
- `playwright.a11y.config.ts` — configuración de pruebas; sin efecto en usuarios.
- `playwright.champions.config.ts` — configuración de pruebas; sin efecto en usuarios.
- `playwright.config.ts` — configuración de pruebas; sin efecto en usuarios.
- `playwright.sports-next.config.ts` — configuración de pruebas; sin efecto en usuarios.
- `scripts/preflight-publicacion.sh` — inspecciona herramientas y estado local antes de publicar; sin efecto en usuarios.
- `scripts/verificar-todo.sh` — ejecuta suites; sin efecto en usuarios.
- `src/app/deportes/AGENDAAPP.TSX` — agrega la interfaz Champions y ahora oculta su control administrativo si la bandera de entorno está apagada; River/UFC conservan sus vistas.
- `src/app/deportes/COMMENTS.TSX` — reutiliza comentarios con contexto por deporte; River conserva su ruta e hilo y UFC no usa este hilo Champions.
- `src/app/deportes/agenda.module.css` — añade estilos para agenda e hilo Champions; no cambia las reglas ni los datos de River/UFC.
- `src/app/deportes/PAGE.TSX` — carga Champions solo con bandera de entorno y switch familiar activos; la carga de River/UFC continúa por la agenda existente.
- `src/db/SCHEMA.TS` — incorpora columnas y tablas de Champions; las columnas UFC existentes y sus puntos/cierres se conservan.
- `src/lib/sports/CONFIG.TEST.TS` — amplía pruebas del gate Champions; sin efecto en usuarios.
- `src/lib/sports/CONFIG.TS` — agrega el gate de Champions; los gates River/UFC conservan sus condiciones.
- `src/lib/sports/FOOTBALL-PREDICTIONS-SERVER.TS` — implementa pronósticos y tabla para fútbol Champions; no es una ruta UFC.
- `src/lib/sports/IMPORT-RULES.TS` — impide que el importador genérico trate fixtures Champions como River; validación UFC no cambia.
- `src/lib/sports/IMPORT-SERVER.TS` — separa importación Champions del flujo fútbol existente; los dos chequeos UFC de carteleras equivalentes y cierre único permanecen iguales a b2051b7.
- `src/lib/sports/RESULTS-SERVER.TS` — limita el importador de resultados genérico a River; UFC sigue en sus funciones y ruta separadas.
- `src/lib/sports/RULES.TEST.TS` — añade casos de selección por categoría; sin efecto en usuarios.
- `src/lib/sports/RULES.TS` — separa partidos Champions del selector River; el selector UFC no cambia.
- `src/lib/sports/SERVER.TS` — incorpora lectura/edición Champions por separado; el filtro UFC por tipo de evento se conserva.
- `src/lib/sports/SYNC.TS` — filtra sincronización de River por categoría; las reglas UFC permanecen sin cambio.
- `src/lib/sports/TYPES.TS` — amplía tipos para Champions; los tipos y resultados UFC mantienen su comportamiento.

Las rutas y módulos de Deportes compartidos están en mayúsculas cuando contienen o enrutan comportamiento relevante para UFC. El código UFC debe seguir siendo idéntico al de `b2051b7`; esta comparación estática y la regresión de cierre único lo verifican.
