# Entrenamiento

Utilidad personal en `/entrenamiento`. `TRAINING_ENABLED=true` habilita tarjeta,
página y API en tiempo de ejecución; cualquier otro valor devuelve 404 y oculta
la tarjeta. No usar `NEXT_PUBLIC_` ni activar producción antes del cierre operativo.

## Modelo y contratos

`training_routines` y `training_sessions` pertenecen a `(owner_member_id,
family_id)`, resuelto desde `MemberContext.memberId`. No pertenecen a `authUser.id`.
Por eso cambiar de dispositivo o recuperar el acceso al mismo perfil conserva los
datos. Ni administradores ni otros integrantes acceden a registros ajenos.

Las estructuras `TrainingBlock[]` guardadas en JSONB contienen nombre, vueltas y
una lista ordenada de ejercicios por repeticiones o segundos. La posición es el
índice del array. Los máximos están centralizados en `src/lib/training/rules.ts`;
la base también comprueba la estructura y los límites con `training_blocks_valid`.

`version` es control de concurrencia, no revisión de contenido. Un entrenamiento
conserva su copia de nombre y bloques aunque la rutina se edite o archive. El
origen es obligatorio e inmutable. Corregir permite cambiar todos los datos de la
sesión salvo su origen, propietario e identidad. No hay borrado definitivo.

### API privada

- `GET /api/training/routines?archived=false&limit=20&cursor=…`
- `POST /api/training/routines`: `{ name, blocks, operationKey }`.
- `GET /api/training/routines/[id]`.
- `PATCH /api/training/routines/[id]`: `{ name, blocks, version }` o
  `{ action: "archive" | "restore", version }`.
- `GET /api/training/sessions?limit=20&cursor=…`.
- `POST /api/training/sessions`: `{ name, blocks, sourceRoutineId, performedOn,
  durationSeconds, effort, note, operationKey }`.
- `GET /api/training/sessions/[id]`.
- `PATCH /api/training/sessions/[id]`: los campos de creación, reemplazando
  `operationKey` por `version`.

Ejercicio: `{ name, mode: "repetitions", repetitions }` o
`{ name, mode: "time", seconds }`. Bloque: `{ name, rounds, exercises }`.

Detalle/escritura devuelve `{ item, today }`; listado `{ items, nextCursor,
today }`. `today` usa la zona familiar. Las fechas se transportan como
`YYYY-MM-DD`, sin convertirlas a instantes. `note` admite texto vacío.

POST nuevo devuelve 201. El UUID de operación y la huella SHA-256 del contenido
normalizado se mantienen para siempre: reintentar devuelve 200 y el registro
actual; cambiar el contenido con la misma clave devuelve 409 `OPERATION_CONFLICT`.
Un bloqueo transaccional serializa solicitudes con la misma clave y la unicidad
por propietario/clave protege la persistencia. PATCH desactualizado devuelve 409
`VERSION_CONFLICT`. Los campos de propiedad y cualquier campo desconocido se
rechazan. La lectura o modificación por ID ajeno devuelve el mismo 404 que un ID
inexistente. Lecturas y escrituras usan `Cache-Control: private, no-store`.

La creación de sesiones bloquea la rutina de origen para comprobar que esté
activa y sea propia. Un archivo concurrente se serializa con esta comprobación.
Los reintentos de sesiones ya creadas funcionan incluso si el origen se archivó.
La revocación del dispositivo y el archivo del perfil se serializan con la
revalidación del actor dentro de la transacción.

La interfaz congela el contenido cuando se desconoce el resultado de un guardado
y ofrece reintentar el mismo intento; conserva los datos hasta confirmar el
resultado o descartar el formulario. Un conflicto de edición ofrece recarga con
confirmación explícita. No hay persistencia de borradores tras cerrar/recargar la
página ni escritura offline.

## Entregas y activación

1. Esquema, reglas y API; pruebas de aislamiento e idempotencia.
2. Rutinas, formularios, reordenamiento, duplicación, archivo/restauración.
3. Registro, historial y corrección; recorrido móvil y accesibilidad.

Las tres etapas se implementan detrás de una bandera desactivada por defecto.
La migración nueva es `0053_training`, posterior a `0052_ufc_scoring`; no editar
SQL ni hashes de migraciones anteriores. Antes de publicar, comparar nuevamente
archivos, diario y migraciones aplicadas en el destino con `npm run db:check` y
la verificación de hashes. No renumerar una migración ya aplicada.

### Cierre operativo obligatorio antes de activar producción

- Ensayar primero en una rama aislada de Neon con datos sintéticos, conexión
  directa y rol migrador. Mantener el uso dentro del plan gratuito.
