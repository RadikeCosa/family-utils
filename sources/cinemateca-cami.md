# Cine con Cami

Selección compartida por familia, independiente de géneros, estados personales y
coincidencias entre integrantes. El nombre es fijo para todas las familias.
Se administra desde Agregar película y Editar datos. Ver una película no la quita;
archivarla conserva la selección y requiere restaurarla para editarla.
No se migran automáticamente películas del género Familiar.

## Contratos y consistencia

`library_works.cine_with_cami` es booleano NOT NULL DEFAULT false, agregado por
`0065_cine_con_cami`. La API devuelve `cineWithCami` en colección y ficha.
Crear sin el campo usa false; editar sin el campo conserva el valor almacenado.
Solo se aceptan booleanos. Se reutilizan autorización familiar, versión de película,
auditoría genérica y revisión familiar. No hay un nuevo endpoint ni índice.

`selection=cine_with_cami` se combina con `archived=true`, búsqueda, género,
estado y vistas de coincidencias. La API rechaza valores vacíos, desconocidos y
repetidos. La página los elimina al normalizar, conservando los otros filtros.
El filtro SQL se aplica antes de paginar y a los conteos de pares. Forma parte de
cursores y ETags (`library-v5`). Limpiar filtros también elimina la selección.

Los borradores usan `cineWithCami: null` como ausencia de elección local, incluso
al persistir otros cambios. Los borradores antiguos y los campos inválidos heredan
ese valor. La casilla deriva su estado de la película actual hasta ser tocada;
el guardado omite el campo heredado para preservar el valor del servidor.
Los booleanos explícitos se recuperan y comparan en la revisión de conflictos
con la etiqueta Cine con Cami y los valores Incluida / No incluida.

## Publicación y reversión

Aplicar primero la migración y después el código. La migración usa lock_timeout
de 2 segundos y la transacción del migrador. Volver al código anterior conserva
columna y selecciones: el cliente anterior no escribe el campo. No borrar la
columna ni revertir datos para volver atrás.

La implementación y las pruebas locales usan exclusivamente PostgreSQL temporal
y familias sintéticas. No se publica ni se migran datos familiares como parte de
la entrega. Para recorridos paralelos a un servidor local existente puede usarse
PLAYWRIGHT_PORT; por defecto se mantiene el puerto 3318.

## Verificación local — 10 de noviembre de 2026

- 48 pruebas de reglas, API autenticada, restricciones, migraciones y consultas,
  todas satisfactorias, sin omisiones, sobre PostgreSQL 18 temporal.
- Tipos, lint, compilación de producción, coherencia de snapshots y orden de las
  56 migraciones satisfactorios. También pasó la compilación integrada con los
  cambios de navegación que se estaban desarrollando simultáneamente.
- 141 recorridos completos de Cinemateca aprobados en la copia aislada: 47 por
  perfil de navegador, sin omisiones.
- Nueve recorridos de integración de la selección y colección compacta aprobados
  en el espacio compartido: Chromium iPhone/Android y WebKit iPhone. Incluyen
  accesibilidad, borradores heredados/explícitos, conflictos, error de guardado,
  historial, archivo, etiquetas y texto ampliado a 320 px.
- A 390 × 844 px la primera tarjeta empieza en 590,19 px y termina en 834,95 px
  en Chromium y 840,97 px en WebKit. El nuevo filtro visible agrega una fila;
  el presupuesto de inicio de la prueba pasa de 560 a 610 px y se mantiene el
  requisito de tarjeta completa dentro de 844 px, compactando espacios.
- Con 10.000 películas y 20 integrantes, selecciones de 1 % y 50 % no provocan
  escaneos completos repetidos de estados personales por película. Conteos de
  pares: aproximadamente 3,5 y 48,4 ms frente a 71,3 ms sin selección. Primera
  página: 17,2 y 275,4 ms frente a 403,9 ms; siguientes: 20,7 y 28,7 ms frente
  a 33,8 ms. Son mediciones locales, no compromisos de latencia en producción.

La suite completa se verifica además sobre una copia de HEAD con los cambios
exclusivos de esta funcionalidad, para separar la validación de la modificación
simultánea de navegación. WebKit usa bibliotecas ya existentes en /tmp, sin
instalar dependencias del sistema. No se publica ni se migra producción.
