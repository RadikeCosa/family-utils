# Separación de la puntuación UFC

Esta rama conserva Champions, sus diez migraciones pendientes y las adaptaciones
para convivir con el cierre UFC ya publicado. No reescribe commits anteriores ni
modifica los hashes o el orden de migraciones de producción.

La puntuación publicada sigue siendo un punto por acierto. Los campos, textos y
pruebas de 5/3/1 permanecen en `codex/ufc-puntajes` hasta `6b0d547`; no forman
parte de esta rama ni de la publicación de Champions.

Se restauran también los contratos del código UFC efectivamente publicado: la
vista previa firma el estado actualizado después de congelar el cierre, la
lectura de votos requiere indicar explícitamente el integrante o el contexto de
resultados, y el retiro sin elección comprueba el reloj igualmente.

No revertir entero `2000606`: contiene el cierre único ya publicado en `0037`.
La corrección del contrato UFC de `ed9d679`/`4d54860` ya está aplicada en esta
rama de Champions. La puntuación 5/3/1 se integrará después de publicar Champions,
conciliando entonces el registro y el snapshot de migraciones.

Antes de integrar 5/3/1 deben implementarse la vigencia desde el 17/10/2026 sin
alterar carteleras anteriores y la identidad/puntuación congelada de la coestelar.
Después de integrarla, volver a ejecutar las regresiones de Champions y UFC sobre
una base aislada.

## Verificación de la separación

- Compilación de producción y lint correctos.
- Suite general: 106 pruebas aprobadas en Postgres local aislado.
- Rutas de Champions y fútbol: 44 pruebas aprobadas.
- Navegador Desktop Chromium: 5 pruebas aprobadas, incluida privacidad UFC,
  cierre común, pantalla abierta y confirmación de resultados parciales.
- Se conserva sin cambios la prueba de migración Champions que compara datos
  legados y verifica por separado `prode_eligible=true`. No cambian migraciones,
  hashes ni registro.
- `SPORTS_NEXT_TEST_PORT` permite ejecutar estas pruebas sin ocupar el puerto
  del otro trabajo; por defecto conserva 3318. Se usaron claves ficticias locales.
- La corrección está incorporada en la rama local `champions-fase-1`; no se ha
  publicado ni desplegado. La puntuación 5/3/1 sigue separada y pendiente.
