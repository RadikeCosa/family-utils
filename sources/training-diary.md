# Diario personal de entrenamiento (contrato 3)

## Estado de la entrega

Implementación aditiva detrás de `TRAINING_DIARY_ENABLED=false`. No se activa
al desplegar ni al cambiar esa variable. No aplicar ni activar automáticamente
en producción. Los ensayos usan exclusivamente PostgreSQL local sintético.

El diario es privado del integrante, incluidos búsqueda, resumen, cursores,
operaciones y formularios recuperables. La zona horaria es la familiar. Las fechas
son DATE civiles entre 1900-01-01 y 2200-12-31, sin conversión al migrar.

## Contratos y estados

El contrato 1 requiere origen y métricas; el 2 permite métricas NULL bajo sus
banderas anteriores. Ambos mantienen sus tablas/validadores originales. El 3
requiere `X-Training-Contract: 3` y usa `training_entries`.

Entrada: `{ date, kind: "training"|"rest", plan, result,
disposition: "open"|"skipped", sourceRoutineId }`. Plan/resultado son NULL o
`{ title?, text?, blocks?, durationSeconds?, effort? }`. Descanso acepta `{}` y
no admite bloques/métricas. Entrenamiento exige título, texto o bloques válidos.
No se permiten dos NULL. El resultado no puede estar en el futuro.

La presencia de resultado implica realizado. Sin resultado, `skipped` implica
omisión manual; de otro modo, fecha anterior a hoy implica no realizado derivado,
y hoy/futuro implica planificado. Archivo es independiente y se excluye del
resumen. Los estados derivados nunca modifican versión ni generan auditoría.

El día informa conteos por tipo/estado. Prioridad: entrenamiento no realizado,
planificado, realizado; descanso no realizado, planificado, realizado; vacío.
Un descanso activo por fecha puede coexistir con entrenamientos. Copiar, mover y
restaurar respetan su unicidad con error REST_ALREADY_EXISTS sin cambios parciales.

## API

- GET `/api/training/entries?date=YYYY-MM-DD&archived=false&limit=20&cursor=…`.
- POST `/api/training/entries`: `{ input, operationKey }`.
- POST copia: `{ action:"copy", sourceId, content:"plan"|"result", date, operationKey }`.
- GET `/api/training/entries/[id]`: detalle completo.
- PATCH: `{ action:"edit", input, version, operationKey }` o
  `{ action:"result", content, version, operationKey }`.
- PATCH acciones `skip`, `archive`, `restore`: `{ action, version, operationKey }`.
- PATCH reprogramar: `{ action:"reschedule", date, version, operationKey }`.
- POST `/api/training/search`: `{ query, archived?, limit?, cursor? }`.
- GET `/api/training/summary?weekStart=YYYY-MM-DD` (lunes).

Respuestas con contexto `{ today, timeZone, serverNow, nextDayAt, writable }`.
Listado con `{ items, nextCursor, revision }`; detalle/escritura con `{ item }`.
Listados contienen extractos sin bloques; detalle contiene plan/resultado completos.

Orden `date DESC,id DESC`; páginas de 20, máximo 50. Cursor ligado a propietario,
familia, filtros, búsqueda, hoy y revisión. LIST_CHANGED (409) exige volver a la
primera página conservando lo mostrado. Resumen agrupado de la semana, sin N+1.

Texto 2000 caracteres y título 120 por contenido; hasta 20 bloques, 30 ejercicios
por bloque, límites numéricos anteriores. Cuerpo 512 KiB. Hasta 100 entradas activas
por fecha; creación, cambio de fecha y restauración se serializan por propietario.
La migración conserva el historial existente aunque ya supere el cupo.

Operaciones UUID por propietario, con hash canónico y confirmación transaccional.
Se consultan antes del control de versión. La misma clave/contenido confirma el
intento original y devuelve el estado actual; distinta huella: OPERATION_CONFLICT.
Retención sin TTL mientras existan los datos del perfil, incluidas entradas
archivadas. Solo metadatos, nunca copias de textos. Ante respuesta perdida se
congela el intento. Conflictos de versión conservan el borrador hasta revisar la
versión actual o descartarlo explícitamente.

