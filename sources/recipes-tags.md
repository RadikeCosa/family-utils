# Recetas: lista y etiquetas libres

## Entrega

Dos hitos implementados: (1) migración/API y pruebas de integridad; (2) lista,
selector accesible, formularios y navegación. Las etiquetas libres no cambian
`mealTypes` ni las copias enviadas a Compras. No hay edición masiva,
renombrado/fusión global, duplicación ni almacenamiento offline de borradores.

La portada usa una lista con nota resumida y etiquetas. El texto busca solo
nombres de recetas. Disponibles/Ocultas se combina con todas las etiquetas
seleccionadas (AND). El selector ofrece conteos para el resultado de añadir
cada etiqueta y deshabilita opciones con cero coincidencias.

## Identidad y persistencia

`parseTags` limpia el nombre visible (recorte, un # inicial opcional, espacios
colapsados, NFC). `normalizeTagNameV1` aplica minúsculas y NFD, conserva ñ,
elimina marcas Unicode y recompone a NFC. Año y ano son distintos; veráno y
verano coinciden. Se valida después de deduplicar: hasta 10 etiquetas y 40
puntos de código Unicode por nombre. Se admiten letras, marcas asociadas,
números, espacios y guiones. La comparación de claves usa orden de puntos de
código; SQL usa collation C. No se modifica `normalize_name_v1`.

La migración 0066 agrega `recipe_tags` y `recipe_tag_links`, claves únicas e
índice inverso. Ambas relaciones de la tabla puente incluyen familia. La
función SQL versionada y el trigger mantienen la identidad con mapeos de mayúsculas y rangos de
marcas Unicode 17.0, correspondientes al Node 24 fijado en el proyecto.
Cambiar esas reglas requiere otra versión y revisar colisiones.

El escritor compartido resuelve etiquetas con INSERT ON CONFLICT y conserva
el nombre existente. Guardado, asociaciones, versión, auditoría y revisión de
Menús se confirman en la misma transacción bajo el bloqueo familiar existente.
Cambiar solo etiquetas genera una versión; reordenarlas o usar otra escritura
equivalente no. Las actualizaciones de clientes anteriores conservan etiquetas
al omitir el campo. Las huérfanas permanecen en la tabla pero no aparecen en
sugerencias; cuentan asociaciones con recetas vigentes, incluidas ocultas.

No se incorpora RLS: autorización y revalidación en servidor, consultas
restringidas por familia y claves foráneas compuestas mantienen el aislamiento.

## Contratos

- POST/PATCH `/api/recipes[/:id]`: `tags?: string[]`; omitir conserva, `[]` quita.
- Detalle, catálogo y resultado de guardado: `tags: {id,name,slug}[]`.
- GET `/api/recipes?q=&archived=0&tag=almuerzo&tag=deverano&limit=20&cursor=…`:
  devuelve `ideas`, `total`, `tags` con `count`, `familyId`, `revision`,
  `ignoredTags` y `nextCursor`.
- `tag` es repetible y contiene la clave normalizada, codificada como parámetro
  URL. Los espacios no se convierten en guiones. Slugs desconocidos o huérfanos
  se ignoran; `ignoredTags` permite avisar y limpiar el enlace con replace.
- GET `/api/recipes/tags?mode=edit`: etiquetas usadas por recetas vigentes de
  la familia, incluidas ocultas. Sin ese modo admite los filtros del catálogo y
  devuelve conteos de coincidencias al añadir cada etiqueta.
- GET `/api/recipes?revisionOnly=1`: revalida acceso y devuelve familia/revisión.
- `offset/nextOffset` se conserva para clientes anteriores. Si hay cursor,
  prevalece sobre offset. Solo el recorrido con cursor garantiza detenerse
  frente a cambios del catálogo.

Resultados, conteos y revisión se leen en una transacción corta repeatable
read. Los filtros usan EXISTS antes de paginar; las etiquetas se agregan con
json_agg, sin consulta por receta. El número de consultas no crece con la página.

El cursor firmado contiene familia, consulta efectiva, revisión y la última
tupla `(last_used_at DESC NULLS LAST, updated_at DESC, created_at DESC, id DESC)`.
Las fechas conservan microsegundos como texto SQL. Un cursor alterado o de otra
consulta/familia da 400 INVALID_CURSOR. Cambiar la revisión da 409
CATALOG_CHANGED; la interfaz conserva filas, bloquea Ver más y ofrece Actualizar
lista. `menus_revision` es conservadora: también puede invalidar por otros
cambios de Menús. Guardados y confirmaciones de Menús ya la incrementan.

## Navegación y accesibilidad

La URL conserva consulta, etiquetas y estado. Al tipear se hace replace con
220 ms de debounce; los filtros usan push. Se conservan parámetros repetidos
también en la navegación unificada. Atrás/Adelante recupera la consulta.

