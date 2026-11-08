# Dónde verla — Cinemateca

Disponibilidad a demanda para Argentina, con revisiones asistidas a pedido. No hay búsquedas desde el servidor, scraping, tareas periódicas ni claves de terceros. Suscripción, gratis y gratis con publicidad son las únicas modalidades.

## Datos y alcance

La migración `0063_cinemateca_availability` agrega seis tablas: plataformas por familia, alias, revisiones completadas, ofertas, propuestas inmutables y operaciones idempotentes. Crea doce plataformas pendientes para las familias existentes. Los administradores de familias nuevas pueden agregar ese catálogo desde la interfaz. Cont.ar no se activa sin comprobar su funcionamiento.

Solo administradores mantienen plataformas. Una cobertura comprobada necesita fuentes; una plataforma pendiente no admite ofertas. Los nombres anteriores se conservan como alias al renombrar. Para agregar o quitar alias, se edita el catálogo; el nombre visible anterior se conserva al renombrar y los otros alias se pueden corregir.

Cada revisión vigente identifica familia, película, plataforma y país. Sus fuentes y su fecha calendario argentina se mantienen separadas de las ofertas. Las revisiones sin resultados y las ofertas gratuitas requieren revisar a los 14 días; suscripción a los 30. No se modifican datos principales, actividad, experiencias personales ni valoraciones.

La base impone referencias compuestas, unicidad de alias/revisiones/modalidades, URL HTTP/HTTPS, fechas, coherencia de enlaces y restricciones de cobertura/modalidad/canal. Las propuestas no pueden actualizarse.

## Carga e interfaz

En la colección: **Importar revisión** permite seleccionar o pegar JSON; en la ficha: **Revisar dónde verla** ofrece un formulario individual que usa exactamente el mismo flujo de preview/commit. La vista previa presenta antes y después, fuentes, fechas, consultas fallidas y errores por película. Hace falta marcar la confirmación antes de guardar.

Esquema 1, Argentina, 1–100 películas y límite de 1 MiB. Los campos desconocidos, fechas futuras y duplicados se rechazan. Los identificadores son UUID reales de esta familia. Una revisión completada debe cubrir las modalidades incluidas en la funcionalidad para esa plataforma; ofertas vacías significa que no se encontraron opciones gratuitas ni por suscripción, no que no haya alquiler o compra.

```json
{
  "schemaVersion": 1,
  "country": "AR",
  "movies": [{
    "workId": "<UUID de la película>",
    "checks": [{
      "platformId": "<UUID de la plataforma>",
      "outcome": "completed",
      "checkedOn": "2026-11-08",
      "sourceUrls": ["https://www.justwatch.com/ar/..."],
      "offers": [{
        "mode": "subscription",
        "sourceUrls": ["https://www.justwatch.com/ar/..."],
        "linkKind": "aggregator",
        "url": "https://www.justwatch.com/ar/...",
        "directVerifiedOn": null,
        "channel": null
      }]
    }]
  }]
}
```

Una consulta fallida usa `{ "platformId": "<UUID>", "outcome": "failed", "reason": "Página incompleta", "findings": "Hallazgo sin confirmar, opcional" }`. No admite ofertas ni reemplaza una revisión previa. `findings` es texto explicativo, nunca una oferta confirmada.

Enlaces: `direct` requiere URL y fecha de comprobación no posterior a la revisión; `aggregator` requiere URL, sin fecha directa; `none` usa ambos nulos. JustWatch Argentina puede respaldar una oferta válida sin enlace directo. YouTube requiere `channel` con `name`, `url` y `authoritySourceUrl`; se aceptan películas completas de un canal oficial o titular autorizado, nunca avances o fragmentos. La veracidad de fuentes, región y reproducción se comprueba durante la investigación, no mediante solicitudes automáticas del servidor.

## API y concurrencia

- `GET /api/library/platforms`: catálogo y permiso de mantenimiento.
- `POST /api/library/platforms`: crear; `{ "action": "initialize" }` agrega plataformas iniciales faltantes.
- `PATCH /api/library/platforms`: editar con `id` y `expectedVersion`.
- `GET /api/library/:workId/availability`: revisiones y ofertas.
- `POST /api/library/availability/preview`: guarda una propuesta por 24 horas, sin modificar disponibilidad.
- `POST /api/library/availability/commit`: recibe **solo** `previewId`, `proposalHash`, `idempotencyKey` (UUID).

La propuesta contiene la carga normalizada, identidad de las películas, versiones de plataformas y revisiones y SHA-256 canónico vinculado al integrante y su familia. No se confía en versiones enviadas nuevamente al confirmar. Una estructura general inválida es 400; un problema por película se presenta como rechazo de esa película.

Cada película se aplica en una transacción separada con bloqueo de familia, validación de acceso vigente y versiones, auditoría, incremento único de `library_revision` y resultado durable de la operación. El bloqueo se libera entre películas. Dos primeras revisiones parten de versión cero; la segunda detecta conflicto. Los conflictos y rechazos no bloquean las demás películas. Los errores transitorios devuelven 503: reintentar **la misma clave y propuesta** recupera resultados ya aplicados y continúa pendientes, incluso si la propuesta venció después de comenzar la operación. Una operación nueva requiere propuesta no vencida. Una misma clave con otra propuesta devuelve 409.

El contador `library_revision` invalida caché sin alterar el orden de actividad. La representación incluye día argentino e indicador de funcionalidad en el ETag. El sondeo existente actualiza la presentación al cambiar el día, sin investigar nuevas disponibilidades.

## Filtros

Parámetros repetidos `platform=<UUID>` se combinan con O. `free=true` se combina con Y y sobre la misma oferta. La selección se normaliza, deduplica y participa de cursores, búsqueda y recuentos personales. El resumen de cobertura es independiente de los otros filtros y de la paginación, sobre colección o archivo según la vista. El selector conserva opciones seleccionadas aunque pierdan sus ofertas. Los resultados antiguos permanecen con insignia compacta.

## Publicación y reversión

1. Validar la migración en PostgreSQL aislado y en una rama de producción.
2. Aplicar migración con conexión directa, antes de publicar el código.
3. Publicar con `LIBRARY_AVAILABILITY_ENABLED=false`: sección y filtros ocultos, endpoints específicos 404.
4. Activar el indicador y revisar seis películas recientes. Confirmar su vista previa; después completar la colección.
5. Apagar el indicador conserva todos los datos; no revertir la base para desactivar la sección.

La investigación y confirmación de las ofertas iniciales es independiente de publicar la funcionalidad: el catálogo comienza pendiente y las películas sin revisar.