Reprogramar mantiene identidad, incrementa versión y audita fechas; solo hacia
hoy/futuro sin resultado. Plan futuro exige reprogramación antes de registrar
resultado. Corregir resultado conserva plan. Copia muestra origen/vista previa y
siempre produce un plan nuevo. Plantillas se copian al contenido editado; archivar
una plantilla no modifica entradas; FK compuesta con ON DELETE RESTRICT.

## Convivencia y transición

La migración 0067 no altera SQL/hashes anteriores. Instala validación, índices,
revisiones por sentencia, operaciones, tabla singleton y triggers. La carga y la
instalación se realizan bajo bloqueo de `training_sessions` en una transacción.
Fechas fuera de rango abortan la migración completa sin corregir datos.

Antes de la transición, INSERT/UPDATE de sesiones se reflejan transaccionalmente
en entradas realizadas, con misma identidad, versión y contenido, sin crear planes.
El archivo de sesiones antiguas no existe; archivar rutinas no cambia sesiones.
No hay sincronización inversa.

`training_diary_transition()` toma un bloqueo exclusivo sobre la marca; los
escritores antiguos toman bloqueo compartido. Espera a sus commits y verifica
correspondencia antes de fijar transitioned_at. La ejecución se reserva al rol
migrador; no está otorgada a PUBLIC. Después se bloquean escrituras antiguas
también desde conexiones anteriores mediante el trigger P3001.

Orden de publicación:

1. Verificar migraciones/hashes y respaldo cifrado/restaurado; ensayar con datos
   sintéticos. Verificar ACL y permisos de respaldo para las cuatro tablas nuevas.
2. Aplicar 0067 mediante conexión directa; desplegar versión compatible en todas
   las instancias con bandera apagada. La app antigua sigue operativa.
3. Completar ensayos aislados de diario, rendimiento y navegador. Revisar también
   logs del proveedor/telemetría: la prueba local no certifica servicios externos.
4. Configurar TRAINING_DIARY_ENABLED=true. Antes de la marca sigue sirviéndose
   la app antigua; el cambio de variable no ejecuta transición.
5. Ejecutar explícitamente con conexión directa del migrador:

   ```sh
   npm run training:diary:transition -- --activate --confirm-compatible-deploy --confirm-backup --confirm-observability --confirm-performance
   ```

   El script exige la bandera y DATABASE_URL_UNPOOLED explícitas; no carga .env.

Después de la marca, contratos 1/2 reciben CLIENT_UPDATE_REQUIRED para sesiones.
No hay recarga automática ni pérdida del formulario. La reversión permitida es
esta versión compatible con la bandera apagada: conserva lector por fecha,
detalle y búsqueda de todos los tipos; deniega escrituras nuevas y antiguas. No
volver al binario original, que no conoce descanso/plan/sesiones sin rutina.
No revertir destructivamente el esquema ni borrar la marca.

Si hay rol de aplicación distinto al migrador: otorgar SELECT sobre estado,
SELECT/INSERT/UPDATE sobre entradas y revisiones, SELECT/INSERT sobre operaciones,
permisos de auditoría existentes y ejecución de funciones de validación/proyección.
Mantener revocado el acceso directo de PUBLIC/anon/authenticated. El rol de respaldo
necesita SELECT en las cuatro tablas y las funciones deben incluirse en pg_dump.

## Formularios y búsqueda privada

Única excepción a no persistir borradores: «Conservar y actualizar» en el editor
anterior. `sessionStorage`, clave por familia/integrante/formulario, caducidad
absoluta de 30 minutos, sin renovación. Se elimina al guardar, descartar, vencer,
salir o cambiar perfil; BroadcastChannel comunica cambios a otras pestañas.
Recuperación con acción explícita y verificación de identidad. Almacenamiento
bloqueado: conservar formulario y pedir copiar. No hay localStorage ni escritura
offline. Una pestaña del binario previo no puede adquirir esta recuperación:
copiar datos antes de actualizar. El navegador puede restaurar una sesión cerrada.

La búsqueda vive en `#q=…` y se envía en cuerpo POST; nunca en ?q=. Recientes y
orígenes guardados descartan fragmentos. No registrar cuerpos, términos ni cursores.
Proyección normalizada `normalize_name_v1` y GIN trigramas, 3–200 caracteres;
fragmento literal, sin operadores. Se incluyen textos y nombres de bloques y
ejercicios en ambos contenidos, no solo el extracto. Archivadas excluidas salvo
filtro explícito. Si falla rendimiento, agregar btree_gin multicolumna y volver a
medir; si sigue fallando, subir mínimo a cinco y actualizar contrato/UI/pruebas.

