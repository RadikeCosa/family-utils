# Actualización puntual de Deportes — 20/10/2026

## Resultado publicado

Importación confirmada desde **Administrar → Agenda** en la app de producción. River y UFC muestran **Próximos (3)** y **Anteriores (1)**. Se conservaron los identificadores de los cuatro eventos futuros existentes y de todas las peleas anteriores. No se modificó código de aplicación, contratos, migraciones, configuración ni despliegues.

Archivo aplicado: [deportes-carga-2026-10-20.json](deportes-carga-2026-10-20.json). El archivo del 15/10 permanece intacto. Los datos se revisaron el 20/10; el archivo conserva el instante de revisión en `checkedAt` y la procedencia de cada evento.

| Evento | Fecha argentina | Horarios argentinos | Peleas | Operación |
| --- | --- | --- | --- | --- |
| River–Racing | 25/10/2026 | 19:15 | — | Actualización |
| Boca–River | 01/11/2026 | 15:00 | — | Actualización |
| Aldosivi–River | 08/11/2026, provisional | A confirmar | — | Alta |
| UFC 333: Volkanovski–Evloev | 24/10/2026 | Tempranas 11:00; preliminares 13:00; principal 15:00 | 14 | Actualización |
| Moicano–Nolan | 31/10/2026 | Preliminares 18:00; principal 21:00 | 11 | Actualización |
| Bonfim–Brady | 07/11/2026 | Preliminares 19:00; principal 22:00 | 13 | Alta |

Son dos eventos nuevos y 16 peleas nuevas: 13 de Bonfim–Brady y tres incorporaciones a las preliminares tempranas de UFC 333 (Oki–Santos, Steele–Gugnon y Lucindo–Caliari). Moicano–Nolan conserva las mismas 11 parejas, con el orden vigente de la ficha oficial.

## Fuentes y diferencias resueltas

### River

