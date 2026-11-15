# Verificación local

## Entorno aislado PostgreSQL 18

Requiere Node según `.nvmrc`, npm compatible con el lockfile, Docker Compose,
Git y dependencias instaladas con `npm ci`. Los navegadores de prueba requieren
Chromium y WebKit:

```sh
npx playwright install --with-deps chromium webkit
docker compose --profile verification up -d --wait postgres-test
export FAMILY_UTILS_TEST_DATABASE_URL=postgres://family:family@127.0.0.1:55432/champions_test
bash scripts/verificar-todo.sh
```

Las credenciales del ejemplo son exclusivamente locales. El puerto se puede
elegir con `FAMILY_UTILS_TEST_PORT` al iniciar Compose; ajustar también la URL.
El servicio se publica solo en loopback. La URL explícita acepta `postgres:` o
`postgresql:`, host `localhost` o `127.0.0.1` y base `champions_test`, sin query
ni fragmento. Se rechazan destinos inválidos antes de conectar o ejecutar suites.
El script comprueba además que el servidor sea PostgreSQL 18.

`postgres-test` usa el volumen nuevo `family_utils_postgres18_test`, montado en
`/var/lib/postgresql` según la [imagen PostgreSQL 18](https://docs.docker.com/guides/postgresql/).
El servicio `postgres` y el volumen anterior `family_utils_postgres` permanecen
como estaban para conservar datos de PostgreSQL 17. Iniciar solo `postgres-test`;
no es necesario arrancar ni recrear el servicio anterior. No usar `down -v`.
Este cambio no migra datos antiguos ni cambia la conexión habitual de la app.

El verificador aplica las migraciones únicamente a la base de pruebas validada.
Para una comprobación individual que necesite Drizzle, preparar antes:

```sh
export DATABASE_URL="$FAMILY_UTILS_TEST_DATABASE_URL"
export DATABASE_URL_UNPOOLED="$FAMILY_UTILS_TEST_DATABASE_URL"
npm run db:migrate
```

La base y el volumen de pruebas persisten para poder inspeccionarlos. Para
detener solo este servicio, conservando todos los volúmenes:

```sh
docker compose --profile verification stop postgres-test
```

## Selección por impacto

El catálogo único está en `scripts/verification-catalog.json`. Cada dominio
enumera rutas, suites de reglas e integración, handlers y recorridos de navegador.
Las dependencias declaradas amplían la selección a consumidores transitivos.
`scripts/verification-impact.mjs --check` compara imports, reexports e imports
dinámicos literales internos con esas relaciones y compara todos los archivos de
prueba descubiertos con el catálogo. Import no literal en `src/` fuerza selección
completa; dependencia cruzada sin registrar o prueba sin grupo falla CI.

Las rutas compartidas incluyen autenticación, navegación, calendario, componentes,
base de datos, migraciones, dependencias y configuración. Una ruta desconocida
también fuerza suite completa y se muestra como alerta. El modo documental se
limita a `README.md`, `AGENTS.md`, `agent-skills.md` y Markdown bajo `sources/`;
un PR con cualquier archivo adicional sigue las reglas de código.

CI siempre inicia en PR y `main`; no usa filtros de rutas a nivel del workflow.
Los PR seleccionan por impacto usando el ancestro común y checkout de historial
completo. Si no se puede resolver, se alerta y se elige todo. `main` y `workflow_dispatch`
con referencia explícita ejecutan la suite completa. Solo PR cancela una ejecución
anterior del mismo número; eventos de `main` y manuales no se cancelan.

En local:

```sh
bash scripts/verificar-todo.sh
bash scripts/verificar-todo.sh --full
```

El modo predeterminado compara el árbol de trabajo y archivos nuevos contra
`origin/main`. Sin esa base, con catálogo inválido o sin cambios detectados, la
selección completa se elige con una alerta. `--full` ejecuta todo explícitamente.
El verificador valida la URL de PostgreSQL antes de cualquier preparación, luego
ejecuta dependencias, migraciones, tipos, lint y build, y finalmente las suites
seleccionadas. La suite unificada usa una base `_test` auxiliar única, migrada y
retirada por la misma ejecución; ante interrupción se identifica por su nombre
antes de considerar retirarla. Ejecutar verificadores secuencialmente: comparten
base, puertos, build y artefactos.

El runner y CI consumen el mismo catálogo. Node TAP sin resumen coherente o sin
casos, Playwright vacío, omisiones, fallos y errores globales producen estado no
aprobado. Un grupo fuera del alcance es una selección documentada; una prueba
omitida dentro de un grupo seleccionado es un fallo de verificación. El resumen
JSON registra base, candidato, archivos, razones, grupos, resultados y duración.
La carpeta local `verification-results/` está excluida de Git.

## Reglas para preparar producción

La suite completa debe aprobar sobre el SHA candidato antes de pedir autorización.
El candidato incorpora `main` vigente; cualquier movimiento de `main` o del
candidato invalida la evidencia. Si el merge publica automáticamente, la
autorización se pide antes del merge. La suite completa posterior de `main` es
adicional, nunca reemplaza la aprobación previa. Ver el procedimiento, la plantilla
de evidencia, los modos del preflight y la recuperación en [Preparar y autorizar
una publicación](deployment.md).

Un fallo reproducible de `main`, atribuible a un PR e incluido en una suite que el
selector omitió, suspende la selección por impacto inmediatamente. Durante los
primeros 20 PR integrados se registra cada pareja PR/SHA de selección y de suite
completa en `sources/verification-impact-window.md`. La selección vuelve cuando
el catálogo/selector está corregido y el caso tiene regresión.

No apuntar pruebas a producción. Las bases de integración y los fixtures del diario
deben ser locales y sintéticos. Los reportes con salida de herramientas se revisan
antes de publicarse para evitar contenido sensible.

## Instrucciones nuevas y límites de la evidencia

Abrir un chat nuevo en la raíz y pedir que enumere la guía cargada, los límites
de autonomía y los documentos pertinentes para un dominio concreto. Debe
identificar `AGENTS.md`, permitir implementación/verificación acordada y exigir
autorización para producción. Comprobar también las rutas de skills seleccionadas.
Una revisión estática no demuestra por sí sola esa carga en un chat nuevo.

CI usa PostgreSQL 18 temporal. La restricción de base exacta `champions_test`
pertenece al verificador local, no altera los contratos de integración de CI.
