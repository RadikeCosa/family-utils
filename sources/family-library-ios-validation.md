# Seguimiento: validar diálogo de Biblioteca en Safari de iPhone

Estado: pendiente; no bloquea la entrega de Biblioteca.

## Recorrido

1. Abrir alta y edición en Safari sobre un iPhone, con orientación vertical.
2. Enfocar Título y un campo opcional cercano al final; comprobar que el teclado no tape el campo ni las acciones.
3. Desplazarse por el formulario con el teclado abierto, cerrar el teclado y confirmar que el contenido conserva su posición.
4. Rotar el dispositivo en ambos sentidos con el teclado abierto y cerrado.
5. Guardar, cerrar y volver a abrir; comprobar el foco, el bloqueo del fondo y que el diálogo restaure el desplazamiento de la página.

Registrar modelo de iPhone, versión de iOS, tamaños de viewport, resultado y capturas. Si `visualViewport` no está disponible o devuelve dimensiones inválidas, comprobar que el diálogo mantiene el pie visible usando `100dvh`.