- [Programación oficial LPF, fechas 13–15](https://www.ligaprofesional.ar/notas/primera/2026/10/07/agenda-de-la-13-a-la-15/): confirma River–Racing el 25/10 a las 19:15 por TNT Sports y Boca–River el 01/11 a las 15:00 por TNT Sports / ESPN Premium.
- [Fixture oficial 2026](https://www.ligaprofesional.ar/?p=75980): confirma Aldosivi–River en la fecha 16 del Clausura.
- [Calendario ESPN del equipo 16](https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/16/schedule?fixture=true): devuelve exactamente estos tres próximos partidos. Referencias: `401841634`, `401841658` y `401841659`.

**Pendiente real:** ESPN ubica Aldosivi–River el 08/11, pero devuelve `timeValid=false` en el evento y en la competencia. No se encontró programación específica oficial de la fecha 16 que permita confirmar hora, canal y estadio. Se conserva la fecha provisional con una nota de procedencia y los tres campos desconocidos en `null`; la app muestra “Hora a confirmar” y “Lugar a confirmar”. No se usó la hora tentativa de las 17:00.

### UFC

El [calendario oficial](https://www.ufc.com/events) enlaza, en este orden, [UFC 333](https://www.ufc.com/event/ufc-333), [Moicano–Nolan](https://www.ufc.com/event/ufc-fight-night-october-31-2026) y [Bonfim–Brady](https://www.ufc.com/event/ufc-fight-night-november-07-2026). Las tres fichas se descargaron completas y devolvieron HTTP 200. El acceso directo desde la herramienta de búsqueda había devuelto 403; la consulta de red autorizada permitió verificar las fuentes.

Las 38 parejas publicadas se cotejaron con el [calendario ESPN MMA](https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=20261020-20261109&limit=100). Referencias ESPN: `600061267`, `600061420` y `600061268`. No quedaron parejas faltantes o sobrantes después de revisar estas variantes de nombres:

- **Joseph Kropschot / Joe Kropschot:** mismo apellido, rival Nick Klein y categoría; se conserva el nombre de la [ficha oficial](https://www.ufcespanol.com/athlete/joseph-kropschot) y la identidad ya guardada. La equivalencia se documenta como revisión manual en el JSON.
- **José Souza / Jose Henrique:** UFC enlaza desde el nombre José Souza al [perfil `jose-henrique`](https://www.ufcespanol.com/athlete/jose-henrique), que muestra ese nombre y récord 9-1, coincidente con ESPN. Se conserva el nombre publicado por UFC.

Se extrajeron horarios de `data-timestamp` de cada bloque y se comprobaron contra los instantes de ESPN. La conversión usa `America/Argentina/Buenos_Aires`, sin aplicar un desfase fijo respecto de Estados Unidos: el 31/10 corresponde a 18:00/21:00 y el 07/11 a 19:00/22:00. El UTC del bloque principal cae al día siguiente en ambas Fight Nights, pero su fecha argentina permanece el sábado. La fecha oficial del evento se guarda por separado.

## Respaldo, ensayo y comprobaciones

Respaldo completo privado de producción creado antes de la carga, con instantánea consistente de 59 tablas y 42 migraciones. Se restauró exitosamente en PostgreSQL 18 local, en una base nueva llamada `sports_refresh_20261020`, para ensayar mediante la app conectada exclusivamente a esa copia. El servidor de ensayo se limitó a `127.0.0.1`.

Resultados del ensayo:

- Validador local: formato válido, tres partidos, tres carteleras y 38 peleas.
- Vista previa de la API: mismo resumen, cero advertencias y ningún cambio en los datos.
- Primera importación: River `updated, updated, inserted`; UFC `updated, updated, inserted`.
- Segunda importación: mismos identificadores y cantidades, sin duplicar eventos ni peleas.
- Conservación comprobada en las 53 tablas ajenas a las escrituras esperadas. Las nuevas referencias de origen se comprobaron por separado: una referencia añadida para Aldosivi y todas las anteriores conservadas.
- Los eventos históricos y los de Champions permanecieron idénticos; ninguna pelea existente fue retirada o cambió sus identificadores de participantes.
- Un integrante pudo leer la agenda por API y recibió 403 al intentar validar una importación.
- Navegación móvil a 390 × 844 comprobada en la producción con administración y en la copia local con un integrante ficticio. Ambos deportes mostraron tres próximos; el integrante no vio controles de administración. La página de producción no presentó desbordamiento horizontal del documento.

Producción:

- Vista previa: **3 partidos · 3 carteleras · 38 peleas**, sin advertencias.
- Confirmación visible: **Importación completada**.
- Lectura posterior: tres próximos por deporte, Bonfim–Brady con 13 peleas y cierre el 07/11 a las 19:00; Aldosivi sin horario inventado.
- Comparación de instantáneas inmediatamente antes y después: 22 tablas deportivas protegidas idénticas, incluidos comentarios, formaciones, pronósticos, resultados, cierres, cuotas, alineaciones e información de River.
- Los dos eventos deportivos anteriores y los 18 eventos Champions permanecieron idénticos. Todos los identificadores anteriores de eventos y peleas se conservaron.

No se cargaron resultados nuevos, formaciones, estadísticas, pronósticos ni datos ficticios en producción. No se activó automatización.

## Evidencia y recuperación

Los respaldos, fuentes descargadas, resultados de ensayo, instantáneas y capturas quedan fuera de Git en `.release-private/sports-refresh-2026-10-20/`. Archivos principales: `before.dump`, `before.json`, `pre-import.json`, `post-import.json`, `rehearsal.json` y `production-verification.json`. Los archivos con datos familiares se guardaron con permisos privados.

Ante un dato deportivo incorrecto, corregir el JSON desde su fuente y repetir vista previa/importación conservando referencias. No reimportar el archivo del 15/10 como reversión: su horizonte y sus carteleras ya no representan la agenda actual. Para un incidente de integridad, restaurar el respaldo primero en otra base y recuperar selectivamente los registros afectados con sus vínculos; evitar una restauración completa sobre producción que sobrescriba actividad familiar posterior.

La copia y el servidor locales de ensayo se retiraron al finalizar. Se conserva el respaldo privado para recuperación.
