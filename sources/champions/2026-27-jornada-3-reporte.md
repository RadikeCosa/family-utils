# Jornada 3 · 2026/27 · dos vistas previas sin token

Los datos se tomaron del calendario oficial UEFA de la fase liga, actualizado el 14/10/2026, y los IDs de la página oficial de clubes, consultados el 17/10/2026. Los horarios se corroboraron contra Sky Sports, la web oficial del FC Barcelona y otros calendarios GMT/CET. ESPN no tiene cobertura de esta temporada. Queda pendiente la revalidación humana del 19/10/2026 por la mañana (Argentina).

| Ejecución | HTTP | Partidos | Equipos | Errores | Token |
| --- | --- | --- | --- | --- | --- |
| Primera vista previa | **200** | **18** | **36** | **0** | No emitido |
| Segunda vista previa, mismos datos | **200** | **18** | **36** | **0** | No emitido |

**Respuestas idénticas.** Se usó `mode: preview, issueToken: false` con administrador real y PostgreSQL aislado local. No se envió confirmación de Jornada 3. Se comprobaron **0 registros deportivos nuevos**, incluyendo partidos, equipos, temporadas, jornadas, referencias y auditoría. Repetir una lectura no duplica entidades; no se afirma haber confirmado una importación de estos datos. La idempotencia de importación se cubre aparte con datos sintéticos en la suite.

Archivo actualizado: `2026-27-jornada-3-agenda.borrador.json`. Respuesta completa y comprobaciones: `2026-27-jornada-3-vista-previa.json`. Ambos preservan la fuente y la discrepancia publicada CET/CEST.

`checkedAt` conserva su valor actual **provisional** (`2026-10-17T00:00:00Z`). La hora real se consignará durante la **revalidación del 19/10/2026 por la mañana, Argentina**, tal como queda anotado en el JSON. El archivo conserva el nombre borrador por esa revisión pendiente y porque esta tarea no autoriza confirmación.

## Comprobación de los 18 pares local/visitante

Cada tripleta se contrastó con el calendario oficial UEFA y la página oficial de clubes: ID de partido, ID local e ID visitante. Los nombres se contrastaron también con la lista de los 36 equipos. **18/18 coinciden.**

| Día | Partido (local primero) | ID partido UEFA | ID local | ID visitante | Hora Argentina |
| --- | --- | --- | --- | --- | --- |
| 20/10 | Fenerbahçe vs Slavia Praha | 2049595 | 52692 | 52498 | **13:45** |
| 20/10 | Sabah vs Borussia Dortmund | 2049597 | 2609356 | 52758 | **13:45** |
| 20/10 | Roma vs Slovan Bratislava | 2049592 | 50137 | 52797 | **16:00** |
| 20/10 | Porto vs PSV Eindhoven | 2049593 | 50064 | 50062 | **16:00** |
| 20/10 | Liverpool vs Villarreal | 2049590 | 7889 | 70691 | **16:00** |
| 20/10 | Manchester City vs AEK Athens | 2049591 | 52919 | 50129 | **16:00** |
| 20/10 | Paris Saint-Germain vs Barcelona | 2049589 | 52747 | 50080 | **16:00** |
| 20/10 | Napoli vs Bodø/Glimt | 2049594 | 50136 | 59333 | **16:00** |
| 20/10 | Stuttgart vs Atlético de Madrid | 2049596 | 50107 | 50124 | **16:00** |
| 21/10 | Como vs Manchester United | 2049606 | 79946 | 52682 | **13:45** |
| 21/10 | Lille vs Galatasaray | 2049605 | 75797 | 50067 | **13:45** |
| 21/10 | Aston Villa vs Viking | 2049602 | 52683 | 52319 | **16:00** |
| 21/10 | Club Brugge vs Lens | 2049603 | 50043 | 52277 | **16:00** |
| 21/10 | Bayern München vs Arsenal | 2049598 | 50037 | 52280 | **16:00** |
| 21/10 | Inter vs Shakhtar Donetsk | 2049600 | 50138 | 52707 | **16:00** |
| 21/10 | Real Madrid vs Leipzig | 2049599 | 50051 | 2603790 | **16:00** |
| 21/10 | Real Betis vs Feyenoord | 2049604 | 52265 | 52749 | **16:00** |
| 21/10 | Sporting CP vs LASK | 2049601 | 50149 | 63405 | **16:00** |

**18/18 horarios correctos:** 4 a las 13:45 y 14 a las 16:00 de Argentina, 9 partidos por día. Conversión comprobada en PostgreSQL con `America/Argentina/Buenos_Aires` y `Europe/Paris`: el 20 y 21/10 rige CEST (UTC+02:00), aunque los datos publicados se rotulan CET.

