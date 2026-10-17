# Puntajes UFC: borrador separado, no publicar

Esta rama conserva el trabajo 5/3/1 que estaba incorporado en el historial de
Champions. No se aplicó ninguna migración ni despliegue de puntajes.

La base anterior de esta rama reproduce el cierre efectivamente publicado con
un punto por acierto. El siguiente commit contiene únicamente el borrador de
puntajes, sus etiquetas y las pruebas trasladadas desde Champions. La corrección
de Champions está en `codex/champions-separar-ufc`; no revierte el cierre.

## Requisitos antes de publicar

- Aplicar 5 puntos totales por ganador de estelar, 3 por coestelar y 1 por el resto,
  desde la cartelera del 17/10/2026 y las siguientes. Las anteriores mantienen 1.
- Guardar la regla por evento; el cálculo actual no recibe versión ni fecha y
  recalcularía históricos. La tabla de hoy incluye los votos/resultados guardados.
- Identificar la coestelar explícitamente y congelar su puntaje al cierre. El
  borrador la infiere por `bout_order`, por lo que un reordenamiento cambia los 3
  puntos. No transferir bonos por cancelación ni por altas posteriores al cierre.
- Mantener el JSON de resultados, la carga parcial, la privacidad y los cierres.
- Incorporar pruebas de históricos y reordenamiento tras cierre, además de las
  pruebas actuales de 5/3/1, correcciones, empate y cancelación.
- Registrar cualquier migración nueva sin modificar la ya publicada ni omitir
  las migraciones de Champions pendientes. Confirmar el historial productivo.
- Publicar solo UFC y después integrar sus commits en la línea de Champions,
  volviendo a comprobar ambas funcionalidades. Este borrador no es una entrega
  terminada y no debe promoverse tal cual a producción.

## Verificación del borrador aislado

Compilación y lint correctos; 99 pruebas generales y 6 recorridos Desktop
Chromium aprobados sobre una base local con las 28 migraciones de la línea
publicada. El recorrido UFC verifica puntajes, empate, cancelación y correcciones,
pero no sustituye las pruebas pendientes de históricos y coestelar congelada.
La consulta de prueba River usa el esquema anterior a Champions y el puerto de
pruebas puede elegirse con `SPORTS_NEXT_TEST_PORT` (3318 por defecto). No se
usaron credenciales de producción ni se publicó esta rama.
