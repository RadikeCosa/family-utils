# Verificación local

## Términos y modelo de amenaza

**Cobertura funcional completa** ejecuta todos los grupos de dominio y las pruebas
compartidas de reglas, handlers y navegador del catálogo. **Auditorías amplias**
incluye accesibilidad global e interfaz unificada. **Cobertura completa** y
**`--full`** son sinónimos: ejecutan toda la cobertura funcional y las auditorías
amplias del inventario vigente. La **suite funcional reducida** aún no está
habilitada: requiere la poda medida de la Entrega 3 y una corrida completa aprobada
con el selector nuevo.

Se acepta el riesgo de errores de agentes; no se pretende resistir a un candidato
malicioso que falsifique resultados. Ejecutar candidatos en `pull_request`, sin
secretos, y nunca usar `pull_request_target` para ejecutarlos.

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

Playwright WebKit cubre el motor WebKit, pero no acredita el comportamiento de
Safari en un iPhone real. Mantener esa comprobación para navegación/guardado y
cambios de fechas nativas, almacenamiento, PWA/offline o diseño; registrar
dispositivo y versión en la autorización de publicación solo si cambian instalación,
offline o capacidades nativas.

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
base de datos, migraciones, dependencias y configuración. Autenticación, permisos,
middleware, configuración, workflows y herramientas de verificación fuerzan
cobertura completa. Una ruta desconocida o import interno irresoluble también la
fuerza. La lista documental es cerrada: solo `README.md`; si se mezcla con código,
se conserva el alcance del código. Los contratos operativos y `AGENTS.md` requieren
cobertura completa.

CI siempre inicia en PR y `main`; no usa filtros de rutas a nivel del workflow.
Los PR seleccionan por impacto usando el ancestro común y checkout de historial
completo. Si no se puede resolver, se alerta y se elige todo. Al integrar, `main`
verifica el PR asociado e intenta reutilizar su evidencia confiable solo si API,
base, árbol integrado, alcance y workflow coinciden; si falta evidencia o falla
cualquier comparación, ejecuta la suite completa. La corrida semanal y
`workflow_dispatch` con SHA explícito ejecutan todo. La certificación manual
predeterminada usa cero reintentos; el PR y la corrida semanal permiten un
reintento automático por caso Playwright. Solo PR cancela una ejecución anterior
del mismo número; eventos de `main` y manuales no se cancelan.

En local:

```sh
bash scripts/verificar-todo.sh
bash scripts/verificar-todo.sh --full
```

El modo predeterminado selecciona alcance y valida catálogo/política antes de
requerir PostgreSQL. Compara el árbol de trabajo y archivos nuevos contra
`origin/main`; sin esa base, con catálogo inválido o sin cambios detectados, la
selección completa se elige con alerta. `--full` ejecuta todo explícitamente.
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

La política confiable `scripts/verification-policy.json` de `main` puede activar
`forceFull`; exige motivo e incidente. Se clasifica cualquier fallo como defecto
de selección, defecto dentro del alcance o problema del entorno. Solo un caso
reproducible que debió ejecutarse y quedó fuera suspende la selección. Reactivarla
requiere corregir el mapa, agregar regresión y aprobar cobertura completa. La
corrida semanal usa `0 12 * * 0` UTC (domingo 09:00 en Buenos Aires) en la rama
por defecto; GitHub puede demorarla y desactivarla en repositorios públicos tras
60 días sin actividad. Un job separado abre un issue si falla. Ver las
[reglas oficiales de `schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
El repositorio actual es público, usa `ubuntu-latest` estándar y tiene `main` como
rama por defecto; esos jobs no consumen minutos facturables. GitHub comparte el
almacenamiento de artefactos con Packages, así que las capturas de navegador se
retienen 7 días y solo el manifiesto certificador 90 días. Revisar las cuotas y
el uso efectivo si cambia visibilidad o tipo de runner ([costos y límites de
Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).

El selector compara entradas del catálogo anterior y nuevo, y amplía consumidores
transitivos de ambos. Los cambios de reglas globales ejecutan todo. El catálogo
asocia cada invariante obligatoria con casos existentes; las referencias
inexistentes o invariantes sin cobertura hacen fallar la selección antes de
preparar la base.

## Reglas para preparar producción

La evidencia identifica SHA y árbol candidato, base, hashes del catálogo/política/
selector/runner/generador confiables y lockfile, revisiones de workflow y herramientas,
versiones de Node/PostgreSQL, alcance requerido y ejecutado, resultados,
omitidas, inestables e intentos. CI completa todos los grupos seleccionados y usa
un reintento por caso Playwright. Si un caso solo pasa al reintento, repetir una
vez el alcance requerido completo sin reintentos para el mismo candidato; si vuelve
a fallar, corregirlo. Verificar procedencia y cobertura de la evidencia antes de
autorizar. El candidato incorpora `main` vigente; cualquier cambio de árbol exige
nueva verificación. El artefacto certificador se retiene 90 días; si venció o se
eliminó, hay que verificar de nuevo. GitHub limita la retención pública a 90 días;
comprobar el límite efectivo de la organización/repositorio antes de habilitarlo
([configuración oficial de retención](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)).
Si el merge publica automáticamente, pedir autorización antes
del merge. Ver el procedimiento, la plantilla
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