## Prueba de rechazo de marcador diferente

`tests/sports-champions-results.integration.mjs`, caso `different score reimport fails clearly and preserves events, results, picks, closures and audit`:

- Con un resultado existente, presentar otro marcador devuelve 400 con mensaje explícito: ya existe un resultado distinto y las correcciones requieren el flujo auditado del Bloque 8.
- No entrega token. Intentar confirmación sin vista previa válida devuelve 409.
- Compara filas completas de partidos, resultados, elecciones, cierres y auditoría antes/después; todas iguales.
- La prueba anterior de reimportación idéntica continúa activa y comprueba que no duplica ni vuelve a auditar.

## Bloque 5

Hilo único identificado por UUID de jornada, independiente de los días y de reprogramaciones. Almacenamiento aditivo separado de conversaciones River/UFC. Edición del autor, retiro del autor o administrador, versiones para conflictos y aislamiento por familia.

Borradores de comentario nuevo y edición independientes por familia/integrante/jornada; conservados entre jornadas, pestañas y renovaciones de la pantalla Deportes. Una respuesta demorada no limpia texto posterior; fallos y conflictos conservan lo escrito. Se mantienen en memoria de Deportes, sin prometer persistencia al recargar, cerrar la pestaña o salir de esa pantalla.

Navegación por teclado con foco al encabezado de la jornada, un solo acceso al hilo y comprobaciones de móvil/escritorio/axe. Corrección de contraste de fechas limitada al hilo Champions.

## Verificación completa del cierre

- Tipos, lint, compilación y **33 migraciones aplicadas con hashes verificados**: correctos.
- Reglas/base: **98/98**, 0 omitidas.
- Rutas: **100/100**, 0 omitidas. Antes eran 91; se agregan los dos casos previos pedidos y siete verificaciones contadas por el runner para el hilo (grupo y seis casos).
- Recorridos generales: **111/111**.
- Recorridos deportivos anteriores: **12/12**.
- Recorridos Champions: **24/24**; conserva los 12 anteriores y agrega 12 de hilo/borradores.
- Accesibilidad general: **3/3**.
- Total navegador/accesibilidad: **150/150**, 0 omitidos. No se eliminó ni saltó ningún recorrido.
- Revisión visual adicional del hilo publicado en iPhone y escritorio: capturas verificadas; ambos recorridos de captura pasan.

Las pruebas usan exclusivamente PostgreSQL aislado y sesiones reales. La auditoría de búsquedas, decisiones y cobertura está en `../deportes-champions-auditoria.md`.

## Qué falta para abrir el prode

**Bloqueante:** Bloque 6 (interruptor persistido por familia, bloqueo de todos los endpoints y regresión con apagado), revalidación de la agenda el 19/10 por la mañana con hora real en checkedAt, verificaciones finales y publicación ordenada por el usuario. Los 54 IDs UEFA ya están completos y la vista previa es válida. No se inició el Bloque 6 ni se tocó producción.

**Puede llegar después de abrir pronósticos, pero antes del primer resultado real:** Bloques 7 (resolución administrativa de suspendidos) y 8 (correcciones auditadas con confirmación y recálculo).

Corte duro: **19/10/2026 a las 18:00 de Argentina**. Si falta un requisito obligatorio en verde, el estreno pasa a Jornada 4, sin reducir pruebas. Con el Bloque 6 pendiente, todavía no corresponde abrirlo.

## Actualización aprobada — ensayo de confirmación y Bloque 6

El reporte anterior describía la etapa de dos vistas previas sin token. Esta sección la actualiza: el ensayo autorizado posterior sí confirmó el archivo, exclusivamente en la base local aislada. Producción no fue consultada ni modificada.

`2026-27-jornada-3-ensayo.json` registra: primera confirmación HTTP **200**, **18 partidos**, **36 equipos**, cero errores; segunda confirmación del mismo archivo HTTP **200**, `changed:false`, sin diferencias en filas de dominio ni auditoría. Cada ID de partido y sus equipos local/visitante coincide con las referencias de las páginas oficiales UEFA consignadas en el archivo. Conversión verificada: **4 × 13:45** y **14 × 16:00** de Argentina; nueve partidos por día. Dos integrantes autenticados guardaron elecciones distintas; cada uno recibió únicamente la propia, y el administrador no recibió elecciones ajenas.

