# Prueba de extracción pública — 15 de octubre de 2026

Resultado: hay cobertura suficiente en esta muestra para desarrollar una integración con ESPN y completar UFC con su fuente oficial. La extracción directa de Google no produjo datos deportivos utilizables. Esta prueba no habilita sincronización ni modifica datos de la app.

## Cómo repetirla

`node scripts/probe-sports-public.mjs /tmp/deportes-prueba-publica.json`

No requiere claves ni dependencias nuevas. Hace consultas públicas de solo lectura, con timeout de 15 segundos por solicitud. Usa la fecha de ejecución y una ventana de 90 días para UFC. El archivo de salida es opcional. La muestra ejecutada está en [deportes-prueba-publica.json](deportes-prueba-publica.json).

## Google

Se consultaron «River Plate proximos partidos» y «UFC proximo evento cartelera», en español y con país Argentina. Ambas solicitudes respondieron HTTP 200 pero incluyeron una página que requiere JavaScript; no se extrajo una cartelera ni un fixture estructurado. Esto describe esta prueba HTTP, no demuestra que sea imposible extraerlos con un navegador.

No se probaron SearchApi ni SerpApi: no hay credenciales configuradas. Su cobertura específica de River y UFC continúa sin verificar.

## River

El endpoint de [ESPN para River](https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/16/schedule?fixture=true) devolvió cuatro próximos partidos, con identificadores, local/visitante, torneo, fecha, cancha y señal de horario válido.

Los primeros tres coinciden en rivales, localía, fechas y horas argentinas con la [programación oficial de la Liga Profesional](https://www.ligaprofesional.ar/notas/primera/2026/10/07/agenda-de-la-13-a-la-15/):

| Partido | Fecha y hora argentina |
|---|---|
| Belgrano – River | 18/10/2026, 20:15 |
| River – Racing | 25/10/2026, 19:15 |
| Boca – River | 01/11/2026, 15:00 |

El cuarto, Aldosivi – River, tiene `timeValid=false`. El script conserva el dato original como evidencia pero devuelve `startsAt=null`: no presenta una hora tentativa como confirmada.

Discrepancia real: ESPN informa «El Gigante de Alberdi» para Belgrano – River. El [comunicado oficial de Belgrano](https://belgrano.com.ar/2026/09/28/belgranoriver/) indica Estadio Mario Alberto Kempes. La muestra alcanza para fechas y rivales, pero la cancha no puede aceptarse automáticamente sin permitir una corrección manual o una fuente oficial prioritaria. El campo `officialComparison=pending` del JSON corresponde al script, que no automatiza el cotejo con la publicación de la Liga; ese cotejo se hizo por separado y se documenta aquí.

## UFC

Se descubrieron enlaces desde el [calendario oficial](https://www.ufc.com/events), se descargaron las dos próximas fichas y se comparó cada pareja de peleadores con ESPN. La comparación normaliza acentos, puntuación y orden de participantes, únicamente para esta prueba.

| Evento | Peleas oficiales / ESPN | Bloques y horas argentinas |
|---|---|---|
| [Buckley – Malott, 17/10](https://www.ufc.com/event/ufc-fight-night-october-17-2026) | 13 / 13, sin faltantes ni extras | Preliminares 18:00; principal 21:00 |
| [UFC 333, 24/10](https://www.ufc.com/event/ufc-333) | 11 / 11, sin faltantes ni extras | Preliminares tempranas 11:00; preliminares 13:00; principal 15:00 |

Los horarios provienen de `data-timestamp` de UFC oficial y coinciden con los instantes de ESPN. No debe usarse ciegamente el atributo HTML `datetime`: en la página observada de Buckley – Malott dice `21:00Z` para el bloque principal, mientras el timestamp y el texto visible corresponden a `00:00Z` del domingo, 21:00 del sábado en Argentina.

ESPN no etiqueta explícitamente cada pelea como principal/preliminar ni identifica la estelar en esta respuesta. El sitio oficial sí agrupa las peleas por bloque. Tampoco debe deducirse la fecha oficial del evento a partir del día UTC: en esta muestra la principal de Buckley – Malott comienza el domingo UTC pero el evento es del sábado.

## Decisión técnica

- River: ESPN sirve como candidato para fixture; conservar hora desconocida y correcciones de cancha.
- UFC: el HTML oficial permite extraer bloques, peleas y horarios; ESPN aporta identificadores y una segunda comparación.
- Google: no elegirlo como dependencia principal con la evidencia actual.
- Antes de integrar: contemplar tres bloques UFC (el modelo actual tiene dos), fechas oficiales independientes de los instantes UTC, fallos de extracción, datos anteriores y ediciones manuales. La normalización por nombres y las expresiones del HTML son un prototipo, no un contrato estable.
- La prueba demuestra cobertura puntual. No demuestra estabilidad futura ni concede aprobación de uso productivo; los endpoints consultados de ESPN no se trataron como una API con contrato público garantizado.

Verificación realizada: ejecución real completa del script, validación de sintaxis, lectura de la muestra generada y comparación con fuentes oficiales. No se realizaron cambios en la pantalla ni en la base de datos.