## Verificación reproducible

La conexión de pruebas debe ser local y terminar en `_test`. Las suites del diario
crean y eliminan bases propias con migraciones completas; nunca fijan la marca en
la base suministrada ni consultan producción.

```sh
npm run build
npm run test:training:diary
TRAINING_DIARY_PERFORMANCE=1 npm run test:training:diary
npm run test:training:diary:e2e
npm run lint
npm run typecheck
npm run db:check
```

Todas requieren FAMILY_UTILS_TEST_DATABASE_URL para las comprobaciones reales.
Rendimiento se mide por HTTP, incluyendo autenticación y respuesta, 25 muestras
por consulta con 100000 entradas sintéticas; p95 <=500 ms. Evidencia en
`test-results-training-diary/performance.json`. Capturas, trazas y accesibilidad en
`test-results-training-diary/browser`. No versionar datos familiares ni credenciales.

## Evidencia local — 10/11/2026

- Compilación de producción, tipos, lint, `db:check`, `drizzle-kit check` y
  comprobación de espacios del diff satisfactorios.
- 185 pruebas generales y ocho comprobaciones de rutas anteriores satisfactorias.
- 18 comprobaciones específicas del diario, incluida migración sobre historial
  existente, aborto transaccional por fechas fuera de rango, bloqueo concurrente
  de transición, privacidad entre familias/integrantes/administradores,
  idempotencia y reversión en modo consulta.
- 15 recorridos nuevos de navegador en Chromium móvil/escritorio y WebKit móvil,
  más seis recorridos anteriores en iPhone/Android. Incluyen axe, revisión de
  capturas, formularios conservados al actualizar, respuesta perdida, cambio de
  día con editor abierto, dispositivo en Asia/Tokyo, lector anterior, conflictos
  y conservación de omisiones manuales al corregir un plan.
- PostgreSQL 18 local, 100000 entradas sintéticas más contenido con 20 bloques y
  30 ejercicios por bloque en plan y resultado. p95 HTTP: resumen 11,5 ms, día
  11,4 ms, búsqueda común de tres caracteres 76,7 ms, búsqueda selectiva 17,6 ms,
  búsqueda en contenido máximo 15,4 ms. 25 muestras por consulta, sin necesitar
  aumentar el mínimo de búsqueda ni agregar índices multicolumna.
- Los ensayos no aplican migraciones, banderas ni transición en producción.
  Permanecen pendientes para publicar: ensayo/respaldo del destino, permisos
  efectivos y auditoría de registros/telemetría del proveedor, según el cierre
  operativo anterior. Las confirmaciones del script no sustituyen esas pruebas.

## Preparación de producción — 10/11/2026

La publicación se prepara sobre la versión de producción `169736f`, conservando
las mejoras de navegación, Recetas y Cinemateca ya publicadas. Las 57 migraciones
anteriores coinciden con los hashes locales; solo está pendiente `0067`.

Ensayo Neon en una rama aislada de producción: migración aditiva, correspondencia
de fechas/contenido/versiones, transición, rechazo P3001 de escrituras antiguas y
SELECT del rol de respaldo en las cuatro tablas verificados. PUBLIC sin acceso.
El proyecto no tiene drenajes externos de observabilidad configurados.

