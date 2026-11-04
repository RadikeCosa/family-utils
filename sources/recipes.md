# Recetas: catálogo compartido y envío revisado a Compras

## Comportamiento

`/recetas` y `/recetas/:id` usan los mismos identificadores de `meal_ideas` que
Menús. Nombre obligatorio; nota, rendimiento, preparación e ingredientes
opcionales. Todos los integrantes activos editan contenido cuando
`RECIPES_ENABLED=true`; ocultar/restaurar sigue reservado a autor/administrador.
Los ocultos admiten edición y envío a Compras. Su uso nuevo en Menús exige
restauración explícita; propuestas y elecciones existentes se conservan.

Los ingredientes tienen UUID estable y cantidad libre. Compras recibe copias
independientes: quitar una fila no rompe la receta. No hay inventario,
conversión, suma automática ni asociación permanente con productos.
Una fila comprada conserva su estado al editar cantidad. Para comprar otra vez
se destaca agregar otra fila pendiente.

## Contratos

- `GET /api/recipes?q=&archived=0&offset=0&limit=20`: catálogo paginado (máximo 50).
- `POST /api/recipes`: crea ficha, inicialmente basta `{title}`.
- `GET /api/recipes/:id`: ficha, ingredientes, versión, autor de última edición y
  permiso de administración. ETag privado; revalida membresía incluso en 304.
- `PATCH /api/recipes/:id`: `{expectedVersion,title?,note?,yieldText?,preparation?,ingredients?}`;
  ingredientes `{id,name,quantity}`. O `{expectedVersion,action:"archive"|"restore"}`.
- Los POST/PATCH existentes de `/api/meals/ideas` llaman al mismo guardado.
  Un campo omitido no borra contenido. Guardar sin cambios devuelve
  `{idea,changed:false}` sin incrementar versión ni auditar otra vez.
- `POST /api/shopping/recipe-transfer`: prepara o confirma el conjunto.

El envío recibe `{action,recipeId,destination,rows,token?}`. Destino:
`{listId}` o `{newListName}`. Cada fila incluye
`{ingredientId,name,brand,quantity,action:"add"|"keep"|"edit",itemId,observed}`.
`prepare` devuelve token firmado y observaciones por ingrediente. Cada
observación conserva id, versión, nombre, marca, cantidad y comprado. El cliente
incorpora esos datos, elige su acción y envía `confirm` con el mismo token.

`REVIEW_CHANGED` (409) devuelve solo las observaciones afectadas; la pantalla
conserva decisiones no afectadas y exige reconocer las nuevas. El cambio del
nombre de compra invalida la consulta. La respuesta distingue destino ausente,
lista sin permiso y acceso familiar revocado, sin exponer datos ajenos.

La confirmación revalida actor y permisos bajo bloqueo familia → lista. Crear
lista, cambiar filas, auditar, incrementar revisión y persistir recibo ocurre
en una sola transacción. Reintentos simultáneos devuelven el mismo resultado.
No se modifican las cantidades de la receta ni el estado comprado existente.

## Versión y auditoría

La versión del plato cubre campos, etiquetas, ingredientes/orden y
ocultar/restaurar. Proponer, confirmar o actualizar último uso no la incrementa
ni cambia la fecha de edición. Un conflicto conserva el borrador en memoria,
permite copiarlo y consultar el servidor antes de descartarlo. Sin mezcla
automática, almacenamiento offline ni sobrescritura forzada.

Cada guardado efectivo audita snapshots completos antes/después. No se purga
este historial en la primera etapa; recuperación administrativa mediante un
nuevo guardado auditado, sin interfaz inicial de historial.

