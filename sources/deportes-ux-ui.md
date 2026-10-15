# Deportes: guía de funcionamiento y UX/UI

Este documento describe el flujo vigente para que futuros cambios visuales o de
experiencia respeten la estructura de la aplicación y la conservación de los
datos familiares. Deportes se renueva con datos revisados y curados en el chat;
no consulta Google ni proveedores externos desde la app.

## Pantalla publicada el 15 de octubre de 2026

La agenda navegable, los resultados curados y los pronósticos UFC están activos
en producción. `AgendaApp.tsx` y `agenda.module.css` presentan la página clara
con ficha oscura, acentos rojos, selector compacto de eventos próximos y
anteriores y enlaces estables por identificador. `UfcPredictions.tsx` presenta
elecciones por pelea, cierre por bloque y tabla por cartelera.

«Administrar» queda cerrado por defecto y solo se muestra a administradores.
`CuratedImporter.tsx` separa agenda y resultados, con ejemplo, copia, plantilla,
archivo o texto pegado, vista previa y confirmación. La autorización se valida
también en el servidor. Los borradores de conversación y formación se conservan
por evento durante la navegación. Se usan las fuentes y el marco de Family Utils.

Los contratos completos, reglas de integridad, verificación, despliegues y
reversión están en [Agenda, resultados y pronósticos](deportes-entregas.md).

## Pantalla anterior: referencia para banderas apagadas

- `src/app/deportes/page.tsx` autentica y obtiene los datos iniciales en el
  servidor.
- `src/lib/sports/server.ts` limita la lectura a la familia activa y prepara el
  próximo partido de River, la cartelera de la semana argentina, comentarios,
  formaciones e integrantes.
- `src/app/deportes/SportsApp.tsx` presenta las pestañas River y UFC, sus
  conversaciones y el importador visible solo para administradores.
- `src/app/deportes/Comments.tsx` y `src/app/deportes/sports.module.css`
  contienen los patrones compartidos de conversación y presentación.
- `src/app/api/sports/import/route.ts` y
  `src/lib/sports/import-server.ts` implementan la vista previa y la
  importación protegidas.
- `src/lib/sports/import-rules.ts` valida el formato y los límites de los datos;
  `src/lib/sports/rules.ts` define fechas, horarios y selección de eventos.
- `drizzle/` conserva el esquema y las migraciones. Los cambios de datos se
  validan y se escriben en transacciones breves por categoría.

La pantalla sigue el patrón de página del servidor con una isla cliente para
interacciones. Mantener las pestañas y componentes existentes; los estilos se
resuelven con CSS Modules, variables y clases de `sports.module.css`, no con un
sistema visual paralelo.

## Flujo del importador

1. Un administrador abre «Importar datos curados desde el chat» y pega un JSON
   o selecciona el archivo entregado en el chat.
2. «Validar JSON» manda una vista previa de solo lectura. Muestra cantidades,
   horizonte cubierto y advertencias antes de habilitar la confirmación.
3. «Confirmar importación» escribe River y UFC en transacciones separadas. Si
   una categoría falla, sus datos anteriores permanecen y se informa el error.
4. Tras el éxito se refrescan los datos de la página. La selección de pestaña y
   los formularios abiertos o textos no enviados deben conservarse en futuros
   rediseños cuando el flujo requiera refrescar datos.

La validación exige `schemaVersion: 1`, fecha de revisión reciente, zona horaria
`America/Argentina/Buenos_Aires`, referencias únicas, fuentes HTTPS permitidas,
horizontes completos y fichas UFC validadas contra la cantidad oficial. El
servidor vuelve a validar incluso después de la vista previa: el navegador no
es una frontera de confianza.

La identidad de cada evento se conserva al actualizar. La referencia externa
estable tiene prioridad; para un cambio de ID se admite solo una equivalencia
única dentro de siete días. Un caso ambiguo se rechaza. Se conservan
comentarios, formaciones, peleas con correcciones y eventos ocultos. Un evento
ausente de una respuesta completa se marca como ausente, no se borra; una
respuesta vacía nunca equivale a «Sin evento esta semana».

## Pautas para cambios de UX/UI

- Mantener las dos pestañas de contenido «River» y «UFC» y el contexto visual
  existente de `page`, `intro`, `tabs`, `sectionHeading`, `eventCard`,
  `cardPanel`, `comments`, `actions` y `empty`.
- El importador es una herramienta administrativa dentro de la página, no una
  pantalla aparte. La carga acepta JSON pegado o un archivo; no agregar
  formularios de alta o edición manual de partidos, carteleras o peleas.
- Conservar la vista previa antes de escribir, los estados de validación,
  importación, éxito y error, y el texto cargado si falla la operación.
- Usar mensajes breves y visibles con `role="status"` o `role="alert"`;
  controles con etiqueta, botones nativos y foco accesible. No comunicar el
  resultado solo con color.
- Mostrar procedencia y fecha de revisión junto al evento. Si hubo correcciones
  manuales anteriores o peleas protegidas, hacer visible que se conservaron.
- Después de `router.refresh()`, mantener la pestaña elegida y no descartar
  entradas de comentarios o formaciones sin enviar.
- River muestra el siguiente partido. UFC usa la fecha oficial publicada para
  ordenar la semana argentina; cada horario se expresa en Argentina y puede
  caer al día siguiente de la fecha oficial.
- Ocultar un evento no elimina su historial ni su conversación. La acción debe
  seguir explicando que comentarios y formaciones se conservan.
- El administrador puede marcar «Sin evento esta semana». Esa marca prevalece
  sobre una cartelera visible de esa semana; importar una cartelera de esa
  semana la limpia. Mantener la acción como control de estado, no como un
  formulario de alta de eventos.
- Mantener el alcance familiar y la carga manual curada; cualquier futura
  consulta automática requiere una decisión separada sobre fuentes permitidas.

## Contrato del JSON

El ejemplo vigente está en `sources/deportes-carga-2026-10-15.json`. Los eventos
incluyen `kind`, `sourceProvider`, `externalReference`, `source` y su contenido
normalizado en el nivel superior. `curation.completeHorizon` declara el rango
cubierto para `river` y `ufc`. La UFC incluye horario y fecha argentina por
bloque, peleas ordenadas y una sola estelar. Los horarios se muestran en
Argentina; `eventDate` de UFC permanece como fecha oficial.

Al actualizar datos, generar un archivo nuevo y dejar asentadas las fuentes,
fechas de revisión y advertencias. No reemplazar el archivo histórico de una
carga ya publicada; revisar y validar el nuevo JSON con el mismo parser de la
app antes de confirmar la importación.

## Verificación

`npm test` valida reglas y formato. `npm run test:routes` ejerce permisos,
aislamiento familiar e importación contra una base PostgreSQL aislada. `npm run
test:e2e` cubre la vista, la carga/confirmación y la conservación de identidad,
comentarios, formaciones y eventos ocultos. No apuntar pruebas ni limpieza a la
base productiva.

## Banderas de servidor

La agenda navegable, el diseño deportivo, los pronósticos UFC y los resultados
curados usan tres banderas de servidor apagadas por defecto en el código y
activadas explícitamente en producción el 15 de octubre de 2026. El contrato, las dependencias, la integridad y el procedimiento de
verificación están en [Entregas A, B y C](deportes-entregas.md). La descripción
anterior corresponde al flujo que continúa vigente con las banderas apagadas.
