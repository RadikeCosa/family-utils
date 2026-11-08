# Cinemateca: formulario manual y metadatos

## Uso

Crear y editar comparten dos bloques: Datos principales y Sinopsis y reparto,
plegado inicialmente. Solo el título es obligatorio. En móvil el foco inicial
queda en el encabezado para no abrir el teclado. El pie contiene guardar y cerrar;
el descarte se ofrece fuera del pie cuando hay cambios y requiere confirmación.

La duración se introduce en minutos (1–1440) y se presenta con unidades abreviadas
y una lectura accesible completa. Sinopsis y reparto se muestran en la ficha,
antes de las experiencias personales. Las tarjetas incorporan duración y todos
los géneros como badges neutros que se distribuyen en varias filas.

## Contratos

Los endpoints existentes añaden `runtimeMinutes`, `cast` y `synopsis`. Al crear,
la omisión produce `null`, `[]` y `null`; al editar, conserva el valor actual.
Duración solo acepta entero 1–1440 o null; `""`, cero y fracciones son inválidos.
Reparto acepta hasta 30 nombres; `[]` lo limpia y null es inválido. Sinopsis admite
hasta 5000 puntos de código; null, vacío o solo espacios se guardan como null.

Cada nombre se normaliza con NFC, recorte y compactación de espacios antes de
medir sus 1–200 puntos de código. La deduplicación usa `.toLowerCase()`, conserva
acentos y respeta la primera escritura y posición. No aplica case folding.
Los límites cuentan puntos de código, no grafemas. Sinopsis convierte CRLF y CR
a LF antes de recortar extremos y medir; conserva sus saltos interiores.

El pegado divide por líneas y omite líneas vacías. La capacidad se calcula sobre
la combinación única de nombres existentes y nuevos. Una incorporación inválida
se rechaza completa y conserva el texto pendiente. Guardar procesa también ese
texto aunque no se haya pulsado Agregar nombres.

## Borradores y conflictos

El almacenamiento sigue siendo sessionStorage, por familia, integrante y operación.
Se recuperan borradores antiguos y los nuevos guardan también el reparto pendiente.
Las pestañas independientes no comparten escrituras; las aperturas de la aplicación
usan noopener. La función Duplicar pestaña del navegador puede copiar el estado inicial.

La comparación de versiones se presenta por campos, apilada, con listas para reparto
y expansión de textos largos. Conservar el borrador no guarda automáticamente:
reconoce la versión actual y advierte que el guardado reemplazará todos los datos
editables, incluso los que el usuario no tocó. Otro cambio produce otro conflicto.
Un reparto pendiente inválido impide aceptar el borrador hasta corregirlo.

## Migración y publicación

`0062_cinemateca_metadata` añade runtime_minutes, synopsis y `cast text[] NOT NULL
DEFAULT '{}'`. Los CHECK imponen rango, cantidad, dimensiones, ausencia de nombres
nulos/vacíos y longitudes. La función SQL inmutable library_cast_is_valid valida
los elementos. La normalización y la deduplicación corresponden a la aplicación;
la base acepta nombres repetidos o no normalizados que cumplan los límites.

La migración es aditiva, transaccional y usa lock_timeout de 2 segundos. Su validación
inmediata puede escanear y bloquear la tabla hasta finalizar la transacción. Las
migraciones anteriores permanecen intactas. La representación usa ETags library-v3.

Antes de integrar hay que volver a comprobar numeración y timestamp del journal.
Para publicar, aplicar primero la migración y después el código. Revertir el código
conserva columnas y valores; no restaurar una base completa para revertir esta UI.

## Verificación

Las pruebas cubren contrato, Unicode, pegado atómico, borradores parciales, pestañas,
contadores, errores ocultos, conflictos sucesivos, duración de 24 horas, géneros
completos, foco, axe y reflujo con texto ampliado. PostgreSQL temporal comprueba
conservación, restricciones y aborto por bloqueo sin avanzar el historial.

La suite de rutas admite LIBRARY_LEGACY_ROOT para iniciar una copia compilada del
código anterior junto al servidor nuevo. La verificación local se ejecutó con la
versión f3138f3 contra el esquema ampliado: lee, edita y preserva los metadatos.
Las verificaciones usan datos sintéticos; esta entrega no aplica migraciones ni
publica en producción.