Máximos: nombre/marca 160, cantidad/rendimiento 100, nota 1.000, preparación
20.000 caracteres; 100 ingredientes por receta/envío. Todo es texto plano.
La prueba de migración mide dos snapshots con campos máximos en ASCII, Unicode
y caracteres escapados, comprobando un presupuesto de 650 KB por evento.
Medición sintética del 04/11/2026: 107.295 bytes ASCII, 291.295 Unicode y
567.295 con caracteres escapados, para ambos snapshots combinados.
No equivale a consumo productivo medido.

## Normalización v1

`normalize_name_v1` es la fuente de identidad en SQL: NFC, traducción explícita
de ÁÉÍÓÚÜÑ/áéíóúüñ, minúsculas, colapso de espacios POSIX y recorte. ñ=n es
intencional. No modifica plurales ni puntuación. Otros diacríticos no se
eliminan implícitamente: por ejemplo `Crème brûlée` produce `crème brûlee`.

Triggers mantienen claves persistidas con clientes anteriores. La búsqueda
parcial escapa comodines y no requiere extensiones. La migración rechaza
colisiones de sugerencias sin fusionar nombres ni cambiar estados ocultos.
Cambiar reglas exige v2, revisar colisiones, backfill e índices; no reemplazar
el cuerpo de v1 sin ese proceso.

## Idempotencia

Token emitido con hora del servidor y vigencia de 24 horas, firmado con HMAC y
clave HKDF derivada de `BETTER_AUTH_SECRET` para este propósito. No depende del
reloj del dispositivo. Recibo único `(family_id,operation_id)` con integrante,
SHA-256 del comando validado y respuesta original. La serialización ordena claves
y conjuntos de observaciones; conserva el orden de acciones.

Misma clave/contenido devuelve el resultado; otro contenido da
`IDEMPOTENCY_MISMATCH`. Un token vencido da `OPERATION_EXPIRED`, aunque se haya
limpiado el recibo. Rotar el secreto invalida tokens pendientes: hay que revisar
otra vez y consultar Compras antes de repetir una operación incierta.

La pantalla conserva el comando exacto si pierde la respuesta y ofrece
reintentar ese envío. La limpieza elimina hasta 100 recibos vencidos fuera de
la transacción de negocio. Un fallo de limpieza no cambia el resultado.

## Migraciones y activación

`RECIPES_ENABLED=false` por defecto. La versión anterior de Menús conserva sus
permisos mientras está apagado, pero usa la base compartida nueva tras migrar.
Las dependencias concretas están en package.json y package-lock.json.

1. Comprobar destino, respaldo, historial/hashes, versión de PostgreSQL, región,
   conexión directa/agrupada, planes y Fluid Compute. El cierre operativo
   de abajo distingue lo comprobado de lo pendiente.
2. Ensayar en PostgreSQL 18 aislado. Para separar commits de migración, usar
   `node scripts/migrate-recipes-stage.mjs base`, después `normalization` y
   finalmente `shopping`, pasando `DATABASE_URL_UNPOOLED` explícitamente.
   El script no carga `.env.local`. La etapa base termina en 0056, normalización
   en 0057, shopping en 0059 (recibos 0058 e integridad familiar 0059).
3. Si 0057 falla por colisiones, la etapa base ya confirmada se conserva.
   Drizzle puede envolver todas las migraciones pendientes en una transacción:
   no usar un único `db:migrate` para obtener esta separación en producción.
4. Publicar primero la base con el flag apagado y verificar Menús/Compras.
   Activar Recetas únicamente cuando todas las instancias sirvan la revisión
   nueva; el código anterior puede restaurar ocultos durante la convivencia.
5. El índice único es independiente: `drizzle-deferred/recipes_name_unique.sql`.
   Revisar colisiones explícitamente antes de ejecutarlo; no forma parte de
   `db:migrate`. Hasta entonces, los escritores nuevos comprueban duplicados
   bajo el bloqueo familiar. No crear otro índice con reglas distintas.
6. Una reversión conserva columnas, ingredientes, snapshots y recibos. Apagar
   Recetas oculta las pantallas; no restaurar un respaldo completo como rollback.