El Bloque 6 está implementado y probado: bandera ambiental y registro por familia, ambos necesarios; lecturas frescas; bloqueo compartido en transacciones de escritura y bloqueo exclusivo al apagar; apagado transversal de lecturas y escrituras Champions, incluyendo rutas genéricas e importadores; aislamiento familiar; River/UFC sin cambios y datos conservados. `publicacion-runbook.md` contiene el orden de publicación, comprobaciones y reversión por paso.

### Verificación completa al cierre del Bloque 6

- Tipos, lint, compilación y **34 migraciones con hashes verificados**: correctos.
- Reglas/base: **98/98**.
- Rutas: **102/102**.
- Recorridos generales: **111/111**.
- Deportes anteriores: **12/12**.
- Champions: **28/28**.
- Accesibilidad: **3/3** (repetida después de fijar el servidor del runner a la misma base aislada que prepara fixtures).
- Total de recorridos de navegador/accesibilidad informados: **154**, sin omisiones.
- La prueba de concurrencia cubre una escritura HTTP en curso contra el apagado: el apagado espera la confirmación de la escritura que ya obtuvo bloqueo compartido y después bloquea nuevas escrituras.

**Bloqueante para abrir Jornada 3:** seguir el runbook: respaldo y restauración de ensayo, aplicación y verificación de migraciones, despliegue apagado, revalidación de fuentes y `checkedAt` real el 19/10 por la mañana, importación en despliegue temporal protegido, comprobación, despliegue habilitado, retiro del acceso temporal y verificación del apagado operativo. Todo debe quedar verificado antes del corte duro del **19/10/2026 18:00 Argentina**; si no, el estreno pasa a Jornada 4. No se hizo ningún paso en producción.

**Puede llegar después de abrir pronósticos, pero antes del primer resultado real:** Bloque 7 (resolución administrativa de suspendidos) y Bloque 8 (correcciones auditadas y recálculo). No se iniciaron según la instrucción.

La repetición final de accesibilidad encontró una desalineación del runner: fixtures en `champions_test` y servidor Next apuntando al `DATABASE_URL` local. Se ajustó `playwright.a11y.config.ts` para pasar explícitamente la URL de test al servidor, y la suite volvió a correr completa: **3/3**. No se omitieron pruebas.

## Cierre de los Bloques 7 y 8; revisión del plan completo

Se completaron la resolución administrativa de suspendidos y el flujo de correcciones. El resultado oficial exige fuente UEFA y marcador definitivo a 90 minutos. La anulación guarda motivo y auditoría, mantiene el estado deportivo `suspended` y aparece como “Anulado para el prode”; no crea resultado. Cancelados y anulados quedan fuera de partidos computables. No se admiten marcadores parciales.

Una corrección muestra marcador anterior y nuevo; el administrador debe confirmarla explícitamente. El token firmado de 15 minutos liga actor, familia, archivo y estado; la confirmación revalida bajo bloqueo. Dos administradores en carrera dejan una sola corrección y el segundo recibe 409; una vista previa obsoleta también se rechaza. El recálculo lee los resultados vigentes. La corrección cerrada no modifica ni revela elecciones abiertas, y auditoría/correcciones no contienen valores de pronósticos.

La matriz de requisito por requisito está en [verificaciones-fase-1.md](verificaciones-fase-1.md). No quedaron verificaciones de código del plan sin prueba automatizada; se señalan aparte los pasos que solo pueden completarse en la publicación. `permisos-check.sql` enumera las 12 funciones deportivas locales, informa permisos para PUBLIC, anon y authenticated, y terminó sin excepciones, con los tres permisos en `false` para cada función. El runbook indica ejecutarlo tras migrar producción.

### Verificación final

- Accesibilidad con el runner definitivo: **3/3**. El diff del runner solo pasa la URL aislada al servidor Playwright; no modifica ni elimina casos ni aserciones.
- Pruebas de integración de resultados, suspensión y correcciones: **10/10**.
- Tipos, lint, compilación y **36 migraciones aplicadas/verificadas** en la base local: correctos.
- La matriz documenta todas las demás suites de Fase 1, conservadas sin reducción; se repetirá la suite completa al terminar la implementación final.

**Bloqueante para abrir Jornada 3:** publicación por el usuario y verificaciones productivas del runbook, incluyendo el chequeo SQL de permisos, `checkedAt` revalidado y prueba de apagado. No se consultó ni modificó producción. Si no se completan antes del **19/10/2026 18:00 Argentina**, el estreno pasa a Jornada 4.

**Puede llegar después de abrir pronósticos:** no queda ningún bloque de código pendiente. La preparación de la publicación es el único bloqueante de lanzamiento; los Bloques 7 y 8 ya están implementados aunque deberán probarse también durante su ensayo protegido antes del primer resultado real.