Respaldo previo con cifrado y restauración PostgreSQL 18 completos:
[ejecución 42878274215](https://github.com/RadikeCosa/family-utils-backups/actions/runs/42878274215).

## Registro de actividad y horarios (0068)

`TRAINING_ACTIVITY_FORM_ENABLED=false` incorpora la API y el editor compatibles
sin habilitar el formulario nuevo. Con la bandera en `true` y el diario habilitado,
«Registrar actividad» admite una frase o una rutina opcional, horarios e intensidad
percibida. «Planificar entrenamiento» guarda exclusivamente planes. La intensidad
es 1–3 suave, 4–7 moderada, 8–10 muy intensa. No se bloquean superposiciones.

Cada contenido admite `timing: {startAt,endAt,timeZone}`: instantes UTC ISO
normalizados y zona IANA. La duración se calcula en el servidor y se guarda en
`durationSeconds`; cualquier duración enviada junto a horarios se ignora. Máximo
inclusivo de 86400 segundos reales. La interfaz resuelve horas inexistentes o
repetidas según la zona familiar; no infiere finalizar al día siguiente. Fechas
locales inicial y final dentro de DIARY_MIN/DIARY_MAX (1900–2200).

El inicio del resultado determina la fecha de la entrada; si no hay resultado,
la determina el inicio del plan. El plan histórico se conserva aunque corresponda
a otra fecha. PATCH `action:result` admite `date` explícita para mover y registrar
atómicamente, conservando identidad y plan. La interfaz confirma el movimiento.
PATCH `action:reschedule` admite `timing` completo para mover planes con horarios.
La copia también admite `timing` para establecer horarios en su fecha de destino.

En ediciones, timing omitido conserva; `timing:null` borra horarios y duración.
Cambiar la fecha de una entrada con horarios exige reenviar el objeto completo;
omitirlo o enviarlo null devuelve 409 TIMING_REQUIRED_FOR_DATE_CHANGE. Sin horarios,
duración omitida conserva la histórica; null la elimina. La API distingue presencia
antes de normalizar y de persistir. Reintentos se resuelven antes del reloj, la
versión y el cupo; modificar horarios con la misma clave produce OPERATION_CONFLICT.

Los clientes compatibles anuncian `X-Training-Timing: 1`. Sin esa cabecera la API
omite timing en la respuesta, de modo que los validadores estrictos de pestañas
anteriores puedan leer y editar; sus escrituras no eliminan intervalos guardados.
Se aceptan también las huellas de operaciones confirmadas antes de esta ampliación.

La base valida intervalo, zona, duración y fecha; el trigger de ahora solo se
aplica a horarios reales nuevos/modificados. Una edición de texto no reevalúa
el reloj ni cambia la zona histórica. Planes admiten horarios futuros; resultados
no pueden finalizar después de ahora. Donde haya totales deben sumar sesiones,
sin unir intervalos, bajo «Tiempo acumulado de sesiones». Actualmente el resumen
semanal solo contiene conteos; no hay totales ni exportaciones de duración.

Inventario de accesos verificado: /entrenamiento, fecha/detalle explícitos,
navegación unificada Diario/Plantillas, acciones del día, detalle de plan,
estado vacío (remite a acciones del día), «Usar plantilla» en rutinas y recuperación
del formulario temporal. Todos desembocan en DiaryEditor tras la transición;
TrainingEditor queda para gestión de rutinas y sesiones previas a la transición.

Orden de entrega: migración 0068 y versión compatible con la nueva bandera apagada;
ensayos aislados; habilitar variable y redesplegar. Reversión funcional: apagar
TRAINING_ACTIVITY_FORM_ENABLED y redesplegar la versión compatible, sin revertir
0068 ni la transición del diario. No revertir a código previo a esta compatibilidad.
Los ensayos incluyen datos históricos sin horarios, cliente sin cabecera nueva,
cambios de fecha, DST, movimiento/resultado atómico y cupo 100 con reintentos.

### Verificación del registro de actividad

Ensayo local aislado con PostgreSQL 18 y Next compilado: 187 pruebas generales,
29 pruebas del diario/API/migraciones y 27 recorridos de navegador (9 por cada
proyecto: Chromium móvil, escritorio con zona del dispositivo diferente y WebKit).
Incluye edición con TRAINING_ACTIVITY_FORM_ENABLED=false conservando horarios,
lectura para validadores antiguos, cambio de fecha con error específico, copia y
reprogramación con timing, DST y guardado corregible tras un horario incompleto.
Axe sin incidencias graves/críticas en el formulario y sin desbordamiento horizontal.
La medición con 100.000 entradas sintéticas dio p95 máximo de 84 ms frente al
presupuesto de 500 ms. Compilación, tipos, lint de archivos cambiados, metadatos de
Drizzle y orden de las 59 migraciones verificados. Capturas y muestras en
`test-results-training-diary/`. La bandera nueva permanece apagada por defecto;
este ensayo no aplica 0068 ni activa el formulario en producción.
