# River: posición y estadísticas del Clausura 2026

## Pantalla y alcance

Acceso desde Deportes → River → **River en el Clausura**, en `/deportes/river/campeonato`. Requiere un integrante autenticado y la agenda deportiva habilitada. Muestra posición y balance de River en la zona B, goleadores, asistidores, jugadores con amarillas y el listado publicado de rojas. Los empates comparten puesto (1.º, 1.º, 3.º). No se deducen suspensiones a partir de las tarjetas.

Los datos son una copia curada con fecha de revisión visible, separada de las estadísticas de cada partido. La app no consulta proveedores al abrir esta pantalla. No hay migraciones, escrituras familiares ni nuevas APIs. La nueva ruta conserva el control de acceso del resto de Deportes.

## Fuentes consultadas el 20/10/2026

- [LPF: Clausura 2026](https://www.ligaprofesional.ar/torneo-clausura-mercado-libre-2026/), tabla de posiciones **Grupo B**, contrastada con el [calendario de posiciones de ESPN](https://site.api.espn.com/apis/v2/sports/soccer/arg.1/standings?season=2026): River 6.º, 20 puntos, 13 jugados, seis ganados, dos empatados, cinco perdidos, 18 goles a favor y 13 en contra. No se utilizó la tabla anual ni los promedios.
- [Estadísticas oficiales de River](https://www.riverplate.com/futbol/futbol-profesional/masculino/estadisticas): su widget identifica explícitamente “Liga Profesional Argentina (2ª Etapa)”. Permite cotejar goleadores y un ranking de amarillas limitado a diez jugadores.
- Las fichas públicas usadas por la propia web oficial están en `https://www.riverplate.com/api/v1/sports/male-professional-football/squad/<id>/statistics`. Se consultaron las 27 fichas del plantel publicado. Se seleccionó exclusivamente el calendario `8v84l9nq3d5t0j4gb781i3llg`, año 2026; sus balances de 13 partidos de Santiago Beltrán y Lucas Martínez Quarta coinciden con el Clausura. Se excluyeron los calendarios de Sudamericana, Copa Argentina y amistosos. Las URLs concretas consultadas quedan en cada registro del archivo curado.
- [ESPN: goles y asistencias de River](https://www.espn.com.ar/futbol/equipo/estadisticas/_/id/16/liga/ARG.1/temporada/2026) y [tarjetas](https://www.espn.com.ar/futbol/equipo/estadisticas/_/id/16/liga/ARG.1/temporada/2026/vista/tarjetas). Ambas páginas identifican en sus datos la temporada 2026 y el tipo `13900`, “Torneo Clausura”.

### Discrepancias y valores desconocidos

Se priorizan las cifras oficiales positivas de River. Su ficha de Tobías Andrada confirma una asistencia y dos amarillas que ESPN no presenta en los mismos listados. Las fichas también permiten incorporar las amarillas de Tobías Ramírez, Agustín Ruberto y Lucas Silva. Joaquín Freitas permanece en el ranking de amarillas publicado por River aunque no figure en el plantel actual de su API; se conserva ese registro con atribución a la página oficial. Las variantes de nombres “Lautaruo Rivero” y “Ezequiel Centuríon” de ESPN se presentan con la grafía oficial de River y conservan su identificador ESPN.

Se incluyen siete goleadores, siete asistidores y 16 jugadores con amarillas. Los valores ausentes o `null` en las fichas oficiales **no se convierten en cero**. ESPN no informa rojas en su tabla consultada; la pantalla dice “No hay rojas informadas en la fuente consultada”, sin presentar ceros inventados para el plantel ni inferir ausencia de sanciones.

## Actualización y verificación

La copia curada está en `src/lib/sports/river-championship-snapshot.json`. Cada fila positiva contiene identidad, nombre, cantidad y fuente. Para actualizar: revisar de nuevo la misma competencia y temporada, volver a consultar todos los jugadores y el ranking de jugadores que ya no estén en el plantel, resolver discrepancias, renovar `checkedAt` y ejecutar `npm run test:river-championship`, typecheck y lint de los archivos afectados. Un cambio de torneo requiere actualizar explícitamente el contrato; no mezclar cifras anuales o de otra competición.

Verificación completada:

- Cinco pruebas de alcance, coherencia del balance, identidades, atribución, valores desconocidos y puestos compartidos.
- Typecheck y lint de los archivos afectados aprobados.
- Ensayo sobre una copia privada restaurada de la base, en un contenedor exclusivo accesible solo por localhost. Sin cambios en producción.
- La ruta redirige a `/acceso` sin sesión; administrador e integrante pueden consultarla. El enlace aparece en la pestaña River. Las lecturas no modifican eventos deportivos.
- Revisión visual en móvil y escritorio, navegación por los enlaces de estadísticas, ausencia de desbordamiento horizontal y fuente/fecha visibles.

Fuentes descargadas, respuestas de las fichas, evidencias de la tabla oficial y resultados del ensayo están fuera de Git en `.release-private/river-clausura-2026/`. La verificación inicial fue local. La publicación conjunta de River y Champions del 20/10/2026 se realiza desde la rama de publicación, con CI aprobado antes de integrar en main y comprobar las pantallas en producción. No se requieren migraciones ni una nueva importación de las agendas que ya se cargaron.
