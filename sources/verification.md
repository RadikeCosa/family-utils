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

## Matriz por tipo de cambio

Durante el desarrollo ejecutar los controles pertinentes. Antes de integrar,
ejecutar el conjunto completo; no sustituirlo por una selección de esta tabla.

| Cambio | Comprobaciones pertinentes |
| --- | --- |
| Documentación e instrucciones | Enlaces y rutas locales; coherencia con scripts; `git diff --check`; comprobar carga de `AGENTS.md` en un chat nuevo |
| Skills y su instalador | Instalación en directorio vacío, `check`, preservación de colisiones; `node --test tests/agent-tooling.test.mjs` |
| Lógica y contratos | `npm run lint`, `npm run typecheck`, pruebas del dominio y `npm test` con PostgreSQL aislado |
| Navegación compartida | `npm run test:navigation`, build y `npm run test:unified` |
| Interfaz | Lint, tipos, build, suite del dominio, `npm run test:a11y` y recorridos móviles correspondientes |
| Handlers y autorización | Pruebas del dominio, build y `npm run test:routes` |
| Esquema y migraciones | `npm run db:check`, `npx drizzle-kit check`, migrar base aislada, `npm run db:verify` e integración del dominio |
| Herramientas de verificación | `bash -n scripts/verificar-todo.sh`, pruebas de herramientas, Compose válido y ejecución completa aislada |

`npm test` contiene reglas e integración: puede omitir pruebas sin la URL.
Un resultado con omisiones no acredita integración completa. Los handlers y
Playwright requieren un build previo y usan las bases/servidores de sus fixtures.
No apuntar ninguna de estas pruebas a producción.

## Conjunto completo

`scripts/verificar-todo.sh` ejecuta secuencialmente:

1. Versión del servidor, dependencias, consistencia de migraciones y preparación
   de `champions_test`; aborta si no puede preparar la base.
2. Tipos, lint, build, historial aplicado, reglas e integración general,
   navegación, herramientas de agentes y rutas.
3. Navegador de Recetas, general, Deportes, Champions y accesibilidad.
4. Creación y migración de una base local auxiliar de nombre único terminado en
   `_test`, para interfaz unificada y diario. Ejecuta la interfaz, integración
   del diario con rendimiento y navegador del diario, igual que las suites de CI.
5. Permisos SQL de `public`, resumen y retirada de la base auxiliar propia.

La base auxiliar evita mezclar los fixtures de interfaz y diario con las suites
generales. Los fixtures del diario crean y retiran además sus propias bases.
El rol local de pruebas requiere permiso para crear bases, como el rol de CI.
No ejecutar dos verificadores en paralelo: comparten build, puertos y artefactos.
No iniciar suites aisladas mientras el verificador completo esté activo.

Cada suite informa aprobados, fallidos y omitidos. TAP sin resumen coherente,
Playwright vacío, pruebas inestables y errores globales producen fallo. Los
errores de infraestructura también se contabilizan; no siempre corresponden a
un caso de prueba individual. La salida es no exitosa si hay fallos u omisiones
o si no se puede retirar la base auxiliar. Conservar la salida en una ubicación
privada cuando se necesite evidencia; revisar datos sensibles antes de publicarla.
Los fallos de navegador incluyen proyecto, nombre del caso y mensajes de error
en la salida, antes de retirar los reportes JSON temporales.

Si WebKit falla al iniciar con un mensaje de biblioteca compartida ausente
(por ejemplo, `libxml2.so.2`), el recorrido no llegó a ejecutarse. Preparar las
dependencias de navegador en un sistema compatible o ejecutar la suite en CI;
no cambiar la aplicación ni omitir WebKit para obtener un resultado aprobado.

Si se interrumpe de forma no recuperable el proceso o quedan conexiones abiertas,
puede quedar una base auxiliar. Identificar el nombre exacto generado por esa
ejecución y comprobar que no se use antes de retirarla; no terminar conexiones
ni borrar otras bases automáticamente.

## Instrucciones nuevas y límites de la evidencia

Abrir un chat nuevo en la raíz y pedir que enumere la guía cargada, los límites
de autonomía y los documentos pertinentes para un dominio concreto. Debe
identificar `AGENTS.md`, permitir implementación/verificación acordada y exigir
autorización para producción. Comprobar también las rutas de skills seleccionadas.
Una revisión estática no demuestra por sí sola esa carga en un chat nuevo.

CI conserva sus comprobaciones existentes y agrega las pruebas de herramientas.
Su PostgreSQL temporal usa otra base inicial; la restricción `champions_test`
pertenece al verificador local, no cambia los contratos de las suites en CI.
