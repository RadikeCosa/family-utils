# Candidato Champions sin cambios UFC

La rama `champions-sin-ufc` parte de `champions-fase-1` y retira la migración
0037, su snapshot y su entrada del journal. También restaura desde `main` el
servidor, la vista, reglas y resultados UFC para conservar el cierre por bloque
que ya existía antes de 0037. El esquema y la prueba de migración dejan de
depender de `ufc_prediction_*` y `prode_eligible`.

Las migraciones Champions 0027–0036 y sus funciones no consultan ni escriben los
campos o funciones de cierre único UFC. La normalización `football_category`
para inserts UFC sigue en 0027; corresponde a la separación de fútbol y no al
cierre de cartelera.

La prueba `tests/postgres-champions-migration.integration.test.mjs` compara ahora
la fila completa de `sports_fights` antes y después de 0027 y comprueba que la
pelea existente sigue presente. No hay aquí una comprobación de `prode_eligible`,
porque esta rama no contiene esa columna.

Typecheck, lint, build y consistencia de migraciones deben ejecutarse de nuevo
en esta rama. Las verificaciones que requieren PostgreSQL quedan **no ejecutado
aquí**; no se consultó producción.