## Revalidación final después de los ajustes

- Tipos, lint, build y migraciones: aprobados; **36/36** migraciones/hashes en la base local aislada.
- Reglas/base: **98/98**, cero omitidas.
- Rutas: **103/103**, cero omitidas; se ejecutaron en serie para evitar interferencia entre pruebas que crean/revocan el mismo rol PostgreSQL `anon`. No se quitó ningún caso.
- Navegador general: **111/111**.
- Recorridos Deportes/River/UFC: **12/12**.
- Recorridos Champions: **32/32**.
- Accesibilidad: **3/3**. El diff de `playwright.a11y.config.ts` solo añade `DATABASE_URL: process.env.FAMILY_UTILS_TEST_DATABASE_URL` al entorno del servidor de prueba. No altera pruebas, aserciones, perfiles, filtros ni reglas de ejecución.
- Total de navegador y accesibilidad: **158/158**, cero omitidos. WebKit se ejecutó con la biblioteca `libavif` ya presente en `/tmp/champions-webkit-deps` y una copia temporal del navegador; no se cambiaron las suites ni se instalaron paquetes del sistema.
- `permisos-check.sql`: **12/12** funciones deportivas locales; PUBLIC, anon y authenticated figuran `false` en todas. El script concluye sin excepción. PUBLIC se inspecciona por ACL porque PostgreSQL lo trata como pseudorol; anon y authenticated usan `has_function_privilege`.
- La matriz [verificaciones-fase-1.md](verificaciones-fase-1.md) enlaza cada requisito automatizable con su prueba exacta. No queda requisito de código sin prueba ni se redujo cobertura.

**Bloqueante para abrir Jornada 3:** únicamente la publicación operativa que ejecutará el usuario: respaldo y ensayo de restauración, migraciones en producción y chequeo SQL de permisos, despliegue temporal protegido, revalidación UEFA de agenda y `checkedAt`, importación y verificación, despliegue final, retiro comprobado del acceso temporal y ejercicio de apagado. Producción no fue consultada ni modificada. Si no se completa antes del **19/10/2026 18:00 Argentina**, el estreno pasa a Jornada 4.

**Puede llegar después:** nada de los Bloques 7 u 8 queda pendiente en código o pruebas. Antes del primer resultado en producción, se debe cargar un resultado oficial verificado; la anulación de suspendidos y el flujo auditado de corrección ya están implementados y ensayados localmente.


## Revalidación final en copia limpia

La copia limpia sobre el cierre UFC 0037 publicado y la corrección `ed9d679`/`4d54860` (`538d88f`) pasó tipos, lint, build y `db:migrate`: **38 migraciones en orden y 38 hashes aplicados verificados**. En PostgreSQL aislado: reglas/base **106/106**, rutas **103/103**, recorridos generales **111/111**, Deportes **20/20**, Champions **32/32** (iPhone, Android, WebKit iPhone y escritorio) y accesibilidad **3/3**; cero omitidas. `npm ci --offline` completó desde la caché npm local copiada a `/tmp` (417 paquetes); el gestor advirtió que 4 scripts de instalación no estaban aprobados por su lista de permisos. Tipos, lint y build pasan con esa instalación.

El ensayo desde la copia limpia `538d88f` confirmó HTTP 200, 36 equipos, 18 partidos y cero errores; la reimportación devolvió `changed:false` y no alteró filas ni auditoría. Los 18 pares UEFA coinciden, nueve partidos por día; Argentina: 4 a las 13:45 y 14 a las 16:00. Dos integrantes solo recibieron su propio pronóstico y el administrador recibió `choices: []`. El registro actualizado está en `2026-27-jornada-3-ensayo.json`; la base usada es aislada.

Procedencia registrada: calendario oficial UEFA de fase liga actualizado el 14/10/2026 y página oficial de clubes consultados el 17/10/2026; horarios corroborados contra Sky Sports, FC Barcelona y otros calendarios GMT/CET; ESPN no cubre esta temporada. La revalidación humana y el `checkedAt` real siguen pendientes para el 19/10 por la mañana.

**Bloqueante para publicar:** todos los pasos manuales del runbook de producción y la revalidación humana. Si no están verificados antes del 19/10/2026 18:00 Argentina, el estreno pasa a Jornada 4. No se tocó producción.


La regresión UFC se ejecutó con el cierre de cartelera 0037 publicado y puntuación vigente de 1 por acierto. La puntuación 5/3/1 no está publicada: permanece aislada en `codex/ufc-puntajes` hasta `6b0d547`, para integrarla tras Champions reconciliando el registro y snapshot.
