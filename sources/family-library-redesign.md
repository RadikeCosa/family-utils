# Rediseño de Biblioteca familiar — octubre de 2026

La colección presenta tarjetas compactas con íconos por tipo. La búsqueda usa categorías seleccionables y filtros adicionales; texto, categoría, estado y archivo se reflejan en la URL sin navegación de servidor. El alta y la edición se realizan en un diálogo que conserva borradores por familia e integrante. Una edición con versión desactualizada exige comparar los datos y elegir cómo continuar.

No se cambiaron tablas, migraciones, códigos ni estructura de las respuestas de la API. La búsqueda por URL es el comportamiento público nuevo.

## Medición visual

En Chromium con viewport de **390 × 900 px**, la misma tarjeta “Una película”, con “Equipo familiar · 2024”, medía **239,25 px** en `main` antes del cambio y mide **103,203125 px** después: **56,9 % menos** de altura. Las capturas locales y la prueba de diseño cubren 320, 390, 768 y 1280 px; también se comprueba ausencia de desbordamiento a 320 px con zoom de 200 %.

## Verificación

- Tipos, lint, compilación, 63 pruebas de lógica e integración y 52 pruebas de rutas satisfactorias contra PostgreSQL local aislado.
- 39 recorridos de Biblioteca satisfactorios en Chromium (tamaños iPhone y Android) y WebKit (tamaño iPhone). WebKit se aplica a Biblioteca, que es el alcance de este rediseño. Incluyen borradores, duplicados, búsqueda por URL, composición, conflictos, ausencia de contenido y mediciones de grilla.
- Tres pruebas generales de accesibilidad satisfactorias. Las pruebas de Biblioteca comprueban automáticamente WCAG con axe en colección, diálogo y detalle.
- WebKit y las pruebas controladas de `visualViewport` detectan diferencias de motor y errores de dimensiones. No reproducen el teclado virtual ni el cambio real de viewport de Safari en iPhone. El [seguimiento para iPhone](./family-library-ios-validation.md) contiene el recorrido pendiente.

El servidor de prueba usó exclusivamente `family_utils_codex_library_test` en PostgreSQL local; no se escribieron datos de prueba en producción.
