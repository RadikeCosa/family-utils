# River: formación oficial y resultado

## Operación

En Deportes → River, abrir el partido y luego **Administrar → Publicar formación oficial**. Descargar la plantilla de ese encuentro. Pasarla al chat junto con la formación confirmada y un enlace HTTPS verificable. No completar suplentes ni esquema desconocidos. El texto admite hasta 4.000 caracteres y se muestra como texto plano.

Pegar o seleccionar el archivo completo, elegir **Validar formación oficial**, revisar partido, texto, fuente, fecha y versión anterior, y confirmar. Solo administración publica; la familia consulta y comenta. “El once que queremos” sigue siendo una propuesta personal independiente.

Para el resultado, descargar la plantilla del importador existente y completar únicamente el evento correspondiente. `homeGoals` corresponde al equipo local; `awayGoals`, al visitante, aunque River juegue fuera de casa. La vista previa identifica ambos equipos. Confirmar solo el resultado final verificado; una corrección muestra el marcador anterior y nuevo. El partido permanece disponible en **Anteriores**, con su formación y conversación.

Al volver a la app o pulsar **Actualizar**, se recargan los datos sin borrar borradores ni cambiar el partido seleccionado. No hay consultas automáticas a proveedores, imágenes ni notificaciones.

## Contrato

`GET /api/sports/river/lineup/templates?event=<uuid>` devuelve una plantilla privada del partido existente, con nombres de referencia. `POST /api/sports/river/lineup/import` recibe `{mode:"preview",bundle}` o `{mode:"import",bundle,token}`. El archivo contiene `version:1`, `eventId`, `body`, `source` y `checkedAt` (fecha ISO). Campos informativos de la plantilla no modifican la agenda. La fuente debe ser HTTPS y no contener credenciales. Los ejemplos ficticios marcados `example:true` se rechazan.

La vista previa no escribe. Su token firmado dura 15 minutos, está ligado al administrador, familia, contenido y estado del partido/formación. La confirmación vuelve a comprobar permisos y estado con bloqueo del partido. Una carga repetida idéntica no duplica la auditoría. La tabla conserva autor, creación y última publicación; las correcciones quedan en `audit_events`.

## Publicación y recuperación

Rama corta `codex/river-matchday`, PR y CI antes de integrar. La migración aditiva `0050_sports_river_lineups` se aplica antes de publicar el código, con conexión directa y respaldo probado en PostgreSQL 18 aislado. Se conservan los hashes de todas las migraciones anteriores. No cargar datos ficticios en producción ni guardar archivos familiares de importación en Git.

Ante una incidencia, publicar el código anterior o retirar la sección mediante PR, conservando tablas y datos. Apagar la agenda bloquea las nuevas rutas y su lectura; también afecta al resto de la agenda deportiva y requiere nuevo despliegue.

## Punto de partida verificado

El 18/10/2026, antes de implementar: producción READY sobre `adfe79b`, 40 migraciones con hashes coincidentes y Belgrano–River presente para esa fecha. Agenda y resultados activos; sincronización automática apagada. CI de ese commit fallaba por una prueba de Champions que buscaba el interruptor retirado: se actualiza la prueba para verificar disponibilidad permanente y conservación de la jornada.

Las estadísticas y curiosidades se incorporarán en una segunda PR independiente.
