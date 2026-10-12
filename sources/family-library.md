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
| DELETE aporte | `expectedVersion`; retirada lógica únicamente por su autor |

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
- Etapa 1: modelo y contratos preparados; migración probada localmente, pendiente
  de integración, ensayo Neon/Preview y aplicación productiva. **No aplicada en producción.**
- Las etapas 2–5 todavía no están implementadas.

El número de migración se decide al integrar. La segunda rama rebasa y regenera
SQL, journal y snapshot sobre main. No modificar migraciones ya integradas/aplicadas.
`npm run db:migrate` valida timestamps crecientes y luego verifica todos los hashes
y timestamps aplicados; una migración saltada por Drizzle debe fallar explícitamente.

Ensayo: una rama Neon schema-only, reconstruida desde migraciones y fixtures, sin
copiar filas productivas ni resetear desde producción. Verificar vaciado antes de
crear credenciales exclusivas Preview; todavía pendiente de acceso remoto. El
navegador integrado no tiene pestañas abiertas en la comprobación de esta entrega.

Antes de cada migración productiva: respaldo diario satisfactorio. Prueba de
restauración única cubierta por la evidencia anterior. Directa para migraciones;
agrupada para aplicación. Mantener planes gratuitos.

Cierre: etapas y CI completos, smoke productivo de lectura, piloto auténtico,
evidencias guardadas y ausencia de dependencias/datos exclusivos. Inventariar y
obtener aprobación explícita antes de retirar recursos externos y credenciales.
No hay migración destructiva de rollback: deshabilitar utilidad conserva datos.
