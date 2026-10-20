# Champions: clasificación de equipos y jornadas 4–5

Publicada el 20/10/2026 y comprobada en [Family Utils](https://family-utils-umber.vercel.app/deportes/champions/tabla), con 36 filas y consulta exitosa a UEFA.

Se agregó `/deportes/champions/tabla`, accesible desde Champions y restringida al mismo acceso familiar que Deportes. Muestra los 36 equipos, puestos oficiales, puntos, PJ/PG/PE/PP, goles a favor/en contra y diferencia de gol. La tabla y sus referencias usan verde para los puestos 1–8 (pase directo a octavos), azul para los puestos 9–24 (16 equipos a play-offs) y gris para los puestos 25–36. Los números, los cortes y los textos de referencia permiten reconocer los grupos además del color. Conserva el orden y los empates de UEFA, sin recalcular desempates a partir de los pronósticos familiares.

La fuente es el servicio público utilizado por la [tabla oficial UEFA](https://www.uefa.com/uefachampionsleague/standings/), competición 1 y temporada 2027 (2026/27). Se consulta desde el servidor con caché de 60 segundos y límite de espera de 6 segundos. La pantalla solicita actualización cada minuto mientras está visible y tiene actualización manual. Se exige una tabla completa de 36 identidades únicas y estadísticas consistentes. Si la fuente falla, se muestra la copia verificada incluida con su fecha y un aviso explícito. Las filas en vivo de esa copia se identifican como “En juego al consultar”.

Las agendas verificadas son [Jornada 4](2026-27-jornada-4-agenda.json) y [Jornada 5](2026-27-jornada-5-agenda.json), con 18 partidos y 36 equipos por jornada. Se verificaron contra el [calendario oficial UEFA](https://www.uefa.com/uefachampionsleague/news/02a8-2174c9e9019d-f909a77bd77a-1000--2026-27-champions-league-all-the-league-phase-fixtures/). Se guardaron mediante vista previa y confirmación del importador existente en la aplicación familiar el 20/10/2026. Ambas jornadas se comprobaron en la interfaz con 18 partidos cada una y tres jornadas disponibles en total.

- Jornada 4: 3–4 de noviembre de 2026.
- Jornada 5: 24–25 de noviembre de 2026.
- Noviembre usa CET (Europe/Paris, UTC+01:00): 18:45/21:00 equivalen a 17:45/20:00 UTC y 14:45/17:00 de Argentina.
- Estadios y canales sin verificación permanecen sin confirmar.
- No se modificaron las reglas ni el cierre de los pronósticos de Jornada 3.

Validación: compilación, tipos, lint, 115 pruebas del proyecto y navegación/accesibilidad de la pantalla en vistas de celular y escritorio. La tabla admite desplazamiento horizontal dentro de su contenedor a 375 px, sin desbordar la página. Las pruebas nuevas se incorporaron a las suites existentes.
