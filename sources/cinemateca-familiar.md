# Cinemateca familiar

Biblioteca se especializa en películas. Páginas canónicas `/cinemateca` y
`/cinemateca/[workId]`; las antiguas redirigen con 308 conservando parámetros,
excepto `kind`, `type` y `cursor`. Las páginas nuevas eliminan esos parámetros
mediante reemplazo de historial y comienzan desde la primera página.

## Contratos y comportamiento

La API sigue en `/api/library`, protegida por `LIBRARY_ENABLED=true` y las reglas
familiares existentes. Escrituras: `kind` omitido equivale a `movie`; cualquier
otro valor devuelve 400 `INVALID`. Esta compatibilidad es permanente, sin retiro
programado. Se mantienen nombres internos e identificadores.

Estados: `pending` (Quiero ver), `in_progress` (Viendo), `finished` (Vista) y null.
Los filtros incluyen `none` para Sin estado. Todas incluye películas sin estado.
`view=common_pending` admite búsqueda y archivo, pero no un filtro personal de
estado (400 `INVALID`). Exige al menos un integrante activo y que todos los activos
hayan marcado Quiero ver. Sin estado bloquea; archivados no participan. Archivar
una película no altera esa condición: `archived=true` selecciona únicamente las
archivadas. El orden sigue siendo actividad/id descendentes; archivo, restauración,
edición y notas no cambian actividad. Los cursores están ligados a familia y filtros,
incluida la vista, pero no a revisiones.

La colección entrega 50 películas por página con todas sus entradas personales,
incluidas las de integrantes archivados. La función compartida de presentación
calcula el promedio en cliente, excluye notas null y muestra un decimal y número
de votos. Las notas siguen siendo enteras 1–5. Reseñas y estado visto siguen siendo
independientes: no se inventan fechas ni aportes.

`revision` usa `families.library_revision`. `accessRevision` expone el contador
existente `families.revision`, que ya aumenta al crear, archivar y restaurar
integrantes (también ante otros cambios de acceso). Ambas participan de ETag y
aviso de cambios; ninguna invalida cursores. Las páginas ya cargadas se conservan
hasta actualizar y pueden reflejar momentos distintos.

## Migración y operación

`0060_cinemateca_movies_only` restringe el campo de texto con CHECK, dentro de la
transacción del migrador Drizzle. Configura `lock_timeout=2s`, toma bloqueo
ACCESS EXCLUSIVE (bloquea brevemente lecturas y escrituras), comprueba tipos y
reemplaza el CHECK. Si hay tipos ajenos, aborta con mensaje explícito; si no puede
obtener el bloqueo, PostgreSQL informa `lock timeout`. No convierte ni borra filas.
Un fallo revierte restricciones e historial; corregir la causa antes de reintentar.
No ejecutar el archivo por sentencias autocommit.

Secuencia productiva:

1. Confirmar respaldo y publicar el código que admite exclusivamente películas.
2. Retirar instancias antiguas capaces de escribir. Clientes viejos que envíen
   otros tipos reciben validación 400; sus borradores se conservan.
3. Ejecutar la migración con la conexión de migraciones y verificar historial.

La compensación está versionada en
[`ops/cinemateca/restore-work-kinds.sql`](../ops/cinemateca/restore-work-kinds.sql).
No se descubre ni ejecuta automáticamente y no debe aplicarse directamente en
producción. Si se decide revertir, copiar su SQL a una NUEVA migración transaccional,
actualizar esquema/snapshot con el CHECK anterior y coordinar la versión compatible
de la aplicación. No modificar migraciones ya aplicadas ni borrar historial.
La compensación solo amplía tipos admitidos; conserva filas y demás restricciones.

## Verificación reproducible

`npm test` incluye `tests/postgres-cinemateca.integration.test.mjs`, por lo que CI
prueba el SQL compensatorio real en cada ejecución, comparando el CHECK restaurado,
la conservación de filas y los tipos admitidos/rechazados. También cubre aborto por
tipos ajenos, bloqueo ocupado, historial y consulta familiar.