- Comprobar los ACL reales: sin lectura/escritura para PUBLIC, `anon` o
  `authenticated`; el servidor accede mediante su conexión privada. Si el rol
  de aplicación difiere del migrador, otorgar únicamente SELECT/INSERT/UPDATE
  sobre las dos tablas y EXECUTE sobre `training_blocks_valid(jsonb)`.
- La migración otorga SELECT a `family_utils_backup_reader` si el rol existe.
  Confirmar en el destino que existe, que tiene USAGE sobre el esquema y SELECT
  sobre ambas tablas. Si se crea después, otorgar esos permisos explícitamente.
- Comprobar que el trabajo privado de respaldo no excluya `training_*` y que
  `pg_dump` incluya tablas, datos, índices, restricciones y función de validación.
- Ejecutar respaldo cifrado con `age` y restauración en una base aislada; verificar
  vínculos de propietario/origen y conteos de ambas tablas. No versionar claves,
  dumps ni datos familiares. Registrar evidencia privada del ensayo y respaldo.
- Confirmar respaldo vigente, aplicar migraciones pendientes verificadas usando
  conexión directa y desplegar con la bandera apagada.
- Verificar páginas y API bloqueadas; habilitar solo al completar la aceptación.
  Ante problemas, apagar la bandera conservando las tablas y el historial.

El ensayo local no sustituye el ensayo Neon ni certifica el respaldo de producción.

## Verificación reproducible

Usar exclusivamente `FAMILY_UTILS_TEST_DATABASE_URL` con PostgreSQL aislado y
migrado. La prueba de actualización crea y retira otra base temporal.

- Reglas y PostgreSQL: `node --experimental-strip-types --test src/lib/training/rules.test.ts tests/postgres-training.integration.test.mjs`.
- Build y rutas: `npm run build`, luego `node --test tests/training-routes.integration.mjs`.
- Móvil y accesibilidad: `npx playwright test tests/e2e/training.spec.ts --project='iPhone viewport' --project='Android viewport'`.
- Calidad general: `npm run lint`, `npm run typecheck`, `npm test`.

Las pruebas de rutas crean perfiles sintéticos, servidores separados con bandera
apagada/encendida y verifican claves concurrentes, archivo, aislamiento, paginación
con microsegundos y recuperación del mismo perfil en otro dispositivo. Las pruebas
móviles verifican el recorrido completo, reordenamiento por teclado, axe y
recuperación de respuesta perdida después de que el servidor ya guardó.

## Verificación de esta entrega — 20/10/2026

- Compilación, tipos, lint, comprobación del diario y de snapshots satisfactorios.
- PostgreSQL 18 local: 140 pruebas generales, siete comprobaciones de rutas y
  cuatro pruebas móviles en iPhone/Android; axe sin infracciones en las vistas
  verificadas. Incluye respuesta perdida tras guardar y recuperación real por código.
- Ensayo Neon PostgreSQL 18: base vacía `training_rehearsal`, reconstrucción hasta
  `0052`, datos sintéticos previos y actualización a `0053`; los 43 hashes
  anteriores permanecieron idénticos y el historial terminó con 44 migraciones.
- Por límite de ramas raíz se usó una rama temporal hija de la rama existente de
  esquema `family-utils-preview`, con base nueva vacía y cómputo fijo de 0,25 CU.
  No se modificó la configuración local de conexión de la aplicación.
- Las siete comprobaciones de API también pasaron contra la base sintética de
  Neon, incluida la recuperación real por código. Se usa un margen de tres
  minutos para admitir la latencia de ese recorrido remoto.
- Se autenticó directamente como `family_utils_backup_reader`: SELECT permitido
  en ambas tablas nuevas e INSERT denegado. El volcado completo con ese rol se
  cifró con `age`, descifró y restauró en PostgreSQL 18.6 aislado: una rutina,
  un entrenamiento y un vínculo válido de integrante/familia/origen conservados.
  Clave temporal y volcados sintéticos se retiraron después de verificar.
- Se revisó el workflow privado de respaldo: volcado completo sin filtros de
  tablas, cifrado y restauración aislada. Última ejecución consultada:
  [39401240744](https://github.com/RadikeCosa/family-utils-backups/actions/runs/39401240744),
  satisfactoria el 20/10/2026. Ese respaldo precede la incorporación de Entrenamiento.
- Cotejo inicial de producción, exclusivamente en transacción de solo lectura: 43
  migraciones aplicadas y hashes coincidentes; única pendiente, `0053_training`.
  En esa instancia las tablas nuevas todavía no existían allí. La publicación
  posterior se registra en la solicitud de integración de esta entrega.
- Limpieza completada: rama temporal Neon eliminada y ausencia confirmada;
  contenedor PostgreSQL 18, base temporal inicial y credenciales locales del
  ensayo retirados. Las ramas y bases preexistentes se conservaron.