No se migró ni publicó producción durante la implementación. Sin servicios
nuevos, sin gasto pago habilitado y sin datos familiares en logs.

## Validación y pendientes

`npm test`, `npm run test:routes` y `npm run test:recipes:e2e` incorporan los casos
nuevos; lint, tipos, build, `db:check` y `drizzle-kit check` siguen siendo gates.
Playwright usa un servidor y flag independientes de los recorridos históricos.

Se prueban conservación de datos previos, normalización, índices diferidos,
permisos, caché privada, carreras de versiones y confirmaciones, cambios de
comprado sin cambio de versión, pérdida de acceso, snapshots, borradores,
transacciones fallidas y reintentos. Los recorridos iPhone/Android incorporan
axe y anuncios de reordenamiento; no sustituyen una sesión manual con un lector
de pantalla real.

Los fixtures son sintéticos y representativos. No se dispone de una muestra
real anonimizada: esa cobertura y la medición real de almacenamiento/latencia
siguen pendientes antes de la salida operativa. No se exportaron nombres,
recetas ni listas productivas. El rendimiento se validará con consultas y
métricas existentes antes de incorporar caché o extensiones.

### Verificación local — 04/11/2026

- Lint, TypeScript, build de producción, `db:check`, `drizzle-kit check` y diff sin errores.
- Suite de reglas/base: 149 aprobadas, sin omisiones.
- Suite completa de rutas autenticadas: 126 aprobadas, sin omisiones.
- Recetas: 12 comprobaciones de rutas, incluidas transacción fallida y reintento,
  confirmaciones concurrentes, filas compradas, permisos revocados y caché privada.
- Playwright: 24 recorridos históricos de Menús/Compras y 4 de Recetas aprobados
  en iPhone/Android. Axe sin hallazgos en las pantallas de Recetas comprobadas.
- Migraciones 0056–0059 ensayadas exclusivamente en PostgreSQL 18 local aislado.
- El índice diferido se verificó en la base temporal de la prueba de migración;
  no se aplicó a producción ni se incorporó a `db:migrate`.


## Migración productiva — 04/11/2026

El usuario autorizó comprobar y aplicar las migraciones. Destino identificado:
proyecto Neon `family-utils`, rama `production` (`br-lucky-bird-b5jop51y`),
base `neondb`, PostgreSQL 18.6 en `aws-us-east-2`. La conexión directa y la
agrupada corresponden al endpoint productivo `ep-morning-voice-b5d0c2f2`.

