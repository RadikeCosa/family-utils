# Biblioteca familiar

## Alcance aprobado

Una ficha por obra dentro de cada familia: películas, series, libros, música, arte,
videojuegos y juegos de mesa/cartas. Carga manual, título y tipo obligatorios;
creador, año y enlace opcionales. Todos los perfiles activos participan, incluidos
los accesos anónimos. Edición compartida, archivo/restauración y aportes personales.

## Entregas

1. Migración y contratos; esquema productivo aditivo, utilidad apagada.
2a. Colección, ficha, creación, búsqueda y cursores.
2b. Duplicados, edición compartida, archivo/restauración.
3. Estado propio y valoración opcional de 1 a 5, visibles para la familia.
4. Múltiples aportes con fecha parcial, compañía y spoilers; retirada lógica.
5. Accesibilidad, validación final, habilitación y piloto auténtico.

Cada entrega tiene rama `codex/…`, PR, CI y evidencias propios. El trabajo de Tareas
se mantiene en otro checkout. Biblioteca no aparece en producción hasta terminar
la etapa 5: `LIBRARY_ENABLED` debe ser exactamente `true`; ausente significa apagada.
La tarjeta, páginas y todas las rutas API deben usar esa misma bandera del servidor.

## Contratos

Páginas `/biblioteca` y `/biblioteca/[obraId]`; API `/api/library`:

| Operación prevista | Entrada y resultado |
| --- | --- |
| GET colección | búsqueda, tipo, estado propio, archivadas y cursor; 50 fichas y siguiente cursor |
| POST ficha | `WorkInput`, confirmación de coincidencias; identificador |
| GET ficha | ficha, integrantes, estados/estrellas y 50 aportes; siguiente cursor |
| PATCH ficha | datos o archivo/restauración, `expectedVersion`; identificador |
| PUT datos propios | estado y estrellas anulables, `expectedVersion` (0 si no existe) |
| POST aporte | texto, spoiler, fecha parcial y acompañantes |
| PATCH aporte | datos y `expectedVersion`; únicamente su autor |
| PATCH aporte (acción retirar) | `expectedVersion`; retirada lógica únicamente por su autor |

Mutaciones autenticadas, aislamiento familiar y validación en transacción. Errores:
400 datos inválidos, 403 acceso o permiso revocado, 404 recurso ausente o bandera
apagada, 409 conflicto o coincidencias que requieren confirmación. Ninguna lectura
escribe. Solo el autor edita/retira aportes, sin excepción para administradores.
Una ficha archivada permite únicamente restaurar o retirar aportes propios.

Los tipos son texto con CHECK. Estado: `pending`, `in_progress`, `finished` o null.
Valoración: entero 1–5 o null. Fecha de experiencia: año, año/mes o año/mes/día,
componentes ausentes null, sin períodos completamente futuros en Buenos Aires.
Compañía admite perfiles activos y archivados de la familia, incluido el autor.
La auditoría no copia texto de aportes. Retirada conserva texto y acompañantes,
fuera de las lecturas visibles, sin restauración.

Normalización única en servidor y búsqueda: extremos y espacios, NFD, eliminación
de marcas diacríticas, minúsculas. Índice no único familia/tipo/título normalizado;
coincidencias se avisan en alta y cambio de título/tipo, incluidas archivadas. Dos
altas simultáneas coincidentes están permitidas. Límites por puntos de código y
CHECK `char_length`: título/creador 200, enlace 2048 y aporte 5000.

Colección por actividad/id descendentes; actividad = máximo entre alta de ficha y
publicaciones, incluidas retiradas. Aportes por publicación/id descendentes. Cursores
atados a familia y filtros, nunca a revisión. Nuevas actividades anteriores al cursor
aparecen al actualizar. Revisión para ETag y aviso, sin vaciar páginas ya cargadas.

Bloqueos: obra FOR UPDATE en gestión, FOR SHARE en aportes/datos personales. No
ascender bloqueos para actualizar actividad. Versiones esperadas por entidad.

## Operación y estado real

