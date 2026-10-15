# Benchmark de UX/UI para Deportes

Fecha: 15 de octubre de 2026. Investigación inicial para orientar el diseño después de probar la actualización en una versión de review. No modifica la implementación.

## Alcance y evidencia

Se consultaron páginas oficiales y documentación de producto. Se inspeccionó visualmente la página de descarga de FotMob, con sus vistas de la app, y la página de eventos de UFC en español. Para Sofascore se revisó su artículo oficial de rediseño; para Strava, sus referencias públicas sobre comunidad y comentarios. No se probaron las apps nativas ni se realizó un estudio con usuarios. Las propuestas siguientes son criterios de diseño, no resultados de usabilidad medidos.

## Referencias

| Referencia | Patrón observado o documentado | Aplicación propuesta |
| --- | --- | --- |
| [FotMob](https://www.fotmob.com/download) | Vistas de app con fondos claros, filas regulares y jerarquía de equipos y marcadores. | Ficha de River de lectura rápida: equipos, fecha y hora, torneo, cancha y canal. Mantener alineaciones consistentes y números fáciles de comparar. |
| [Sofascore: rediseño](https://www.sofascore.com/news/sofascores-new-home-screen-a-smarter-faster-way-to-follow-sports) | Cambio de deporte arriba, favoritos y filtros por estado. | Mantener River/UFC al alcance; destacar lo relevante para esta familia. Si se expone el calendario guardado, separar próximo evento de próximos encuentros. |
| [UFC: eventos](https://www.ufcespanol.com/events) | Enfrentamiento estelar protagonista, titulares condensados, contraste alto y fecha/hora asociadas al evento. La agenda diferencia próximos y pasados. | Encabezado de estelar con nombres enfrentados; horarios por bloque y fecha argentina explícita. Reservar el dramatismo para la ficha, sin extenderlo a formularios y conversación. |
| [Strava: comunidad](https://support.strava.com/en-us/collections/19668897-feed-kudos-and-comments) y [club público](https://www.strava.com/clubs/strava) | Participación vinculada a publicaciones/actividades, con autor, fecha y comentarios. | Conversación vinculada a cada evento y autor claramente identificado. Dar acceso visible a comentar y a las formaciones familiares. |
| [FotMob: Lineup Builder](https://www.fotmob.com/lineup-builder) | Herramienta específica para crear formaciones con jugadores. | Referencia futura para el once deseado. La función local actual usa texto libre; una cancha editable exige definir datos de jugadores, posiciones y guardado estructurado. |

## Dirección recomendada: día de partido en familia

Conservar el fondo cálido, la navegación y las dimensiones de controles de Family Utils. Usar títulos sans serif de peso fuerte y contraste concentrado en el evento. Probar primero Manrope y DM Sans, ya presentes, antes de agregar fuentes.

River: blanco, grafito y rojo, con una diagonal discreta como recurso gráfico. UFC: ficha grafito, nombres enfrentados y acentos rojos, seguida por horarios y lista de peleas sobre superficies claras. Usar el rojo con contexto: acento de identidad y error no deben confundirse.

El carácter deportivo debe poder sostenerse con tipografía y composición. Las fotos y escudos son opcionales y requieren una fuente adecuada; la automatización revisada no proporciona un catálogo de imágenes listo para la UI.

## Estructura para explorar

1. Encabezado familiar y selector River/UFC.
2. Ficha del evento: enfrentamiento, fecha/hora argentina y estado.
3. Información práctica: torneo, cancha/sede y dónde verlo, cuando exista el dato.
4. Participación: acceso a formaciones deseadas en River y conversación en ambos deportes.
5. Estado de datos discreto: fuente, última consulta exitosa y acción de actualización cuando corresponda.
6. Acciones administrativas secundarias.

En móvil, evitar que un encabezado de gran altura o un formulario de formación desplace demasiado la conversación. Se puede explorar una vista resumida de formaciones con apertura del editor al solicitarlo, sin ocultar la participación existente.

## Qué aprovechar con las funciones actuales

- Jerarquía visual de enfrentamientos y horarios.
- Estelar destacada y separación de bloques UFC.
- Comentarios con autor, fecha, carga, vacío y error diferenciados.
- Formaciones presentadas como opiniones de cada integrante, manteniendo su texto libre.
- Estados explícitos de datos: a confirmar, actualizando, actualizado y actualización fallida con datos conservados.

## Qué requiere ampliar el producto

- Cancha interactiva: datos estructurados de jugadores y posiciones.
- Pronósticos: elecciones guardadas por integrante, cierre, resultados y reglas de puntuación.
- Calendario navegable: exponer en pantalla los eventos adicionales almacenados.
- Reacciones: modelo de datos y controles propios.
- Marcadores en vivo: fuente y mecanismo de actualización adecuados.

## Criterios para la revisión funcional

La inspiración de apps de resultados no debe crear una expectativa de seguimiento en vivo. Mostrar hora de última actualización, evitando puntos pulsantes o etiquetas LIVE sin datos que lo respalden.

Probar: primera entrada sin datos, información previamente guardada, actualización exitosa, fallo solo de River o solo de UFC, horario desconocido, cambio de fecha, cartelera incompleta, semana sin evento confirmado y evento que comienza al día siguiente en Argentina. Verificar conservación de conversación y formaciones al reprogramar.

Comparar dos variantes: ficha clara con acentos deportivos y ficha oscura dentro de una página clara. Elegir según lectura en móvil, facilidad para encontrar el horario y acceso a participación, además de preferencia estética.
