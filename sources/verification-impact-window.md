# Ventana de observación de selección por impacto

Registrar los primeros 20 PR integrados después de activar la selección por
impacto. Una fila por PR: SHA y enlace de ejecución al alcance seleccionado, y
SHA y enlace a la suite completa de `main`. Marcar si `main` descubrió un fallo
reproducible atribuible al cambio que el PR no ejecutó.

Si aparece un caso así, suspender selección por impacto en PR de inmediato.
Completar la fila, corregir catálogo/selector, añadir una regresión y conservar
esta evidencia antes de reactivar. Aplicar la misma regla a incidentes posteriores.

| N.º | PR | SHA y resultado seleccionado | SHA y suite completa en `main` | Suite omitida con fallo atribuible |
|---:|---:|---|---|---|

## Medición del proceso

Registrar por separado estos intervalos, en minutos, usando marcas de tiempo de CI
y del registro de entrega. No combinar desarrollo, suite previa a producción y
operación de publicación en una sola duración:

| PR | Iteración hasta PR listo | Suite completa del candidato | Operación de publicación | Observaciones |
|---|---:|---:|---:|---|

Comparar las medianas después de reunir datos suficientes. La primera ventana no
promete ahorros; sirve para detectar dónde se concentra la espera y si el control
previo a producción sigue siendo el tramo dominante.
