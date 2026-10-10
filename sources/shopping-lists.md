# Compras

## Uso y permisos

Todos los perfiles activos consultan las listas de su familia y pueden crear
listas. Si no se indica nombre, se guarda el nombre del perfil creador. Dueño
actual y creador original son independientes. El dueño elige editores por
perfil, renombra, archiva y restaura; archivar conserva permisos pero impide
modificar productos. Dueño y editores agregan, corrigen, quitan y marcan
productos; también pueden desmarcar todos con confirmación. Se permiten
productos repetidos y cantidades de texto libre.

Los administradores existentes pueden transferir propiedad a un perfil activo
indicando motivo; la operación elimina todos los editores anteriores. Archivar
un perfil no transfiere sus listas. La recuperación mantiene el perfil y sus
permisos entre dispositivos. Los enlaces funcionan solamente dentro de la
familia; no se agregan códigos ni acceso público.

Pendientes y comprados mantienen el orden original de incorporación, incluso
al desmarcar. El catálogo aprende el nombre vigente al marcar comprado,
normaliza espacios, mayúsculas y acentos para deduplicar y conserva la primera
forma escrita para mostrar. Todos los integrantes activos pueden ocultar y
restaurar sugerencias. Comprar nuevamente no reactiva una sugerencia oculta.

## Contratos

Todos los endpoints usan sesión y membresía activa, y se restringen a la familia.
Las mutaciones reciben JSON. `expectedVersion` es un entero tomado de la lectura
anterior. Versiones obsoletas devuelven 409, falta de permiso 403 y recursos
ajenos/inexistentes 404. Validaciones devuelven 400.

| Endpoint | Método y operación |
| --- | --- |
| `/api/shopping` | GET estado familiar, permisos, productos y catálogo; POST `{name?}` crea lista |
| `/api/shopping/:listId` | PATCH `{action: rename/archive/restore, name?, expectedVersion}` |
| `/api/shopping/:listId/editors` | PUT `{memberIds, expectedVersion}` reemplaza editores |
| `/api/shopping/:listId/transfer` | POST `{ownerMemberId, reason, expectedVersion}` |
| `/api/shopping/:listId/items` | POST `{name, brand?, quantity?}` |
| `/api/shopping/:listId/items/:itemId` | PATCH `{name, brand?, quantity?, expectedVersion}`; DELETE `{expectedVersion}` |
| `/api/shopping/:listId/items/:itemId/purchased` | PUT `{purchased: boolean}` |
| `/api/shopping/:listId/reset` | POST `{}` desmarca los comprados existentes al ejecutarse |
| `/api/shopping/suggestions/:suggestionId` | PATCH `{hidden: boolean, expectedVersion}` |

Nombre y marca de producto: hasta 160 caracteres; cantidad: hasta 100. Nombre
de lista: hasta 160; motivo de transferencia obligatorio: hasta 1.000.

Todas las escrituras bloquean familia y después lista, revalidan el perfil y el
dispositivo dentro de la transacción y escriben auditoría/revisión atómicamente.
La creación y el catálogo solo necesitan el bloqueo familiar. La versión de
contenido del producto es independiente del estado comprado; repetir el mismo
estado no genera auditoría ni revisión. Operaciones opuestas se serializan y
prevalece la última. Las ediciones concurrentes de distintos productos no
producen conflictos de versión entre sí.

La lectura usa una instantánea consistente. El ETag incluye familia, integrante,
revisión propia de compras y revisión familiar de acceso. Los 304 también
revalidan membresía. No hay caché compartida ni escritura offline. El refresco
se pausa tras dos minutos sin teclado, toque o clic, con pestaña oculta o sin
conexión; ocurre cada 30 segundos mientras hay actividad. Respuestas obsoletas
no reemplazan datos nuevos. Los conflictos y permisos revocados conservan
borradores en memoria hasta que se descarten o se abandone la página; no se
reenvían automáticamente.

## Migración y entrega

`0009_shopping_lists` agrega cuatro tablas y `families.shopping_revision`.
La migración y los endpoints se validan en PostgreSQL 18 aislado. Antes de
producción, ensayar la migración usando conexión directa en una rama aislada
de Neon del proyecto existente, comprobar integridad y concurrencia y revisar
el destino del despliegue. No ejecutar los fixtures contra datos de producción.

En una reversión, volver a la aplicación previa y conservar las tablas y
columnas aditivas. No restaurar un respaldo completo para revertir esta función.

Etapas de entrega: esquema/contratos; CRUD del dueño; comprado/archivo/reutilización;
colaboración/transferencia; sugerencias; refresco y pulido. Cada etapa depende de
la migración, y permisos y versiones deben existir desde el primer endpoint.

## Verificación y medición pendiente de uso real

Las pruebas de rutas usan dos conexiones reales para verificar ambos órdenes de
revocación y escritura, además de archivo de perfil. Playwright cubre iPhone y
Android, conflictos con borrador, red fallida, respuestas atrasadas, permisos,
archivo, catálogo, accesibilidad y pausa/reanudación del polling.

Presupuesto estático por GET con membresía válida, sin contar consultas de
Better Auth ni BEGIN/COMMIT: tres SELECT para un 304 (contexto de miembro,
revalidación y revisión); ocho SELECT para respuesta completa con listas
(los tres anteriores más perfiles, listas, productos, editores y catálogo).
Sin listas, se omiten las consultas a productos y editores.

