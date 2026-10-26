# Resultados y agenda — 26/10/2026

Carga puntual de River–Racing y UFC 333, con respaldo privado completo anterior (61 tablas, 45 migraciones). Ensayo transaccional con reversión antes de confirmar la misma operación en producción. Se reutilizaron las funciones del importador de agenda y resultados UFC mediante un ejecutor privado de mantenimiento; no se crearon sesiones ni se modificaron controles de acceso.

- River–Racing: **1–0**. Doce estadísticas y cuatro curiosidades en la sección existente de datos del partido. [Resultado y detalle ESPN](https://www.espn.com/soccer/match/_/gameId/401841634/racing-club-river-plate), [estadísticas](https://www.espn.com/soccer/team-stats/_/gameId/401841634). Gol de Lautaro Rivero a los 33 minutos, asistencia de Ángel Correa.
- UFC 333: **14 resultados** cotejados individualmente entre la [cartelera oficial](https://www.ufc.com/event/ufc-333) y ESPN. Cierre y puntuación mediante las funciones existentes de la aplicación; estado completado/finalizado.
- Se conservan pronósticos, comentarios, formaciones y formación oficial. No se modificaron resultados históricos ni partidos de Champions.
- Nueva cartelera: [UFC 334: Gane–Hokit](https://www.ufc.com/event/ufc-334), 14/11/2026, Madison Square Garden, Nueva York. Horarios argentinos: tempranas 19:00, preliminares 21:00, principal 23:00. Doce peleas oficiales. ESPN todavía publica Gordon–Costa y Johnson–Almeida; UFC publica Johnson–Susurkaev y omite Gordon–Costa. Se prioriza UFC y se registra verificación independiente pendiente en la procedencia.
- No se agregó un partido ficticio de River: el [calendario ESPN](https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/16/schedule?fixture=true) sólo devuelve Boca–River (01/11, 15:00) y Aldosivi–River (08/11, fecha provisional y hora pendiente), ambos ya existentes. La fecha 16 termina la fase regular; no se inventa un cruce posterior.

## Datos y bonos UFC

A pedido del usuario se agrega una sección propia en la cartelera seleccionada, usando una copia curada pública en `src/lib/sports/ufc-insights.json`, como el modelo de copia curada del campeonato de River. Sólo aparece para una referencia oficial que tenga datos publicados; cambiar a otro evento no arrastra los datos de UFC 333. Sin migraciones ni consultas adicionales al abrir la pantalla.

[Bonos oficiales UFC 333](https://www.ufc.com/news/bonus-coverage-ufc-333-volkanovski-vs-evloev): actuación de la noche para Alexander Volkanovski y Lone’er Kavanagh; pelea de la noche para Petr Yan y Merab Dvalishvili. No se añade un monto que la fuente oficial consultada no especifica.

Balance calculado sobre los 14 resultados oficiales: siete finalizaciones (seis KO/TKO y una sumisión), siete decisiones y seis finalizaciones en el primer asalto. Datos destacados: primera derrota profesional de Evloev; defensa de Yan por decisión unánime; Pico logra el final más rápido (1:14 del primer asalto); Magomedov logra la única sumisión (1:44 del primero).

Actualizar la copia curada al verificar otra velada, conservando referencias, fuentes y fecha. No se publican comentarios en nombre de los integrantes.

## Verificación

Ensayo y confirmación completados; lectura transaccional posterior confirma los tres estados y las cantidades de peleas/resultados. Comparación exacta de pronósticos, comentarios, formaciones y formación oficial antes y después. Typecheck, lint de componentes y pruebas de importación, resultados y datos River aprobados. Render de la sección comprobado: bonos presentes, y salida vacía al elegir otra referencia, una referencia desconocida o ninguna. Fuentes descargadas, respaldo y evidencia con datos privados quedan en `.release-private/sports-refresh-2026-10-26/`, fuera de Git.