La prueba de estrés ejecuta EXPLAIN ANALYZE BUFFERS para primera página y siguiente
con 10.000 películas, 20 integrantes y otra familia. Falla si aparece un escaneo
secuencial de `library_personal` repetido por película; un recorrido global es válido.
La aplicación obtiene entradas personales en una consulta por página, nunca una por
película. Se informan tiempo y buffers como diagnóstico, sin umbral temporal dependiente
de la máquina.

Las pruebas de rutas cubren contratos, permisos, redirecciones, cursores, notas
archivadas y revisiones mediante las operaciones reales sobre integrantes.
Los recorridos de navegador cubren filtros, borradores, normalización de historial,
avisos de cambios, accesibilidad y anchos desde 320 px.

## Resultado local — 5 de noviembre de 2026

- PostgreSQL 18 temporal y exclusivamente sintético: 51 migraciones aplicadas y
  verificadas; 154 casos de reglas/integración satisfactorios, sin omisiones.
- 11 casos de API satisfactorios, incluidas las redirecciones 308 y la paginación
  de pendientes comunes con entradas personales completas.
- 54 recorridos satisfactorios: 18 por entorno en Chromium con tamaños iPhone y
  Android, y WebKit con tamaño iPhone. No equivale a probar un iPhone físico.
- Tres pruebas generales de accesibilidad satisfactorias; colección, diálogo y
  detalle también cubiertos por axe en los recorridos de Cinemateca.
- Compilación, tipos, lint, validación del journal, snapshots y diferencias limpias
  satisfactorios.
- Estrés: primera página aproximadamente 403 ms y siguiente 25 ms en esta máquina;
  sin recorridos secuenciales de entradas personales repetidos por película.
- WebKit requirió bibliotecas compatibles cargadas desde un directorio temporal;
  no se modificó el sistema ni se incorporaron esas dependencias a la aplicación.

Al cerrar la implementación local no se habían publicado cambios ni ejecutado
migraciones en producción.


## Revisión previa a producción — 6 de noviembre de 2026

Diff revisado sobre `d5817d68bd2067cfe03cddc4ba410f9238e25920` de main,
sin incluir el archivo local de carga de Deportes ni cambios privados.
No se encontraron bloqueos de corrección en permisos, paginación, filtro común,
promedios, borradores, redirecciones ni compensación. Se verificó que las
migraciones anteriores y sus snapshots no cambian.

Proyecto Vercel `family-utils` (`prj_SYvr9uLiDCRbuOLyZjNLVaVKn9bO`), equipo
`team_2UTQTPZVu8pM5PQfUR3qQAvy`; Neon `green-meadow-92440811`, rama productiva
`br-lucky-bird-b5jop51y`, base `neondb`. Lectura previa: cinco películas, ningún
otro tipo, 50 migraciones aplicadas hasta `0059_recipe_family_integrity`.

Respaldo diario satisfactorio del 5 de noviembre a las 09:22 UTC, con restauración
verificada en PostgreSQL 18:
[ejecución 42001786273](https://github.com/RadikeCosa/family-utils-backups/actions/runs/42001786273).
La publicación y la migración fueron autorizadas explícitamente en esta sesión.
Se registrarán commit, CI, despliegue y comprobación posterior al finalizar.


El [pulido de UX/UI](./cinemateca-ux.md) describe la colección compacta, estrellas,
acompañantes plegables y validación de formularios sin cambios de API ni esquema.

El cambio posterior de filtros, géneros y valoración está documentado en [cinemateca-generos.md](./cinemateca-generos.md).

La [ampliación de datos y formulario manual](./cinemateca-datos.md) incorpora
duración, reparto y sinopsis, con contratos compatibles y migración aditiva.

La [vista de películas en común por integrante](./cinemateca-pares.md) agrega
conteos y selección de pares, con recuperación de enlaces y sin migraciones.

La [ficha compacta y las vistas de la colección](./cinemateca-ficha-vistas.md)
priorizan la valoración y permiten alternar entre tarjetas y lista, conservando
la preferencia del navegador sin cambios de API o esquema.
