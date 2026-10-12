# Navegación diaria de tareas

La vista de tareas usa fechas civiles de Buenos Aires. Sin `fecha` en la URL sigue Hoy; elegir una fecha, incluido hoy, la fija. El botón Hoy elimina el parámetro. Se permite consultar diez años de pasado y seis meses de futuro.

El pasado consulta snapshots de ocasiones existentes, sin reconstruir el estado que tenía la lista. Una tarea completada después de su vencimiento aparece en ambos días, una sola vez en cada día. Todos los integrantes activos consultan la actividad de su familia, incluidas responsabilidades individuales y tareas archivadas.

## Lectura y actualización

`GET /api/tasks?date=AAAA-MM-DD` siempre es puro. Retorna ocasiones reales y previsiones calculadas para esa fecha. Los registros persistidos prevalecen sobre las previsiones por su clave `[taskId, responsibilityMemberId|null, generationDate|null]`. Las causas se consultan en auditoría con `entity_type = 'occurrence'`: `skip`, `superseded_by_task_edit`, `archived_by_task_archive` y `archived_by_task_finalization`. No se infieren causas cuando falta auditoría antigua.

La generación y las previsiones comparten `expectedOccurrenceDay`. La primera ocasión posterior a completar una rutina conservada se busca en su calendario semanal desde el día posterior a la finalización familiar. Las omisiones explícitas avanzan ese punto; una ocasión abierta impide crear otra por responsabilidad.

`POST /api/tasks/sync` no acepta fecha ni cuerpo. Actualiza el día real, con comprobación previa de trabajo y revalidación transaccional. Sin trabajo no escribe, no incrementa revisión ni adquiere bloqueos de fila. Las escrituras de usuario reutilizan el mismo servicio para la tarea afectada y una sola revisión transaccional.

El cliente limita sync a uno cada 30 segundos y una petición simultánea. Lee inmediatamente; muestra las ocasiones de Hoy aún no persistidas como «Pendiente de actualizar». El aviso aparece tras 800 ms, o inmediatamente ante fallo. Timeout de espera de cinco segundos, reintento automático a los 30 segundos y un único reintento manual inmediato por fallo. Cambios de revisión solo disparan lecturas.

Las dos secciones se paginan de a 50, con cursor ligado a fecha, revisión y sección. Un cursor obsoleto obliga a reiniciar la carga; el cliente conserva la cantidad cargada y el ancla visual. Las ETags incluyen fecha, día real, página y modo operativo.

## Recuperación y reversión

`TASK_GENERATION_MODE=explicit_sync` es el valor predeterminado. Para recuperación, configurar `legacy_today` y aplicar el cambio al despliegue. El cliente detecta el modo en lista/revisión y utiliza el GET sin fecha para actualizar Hoy. Las consultas con `date` continúan siendo puras. El modo de recuperación comparte el materializador y respeta las excepciones futuras, sin generación ordinaria anticipada.

Las migraciones de índices son aditivas. Las excepciones futuras se conservan al revertir código. Revertir primero planificación futura, luego sincronización; verificar compatibilidad con generación y responsabilidad antes de volver a un binario antiguo que genere anticipadamente.

## Revisión de pendientes potenciales

La sección plegada «Podrían seguir pendientes» permanece visible hasta seis meses. Durante los primeros 14 días desde la primera visita futura se registran únicamente contadores locales de visitas y aperturas, por familia y dispositivo, en `task-future-use:<familyId>`; no se guardan textos de tareas ni se envían estos datos. Si hubo visitas y ninguna apertura, revisar con el usuario reducir el horizonte a 30 días. No cambiarlo automáticamente.

## Planificación futura

Crear una tarea desde el futuro precarga su fecha. Una rutina futura no persiste ocasiones ordinarias hasta el día real. Para editar una previsión diaria, el PATCH de tarea recibe `scope: "occurrence"`, `expectedTaskVersion` y `forecast: { generationDate, responsibilityMemberId }`, además de los campos editados. Valida la programación bajo bloqueo de tarea, comprueba colisiones y materializa y edita la excepción en la misma transacción. Una previsión ya materializada o una versión obsoleta devuelve 409; no se sobrescribe.

Las estimaciones de rutinas que conservan pendientes solo permiten editar la programación. La edición de serie mantiene su alcance desde Hoy y lo explica con ambas fechas en el formulario. No permite completar ni asumir una ocasión futura por API. Las excepciones se identifican por su generación original aunque cambie su vencimiento o responsabilidad.