Medición local del 2026-10-10 con PostgreSQL 18, una lista, un producto y sesión
vigente: la respuesta 200 ejecutó **10 SELECT + BEGIN/COMMIT** y la respuesta
304 ejecutó **5 SELECT + BEGIN/COMMIT**, incluyendo Better Auth. Se contaron
sentencias del servidor con un `application_name` exclusivo y logging temporal
solo en el contenedor aislado; la configuración de logs se restauró después.
Estos conteos no representan latencia ni cómputo medido en Neon.

Con cuatro dispositivos continuamente activos, el polling genera como máximo
8 solicitudes por minuto, 480 por hora de actividad conjunta. No extrapolar
24 horas de actividad diaria: la pausa por inactividad es parte del presupuesto.
Las acciones propias y los eventos de regreso/conexión agregan solicitudes.

Antes del piloto registrar una ventana previa de siete días y luego siete días
de uso: solicitudes de compras y proporción de 304, consultas y cómputo de Neon,
invocaciones y duración de Vercel. No registrar nombres, contenido ni identidades.
Comparar consumo total existente más incremento, proyectar cada métrica mensual
con `consumo_semanal / 7 * días_del_mes` y contrastar con las cuotas gratuitas
vigentes de las cuentas. Si cualquier cuota se supera, reducir frecuencia o
volumen de lecturas y repetir la medición; no habilitar consumo pago.

El ensayo en Neon, el despliegue y las ventanas de uso real deben registrarse
con fecha y resultados antes de declarar cerrada la validación operativa.

### Ensayo en Neon — 2026-10-10

Se comprobó la base configurada mediante una transacción explícita de solo
lectura: PostgreSQL 18.6, migraciones `0000` a `0008_meal_planner` aplicadas
y coincidentes con los archivos del repositorio, y ninguna tabla de compras.
Esta fue la comprobación inicial, anterior a la publicación.

La integración de Neon permitió confirmar el proyecto `family-utils`
(`green-meadow-92440811`), PostgreSQL 18 y plan `free_v3`. Desde su rama
`production` (`br-lucky-bird-b5jop51y`) se creó
`shopping-migration-test-2026-10-10` (`br-fragrant-surf-b54zr3qy`), aislada y no
predeterminada, con cómputo mínimo y máximo de 0,25 CU. Se conservó el tiempo de
suspensión del servicio, porque este plan no permite modificarlo.

Se aplicó `0009_shopping_lists` mediante Drizzle y conexión directa a la rama
temporal. Antes y después se compararon conteos y resúmenes del contenido de las
19 tablas existentes, conservando las columnas originales: ninguna fila cambió.
Se comprobaron las cuatro tablas nuevas y la revisión inicial de familias en
cero. Una segunda ejecución conservó datos e historial de diez migraciones sin
reaplicar cambios. `.env.local` conservó su contenido original.

Una comprobación posterior, en una transacción de solo lectura contra
producción, confirmó nueve migraciones y ninguna tabla de compras.

La primera ejecución de pruebas de rutas agotó el límite local de 90 segundos
por la latencia remota. Se agregó `FAMILY_UTILS_TEST_TIMEOUT_MS` para ampliar el
límite del recorrido en Neon, manteniendo 90 segundos por defecto. La repetición
usó 300000 ms y la conexión agrupada de la rama temporal, igual que la aplicación.
Pasaron **9 pruebas, sin fallos ni omisiones**, en 181,8 segundos: creación,
aislamiento familiar, editores, productos repetidos y campos opcionales,
conflictos de contenido, marcado idempotente, ETag privado, sugerencias ocultas
y restauración, ambos órdenes de revocación contra escritura, ambos órdenes de
archivo de perfil contra escritura, archivo/restauración de listas y
transferencia administrativa con motivo y revocación de permisos anteriores.
Las comprobaciones de concurrencia usaron conexiones independientes y esperaron
bloqueos reales de PostgreSQL. También pasó lint tras ajustar el límite de prueba.

El ensayo de migración y contratos queda validado. La rama temporal sigue
disponible para revisión y debe retirarse con la herramienta de administración
de Neon cuando esté disponible, confirmando antes la eliminación. Siguen
pendientes la publicación y las ventanas de medición de uso real descritas arriba.

### Preparación de publicación — 2026-10-10

La vista previa de la rama `codex/listas-compras` usa credenciales exclusivas de
la rama temporal, sin acceso a producción. Conserva la protección de Vercel;
el enlace temporal autorizado para verificación no se registra en el repositorio.

Durante la preparación local se especificó `DATABASE_URL`, pero el comando de
migración utiliza `DATABASE_URL_UNPOOLED`. Esto aplicó la migración aditiva a
producción antes del orden previsto. La comprobación posterior de solo lectura
confirmó diez migraciones, el hash correcto de `0009_shopping_lists`, las cuatro
tablas nuevas y cero listas y productos. No se ejecutaron fixtures en producción.
La aplicación de producción seguía en la versión anterior en ese momento.

Se corrigió el aislamiento de identidades de accesibilidad: cada fixture utiliza
una IP de documentación distinta para no compartir el límite de acceso de
Better Auth entre pruebas rápidas. Lint, tipos y las dos pruebas de accesibilidad
locales pasaron con PostgreSQL aislado y todas las conexiones explícitas.
