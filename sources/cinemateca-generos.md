# Cinemateca: géneros, filtros y valoración personal

## Contratos y migración

`GENRES` en `src/lib/library/genres.ts` es el catálogo compartido y su orden
canónico. `none` se reserva para el filtro Sin género. La API devuelve `genres`
como array ordenado; omitirlo al crear usa `[]`, omitirlo al editar conserva los
géneros y enviarlo vacío los elimina. Una lista con identificadores desconocidos,
nulos o tipos ajenos se rechaza; duplicados válidos se eliminan.

La migración `0061_cinemateca_genres` añade un array de texto no nulo con valor
vacío. El CHECK generado desde el catálogo comprueba dimensiones con CASE antes
de usar array_position, pertenencia con <@, ausencia de nulos y cardinalidad igual
al número de categorías presentes. Rechaza duplicados incluso en SQL directo.
No contiene subconsultas, funciones propias ni extensiones. PostgreSQL admite
categorías desordenadas; el orden lo garantiza la aplicación al escribir y leer.

La suite PostgreSQL compara el catálogo literal del CHECK con TypeScript, prueba
cada categoría y verifica vacío, desconocidos, nulos, duplicados y múltiples
dimensiones. Agregar categorías exige una nueva migración y actualizar catálogo
y pruebas; las migraciones aplicadas son inmutables.

La migración se ejecuta en la transacción del migrador, con lock_timeout de 2 s y
validación inmediata. Las pruebas cubren bloqueo de ADD COLUMN y del ADD CONSTRAINT
real, aborto sin historial avanzado y conservación de películas, enlaces, notas
y aportes. No se añade GIN. El filtro SQL ocurre antes de paginar y no agrega
consultas por película.

`genre` admite un identificador o `none`; omisión significa todas las categorías.
Un parámetro vacío, desconocido o repetido devuelve 400 INVALID. Cursores de otro
género se rechazan; sin género mantienen su alcance anterior. El filtro también
forma parte del ETag. Géneros usan la versión y revisión existentes sin alterar
la definición de actividad.

Borradores nuevos escriben siempre `genres: []` cuando no hay selección. En los
antiguos se heredan las categorías actuales (vacías al crear). Una lista presente
conserva solo categorías reconocidas, elimina duplicados y ordena. Un tipo ajeno
hereda la selección actual sin perder los demás campos válidos. Se mantiene el
ámbito de familia/integrante y el control de conflictos.

## Entrega y publicación

Tres commits: contratos y migración; colección y formulario; estado y valoración.
Las comprobaciones se realizan en PostgreSQL temporal con datos sintéticos, nunca
contra producción. Para publicar, aplicar primero la migración aditiva y después
el código. Al revertir código se conservan columna y datos. El código anterior
ignora géneros; el cambio de revisión puede causar una revalidación de ETag, lo
cual es aceptable.

## Colección y formulario

Mostrar unifica Todas (sin status/view), Quiero ver (pending), Viendo
(in_progress), Vistas (finished), Sin estado (none) y Pendientes en común
(view=common_pending sin status). Todas no incluye archivadas: Solo archivadas
cambia exclusivamente el archivo. Género y archivo son independientes de Mostrar.
No hay panel de filtros adicionales. Limpiar filtros elimina búsqueda y filtros,
conservando parámetros ajenos. Los selectores tienen como máximo 16 rem; en móvil
se apilan para no cortar nombres. Se retiró la frase introductoria para recuperar
altura sin reducir el texto de los controles.

En páginas, vista común válida prevalece; view inválido se elimina y se conserva
status válido. No se reconocen watching/common como alias. Género vacío,
desconocido o repetido se elimina por completo mediante replace, junto con
kind/type/cursor. Se conservan redirecciones 308 y parámetros ajenos. Cambiar un
filtro o búsqueda reinicia las páginas cargadas; los cursores iniciales se ignoran.

El formulario muestra título, Director/a y año. Géneros usa details/summary
cerrado, con dos nombres y +N. A 320 px las etiquetas se distribuyen en dos
columnas, permiten saltos de línea y mantienen 44 px de alto; con texto ampliado
se redistribuyen a una. Los géneros aparecen en ficha y tarjetas cuando existen.
El enlace deja de aparecer. Al crear se envía null y al editar se envía el enlace
del registro actual, nunca el valor oculto de un borrador recuperado. La API y el
almacenamiento del enlace no se retiran.

## Estado y valoración

Mi estado y valoración presenta radios nativos para Sin estado, Quiero ver,
Viendo y Vista, en dos columnas a 320 px y con redistribución al ampliar texto.
Las estrellas conservan radios nativos, foco y Quitar valoración. En escritorio
ambos bloques comparten fila; el botón Guardar estado y valoración sigue siendo
necesario para persistir. Cambios sin guardar se deriva de la diferencia con los
datos guardados, incluso cuando proviene de un borrador recuperado.

Marcar Vista solo escribe el estado personal: no crea fecha ni aporte. Las
pruebas verifican guardado, recuperación, limpieza de la nota y errores seguros.
Un recorrido con dos clientes cambia el enlace mientras el formulario está
abierto: la versión antigua se rechaza sin escribir y el reintento revisado
conserva el enlace nuevo y el título local. El enlace de un borrador antiguo no
participa de esa escritura.

## Verificación final

A 390 × 844 px, con fuentes cargadas, todos los filtros visibles, título y
Director/a de hasta 40 caracteres, año y dos categorías:

| Medida | Chromium | WebKit | Criterio |
| --- | ---: | ---: | ---: |
| Inicio de primera tarjeta | 543,19 px | 543,19 px | menor que 560 px |
| Final de primera tarjeta | 703,77 px | 709,78 px | hasta 844 px |

La suite contiene 31 recorridos por tres perfiles (dos Chromium y uno WebKit):
93 escenarios cubiertos. La corrida completa aprobó 92; el restante detectó una
precarga del enlace de navegación, independiente de buscar. Se corrigió la
observación del test para limitarla a la búsqueda concreta y navegación real,
y sus tres perfiles aprobaron sin cambios adicionales en la aplicación.

También aprobaron 14 pruebas de reglas, 5 de PostgreSQL, 12 de rutas autenticadas
y 3 recorridos generales de accesibilidad. Se verificaron tipos, lint,
compilación, coherencia de snapshots de Drizzle, orden/hashes de 52 migraciones
y ausencia de errores de whitespace en el diff.

Los navegadores cubren 320, 390, 768 y 1280 px, texto al 200 %, zoom CSS al 200 %,
teclado, análisis axe y contraste forzado en Chromium. Se inspeccionaron capturas
de colección, géneros y valoración. Son comprobaciones automatizadas, no una
prueba con lector de pantalla real ni Safari en un dispositivo físico.

WebKit necesitó contener el texto seleccionado del select (con el menú nativo
intacto) para evitar desbordamiento con zoom; no se oculta desbordamiento en la
página. La recuperación de filtros al volver atrás lee la URL actual, evitando
restaurar parámetros iniciales de una página conservada por el navegador.

Con 10.000 películas, 20 integrantes y otra familia, EXPLAIN (ANALYZE, BUFFERS)
verificó primera página y siguientes sin recorridos completos de library_personal
repetidos por película. La última medición local fue 379,35 ms y 41,43 ms,
respectivamente. No es un compromiso de latencia de producción.

No se publicaron cambios ni se aplicaron migraciones en producción.
