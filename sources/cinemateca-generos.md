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