Se comprobó el respaldo de hoy con restauración aislada exitosa:
[ejecución 41806884957](https://github.com/RadikeCosa/family-utils-backups/actions/runs/41806884957).
El enlace requiere acceso al repositorio privado. Los pasos de dump, cifrado,
restauración en PostgreSQL 18 y almacenamiento del respaldo terminaron bien.

### Historial conciliado antes de migrar

Producción tenía 45 registros de Drizzle, hasta `0054`, aunque el catálogo de
`0055` ya estaba presente. No se reejecutó el backfill. El archivo local de
`0055` coincide byte por byte con el del commit publicado
`8e2a207c1a6e1dfcf0967616145576d2e4f8a69d`.

Se agregó `scripts/reconcile-meal-catalog.mjs`: por defecto comprueba en solo
lectura columnas/defaults, índices válidos, claves normalizadas, duplicados,
vínculos de propuestas y último uso. Rechaza estados incompletos o un historial
que no sea un prefijo exacto. Con `--apply`, bajo bloqueo y en transacción,
registra únicamente el hash/timestamp ausente de 0055. No modifica recetas ni
propuestas y no afirma reconstruir quién ejecutó originalmente el DDL.

Este procedimiento se probó localmente, incluyendo rechazo de un estado
incorrecto e idempotencia, y después en una copia privada de producción.
Solo entonces se concilió producción. El script requiere
`DATABASE_URL_UNPOOLED` explícita y no carga archivos de entorno.

### Ensayo y ejecución

Rama privada de ensayo: `recipes-migration-check-2026-11-04`
(`br-purple-cell-b5i2mplp`), creada desde producción, no predeterminada, con
compute mínimo/máximo de 0,25 CU. Se conserva para revisión; no se publicó una
app sobre ella ni se cambiaron las credenciales locales.

En esa copia se ensayaron conciliación, 0056, 0057 y 0058–0059. Las diez tablas
comparadas conservaron íntegramente su contenido y las claves actuales no
cambiaron con v1. Se verificaron 50 hashes y permisos de respaldo.

En producción se aplicaron después los mismos pasos, con commits separados
por etapa, espera de bloqueo limitada a 5 segundos y sentencias limitadas a
120 segundos. La etapa de conciliación usa un límite de 30 segundos.

| Migración | Resultado productivo |
|---|---|
| 0055 | Estado equivalente verificado; registro de Drizzle conciliado |
| 0056 | Campos opcionales, ingredientes e índices aplicados |
| 0057 | Función v1, triggers y normalización aplicados; cero claves cambiadas |
| 0058 | Recibos de idempotencia aplicados |
| 0059 | Relaciones familiares aplicadas y validadas |

Verificación posterior iniciada a las 08:48 ART:

- 50 hashes y timestamps coinciden exactamente con el historial local; no hay
  migraciones regulares pendientes.
- Las huellas y cantidades de las diez tablas de Menús/Compras comparadas
  coinciden antes/después, incluyendo nombres, notas, versiones y estados.
- Cero colisiones de nombres y cero referencias entre familias.
- Las tablas nuevas están vacías y sus restricciones familiares son válidas.
- `family_utils_backup_reader` conserva SELECT sobre ambas tablas nuevas,
  gracias a los permisos predeterminados ya configurados.
- La portada sigue respondiendo 200; Menús y Compras redirigen 307 al acceso
  sin sesión y sus APIs siguen denegando con 403. No se usaron identidades ni
  fixtures productivos para un recorrido autenticado.

El índice único de `drizzle-deferred/recipes_name_unique.sql` NO se aplicó.
Aunque hoy no hay colisiones, la app publicada todavía normaliza nombres en
JavaScript y no usa el escritor compartido nuevo. Se difiere el endurecimiento
hasta publicar esa versión, para evitar rechazos inesperados de clientes
anteriores con nombres fuera de la equivalencia española.

No se publicó ni se habilitó Recetas. El despliegue activo sigue siendo
`dpl_G2NQB56qeTMVnZwdbTi8FNcLingG`, región `iad1`, con el commit anterior
indicado arriba. Neon confirmó plan Free; no se cambiaron región, límites ni
servicios productivos. La configuración efectiva de Fluid Compute y el plan
actual de Vercel no se consideran verificados por los metadatos disponibles.

El ensayo real en Neon cubre la conservación y normalización sobre los datos
actuales, sin exportar nombres o contenido al repositorio. La muestra local
anonimizada y las pruebas manuales con lector de pantalla siguen pendientes.

Hashes de las migraciones verificadas:

| Archivo | SHA-256 |
|---|---|
| 0055_meal_catalog | `64ffa3532257f4c3d89f8d18462d363544de7e83ea9695460085d872532f8ba1` |
| 0056_recipes_base | `7a23d988412db1f84ea4d14f197443fad7daab933e9267bb335d468f52b2a9ac` |
| 0057_recipe_name_normalization | `34f87aed867756cd6de2f62a594628de1fa3144dc155459ce7cdf0716383e54d` |
| 0058_recipes_shopping | `e507e7fafeb771824b188a22baff6fb98b9117b41a05a86e21f8d4e25e00b358` |
| 0059_recipe_family_integrity | `b4d0410b4ad80e4864460b4190d25b6f301e77de06de99c0444b39b08a90152a` |