- Etapa 0: PR documental #11 integrado; respaldo diario del 12/10/2026 satisfactorio,
  incluida restauración PostgreSQL 18 en el paso “Dump, encrypt, and restore-check”.
  [Evidencia privada](https://github.com/RadikeCosa/family-utils-backups/actions/runs/38232273766).
- Etapa 1: [PR #14](https://github.com/RadikeCosa/family-utils/pull/14)
  integrado en `ce89dbe6ed8224c6bf6840ebf4ebcf0853dad17e`.
  `0011_family_library` aplicada en producción el 12/10/2026 a las 19:15:39 UTC,
  después de confirmar el respaldo y verificar el historial hasta `0010`.
  Journal `when=1791832188039`; SHA-256 del SQL:
  `814fa140e6671780ad1a904d0adae94e6fff1ed04f006edcb5796d9a20813753`.
  Verificación posterior mediante `family_utils_backup_reader`, transacción de
  lectura: 12 migraciones con hashes/timestamps correctos, cuatro tablas,
  53 restricciones y cero filas de Biblioteca. Biblioteca se habilitó después de completar todas las etapas y CI.
- Etapa 2a: colección y carga en [PR #21](https://github.com/RadikeCosa/family-utils/pull/21).
  Este PR incorpora a main el contenido de #16, integrado previamente en su rama
  base de desarrollo. Etapas 2b, 3, 4 y 5 en los PR
  [#17](https://github.com/RadikeCosa/family-utils/pull/17),
  [#18](https://github.com/RadikeCosa/family-utils/pull/18),
  [#19](https://github.com/RadikeCosa/family-utils/pull/19) y
  [#20](https://github.com/RadikeCosa/family-utils/pull/20).
  Todas integradas en main y con CI satisfactorio en sus entregas. No se modificaron archivos de Tareas.
- Piloto acordado: **Yojimbo**, película, registrada en producción con la
  utilidad completa el 12/10/2026. Vicky y Ramiro publicarán sus propios aportes posteriormente;
  no se crean reseñas en su nombre.

El número de migración se decide al integrar. La segunda rama rebasa y regenera
SQL, journal y snapshot sobre main. No modificar migraciones ya integradas/aplicadas.
`npm run db:migrate` valida timestamps crecientes y luego verifica todos los hashes
y timestamps aplicados; una migración saltada por Drizzle debe fallar explícitamente.

Ensayo: una rama Neon schema-only, reconstruida desde migraciones y fixtures, sin
copiar filas productivas ni resetear desde producción. Verificar vaciado antes de
crear credenciales exclusivas Preview. Rama `library-rehearsal-2026-10-12`
(`br-young-star-b55g74w9`), PostgreSQL 18, Free: creada schema-only, verificadas
23 tablas con cero filas, reconstruida desde cero y verificadas las 12 migraciones
con sus hashes y timestamps. Rol exclusivo `library_preview_20261012`, sin
permisos de crear roles o bases; credenciales nunca versionadas.

Preview verificado con datos sintéticos y sesión anónima autorizada de ensayo:
`dpl_7o2eVrBZQREUtV4AvhWwqg1jFWty`, código
`be6222da58f121fb02fd309ec2e45bc192d30ea0`.
[Acceso protegido al ensayo](https://family-utils-git-codex-biblioteca-05-radikecosas-projects.vercel.app/biblioteca).
Variables exclusivas de Preview y ramas de trabajo: conexión sintética,
`LIBRARY_ENABLED=true` y, para la etapa final, secretos de autenticación y URL
propios. Ninguna variable productiva fue reemplazada. Colección, ficha, estado y
valoración probados contra Neon. El entorno conserva únicamente datos sintéticos.

Antes de cada migración productiva: respaldo diario satisfactorio. Prueba de
restauración única cubierta por la evidencia anterior. Directa para migraciones;
agrupada para aplicación. Mantener planes gratuitos.

Cierre: etapas y CI completos, smoke productivo de lectura, piloto auténtico,
evidencias guardadas y ausencia de dependencias/datos exclusivos. Inventariar y
obtener aprobación explícita antes de retirar recursos externos y credenciales.
No hay migración destructiva de rollback: deshabilitar utilidad conserva datos.

Validación final: CI completo satisfactorio en las seis entregas, con PostgreSQL
18 desde cero, reglas, rutas, tipos, lint, compilación y navegador. Ampliación final
local: ocho comprobaciones de API de Biblioteca (incluidos permisos, familia,
revocación, bloqueos concurrentes y bandera apagada en todas las operaciones),
diez recorridos móviles, ficha sin desbordamiento a 320 px y tres comprobaciones
de accesibilidad de la plataforma, incluida colección a nueve anchos. Tipos y lint
satisfactorios. Habilitación productiva, smoke de lectura y piloto completados. Retirada de
recursos del ensayo pendiente de aprobación explícita del inventario.

## Lanzamiento y piloto — 12 de octubre de 2026

- Versión publicada: `dd6972d666cfbcaa465f34e94b4ef09359dcd380`, igual al HEAD
  remoto de main al lanzar. Despliegue productivo
  `dpl_6kyoRXup2vX65QtPSPAw31Bticn8`, READY a las 19:30:14 UTC.
  `LIBRARY_ENABLED=true` exclusivamente en producción tras CI final satisfactorio.
- [Biblioteca productiva](https://family-utils-umber.vercel.app/biblioteca).
  Smoke de lectura con sesión familiar autorizada: colección inicialmente vacía,
  perfiles activos de Ramiro y Vicky disponibles. API sin sesión: 403; antes de
  habilitar la bandera: 404. Aislamiento entre familias y accesos revocados
  comprobados en PostgreSQL y CI, sin crear familias ficticias en producción.
- Piloto auténtico:
  [Yojimbo](https://family-utils-umber.vercel.app/biblioteca/61e57cd3-e4ee-4c19-86bf-dd5d16830166),
  tipo película, creada desde la sesión existente. Lectura posterior con
  `family_utils_backup_reader` y `BEGIN READ ONLY`: una ficha, cero aportes y
  cero datos personales. Cada integrante podrá escribir su propia reseña.
- CI [38297493113](https://github.com/RadikeCosa/family-utils/actions/runs/38297493113):
  43 pruebas de reglas/PostgreSQL, 43 de rutas, 44 recorridos móviles de la
  plataforma y tres pruebas de accesibilidad; tipos, lint y compilación correctos.
  Se verificaron 12 migraciones aplicadas y sus hashes en PostgreSQL 18.
- Logs del despliegue revisados después del piloto: sin fallos de aplicación;
  stderr contiene el aviso de compatibilidad futura SSL de pg-connection-string.
  No se cambió la conexión productiva para silenciarlo.

## Inventario de retiro pendiente

[Inventario exacto](./family-library-cleanup.json), sin secretos, capturado después
 del lanzamiento. Retirar únicamente estos recursos tras aprobación explícita:

- Neon: rama `library-rehearsal-2026-10-12` (`br-young-star-b55g74w9`) y su rol
  exclusivo `library_preview_20261012`. Rama schema-only sin hijas; una familia,
  un perfil, una obra y dos aportes exclusivamente sintéticos. No contiene datos
  familiares de producción. El rol no es `family_utils_backup_reader` ni participa
  en el respaldo diario.
- Vercel: siete variables exclusivas Preview para las entregas 4 y 5, 22 despliegues
  Preview de Biblioteca y sus seis alias de ramas. El inventario conserva todos
  sus identificadores. No retirar `LIBRARY_ENABLED` productiva ni variables ajenas.
- Git: seis ramas de implementación `codex/biblioteca-01`, `-02a`, `-02b`, `-03`,
  `-04` y `-05`; sus entregas están incorporadas por PR y no quedan PR abiertos
  con esas ramas como origen/destino. La rama documental de cierre se conserva
  hasta su integración. Ramas de Tareas y Compras fuera de este retiro.

No hay automatizaciones ni workflows del repositorio que usen el ensayo. Las
únicas dependencias son sus Preview y archivos temporales privados de esta sesión.
El respaldo y las mediciones operativas utilizan producción. Conservar PR, commits,
resultados de CI y este informe como evidencia histórica. Primero retirar variables,
despliegues y alias del ensayo; después su rol/rama Neon y ramas Git aprobadas.