Una caché en memoria, limitada a 20 entradas de historial, conserva páginas y
scroll. Antes de restaurar contenido verifica familia y revisión con el
servidor. Al cambiar de familia o perder acceso se descarta. Una revisión nueva
restaura las filas visibles con aviso y exige actualizar para seguir paginando.
Una recarga completa o enlace nuevo solo recupera filtros y primera página.
No se guardan recetas en localStorage/sessionStorage.

El selector sigue combobox/listbox, anuncia selección, admite flechas, Enter,
Escape y botones para quitar etiquetas. Los resultados se anuncian con
aria-live; los controles tienen foco visible y áreas de al menos 44 px. Copiar
borrador significa copiar texto al portapapeles, con alternativa seleccionable;
incluye etiquetas. No crea otra receta.

## Activación y rollback

1. Revisar migración 0066 junto al estado previo, respaldo e historial. Ensayar
   con una conexión directa a PostgreSQL aislado antes de producción.
2. Aplicar la migración aditiva antes de publicar código que consulte etiquetas.
   No se modifican migraciones ni snapshots históricos; 0066 tiene su snapshot.
3. Publicar servidor compatible antes de habilitar la interfaz nueva. En un
   despliegue conjunto, publicar la revisión completa después de migrar y evitar
   enviar tráfico a servidores anteriores mientras se habilita la interfaz.
   La interfaz interpreta tags ausente como []; clientes anteriores omiten tags.
4. Rollback: volver al código anterior conservando tablas y asociaciones.
   No ejecutar DROP ni restaurar un respaldo completo como reversión funcional.

La implementación inicial se ensayó en un contenedor exclusivo con PostgreSQL
18 y fixtures sintéticos. La migración productiva posterior se registra abajo.

## Validación reproducible

Con `FAMILY_UTILS_TEST_DATABASE_URL` apuntando exclusivamente a una base aislada
migrada: `npm test`, `npm run test:routes` y `npm run test:recipes:e2e`.
También: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run db:check`
y `npx drizzle-kit check`.

Las pruebas cubren Unicode y ñ, límites, identidad concurrente, huérfanas,
permisos, snapshots, Menús/Compras, keyset con empates y microsegundos, cursores
inválidos/cambiados, filtros y conteos AND, historial, scroll y conflictos.
Los recorridos de navegador incluyen Chromium en escritorio, iPhone y Android,
con axe. No sustituyen una comprobación manual con lector de pantalla real.

### Verificación local — 10/11/2026

- Suite general: 180 aprobadas, sin omisiones.
- Rutas autenticadas: 136 aprobadas, sin omisiones.
- Recetas: 12 recorridos aprobados en cada modalidad de navegación (actual y
  unificada), en escritorio, iPhone y Android; axe sin hallazgos.
- Lint, tipos, compilación de producción, db:check, drizzle-kit check y diff
  sin errores. Los 57 hashes aplicados coinciden con el repositorio en la base
  sintética recién migrada.
- Paridad SQL/JavaScript comprobada para los 1.446 mapeos de mayúsculas Unicode;
  migración ensayada con recetas anteriores, sin cambiar su contenido.
- Durante la verificación inicial no hubo cambios productivos. El contenedor de pruebas se elimina
  al finalizar; se conservan pruebas, documentación y capturas locales.


## Publicación autorizada — 10/11/2026

La versión se aisló sobre `a913013` (Cine con Cami ya publicado), sin incorporar
los cambios pendientes de navegación general. El catálogo usa un hook propio
para el estado de la URL y conserva compatibilidad con la navegación unificada.
La copia exacta pasó 180 pruebas generales, 136 de rutas y 12 recorridos de
Recetas en escritorio/iPhone/Android, además de lint, tipos y compilación.

Se confirmó el respaldo verificado de hoy:
[ejecución 42804561301](https://github.com/RadikeCosa/family-utils-backups/actions/runs/42804561301).
El enlace requiere acceso al repositorio privado. El ensayo en la rama Neon
`recipes-tags-rehearsal-2026-11-10` (`br-winter-feather-b5d5xcg5`) conservó las
huellas de las diez tablas existentes de Recetas/Menús/Compras comparadas.
El compute de ensayo quedó limitado a 0,25 CU; no se habilitaron servicios pagos.

Después se aplicó únicamente 0066 en `family-utils` / rama `production`
(`br-lucky-bird-b5jop51y`), base `neondb`, por conexión directa. Se verificaron
el prefijo exacto de 56 hashes antes y los 57 hashes después, bajo bloqueo de
migraciones, con lock_timeout de 5 segundos y statement_timeout de 120 segundos.
Las tablas nuevas quedaron vacías y `family_utils_backup_reader` conserva
SELECT en ambas. Las columnas y asociaciones existentes no se modificaron.

La reversión de código conserva ambas tablas y sus datos; no se debe ejecutar
una migración destructiva ni restaurar un respaldo completo como rollback.
