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

## Validación de la implementación

Validado el 12/10/2026 contra PostgreSQL 18 aislado: lint, tipos, build, 36 pruebas unitarias/invariantes/planes de consulta, 35 pruebas de rutas, 34 casos móviles (iPhone y Android) y tres auditorías de accesibilidad. Incluye 175 tarjetas con continuidad visual, recuperación de cursores en ambas secciones, respuestas fuera de orden, medianoche, otra zona del dispositivo y sincronización rápida, lenta, fallida y con timeout.

La prueba de rendimiento carga 29.208 ocasiones y eventos distribuidos en diez años. Confirma los índices de vencimiento, finalización y causa mediante EXPLAIN ANALYZE; informa tamaño de los índices y duración de inserción de auditoría. En la ejecución local, las consultas diarias midieron 0,044 y 0,024 ms; insertar los 29.208 eventos con índices tomó 288 ms. Un sync sin trabajo respondió en 10 ms, manteniendo filas, auditoría y revisión y sin esperar bloqueos explícitos de fila. Estas mediciones corresponden al servicio aislado de pruebas.

## Pendientes persistentes y compatibilidad

Crear con `carryPolicy: "carry_forward"` admite tareas sin repetición. El alta
sin política mantiene `expires_daily` para clientes anteriores; en PATCH de
programación, omitir la política conserva la existente. Una tarea simple no
vence automáticamente, incluso con el valor antiguo de política.

La lista expone `effectiveDate`: `dueDate` cuando existe, o el día de Buenos Aires
de `createdAt` de la ocasión. Las fechas nulas permanecen nulas en almacenamiento.
Las ocasiones conservadas mantienen origen; una responsabilidad nueva tiene su
propio inicio. Reprogramar cambia `dueDate`, conservando identidad y generación.
Abiertos primero por fecha efectiva, horario y clave estable; completadas después
por finalización. Conteos y páginas derivan de la misma lista ordenada.

Una tarea compartida tiene un pendiente ordinario común; una individual tiene
uno por persona. Cualquier integrante activo puede completar según los permisos
existentes. Descartar una ocasión individual afecta únicamente a esa persona.

Convertir una simple en rutina conserva sus pendientes y bloquea nueva generación
para esas responsabilidades. Quitar repetición conserva los pendientes actuales y
las excepciones futuras editadas explícitamente, con sus snapshots; retira solo
ocasiones futuras ordinarias abiertas con auditoría. Las excepciones explícitas
pueden coexistir como compromisos programados independientes. Finalizar también
conserva esas excepciones; sus ocasiones abiertas pueden descartarse.

Deshacer se permite solo el día familiar de finalización y según los permisos
existentes. Una previsión calculada no bloquea; una ocasión posterior persistida
para la misma responsabilidad sí, aunque no haya sido modificada. No se elimina
automáticamente la próxima ocasión para permitir deshacer.

`tests/tasks-daily-routes.integration.mjs` comprueba sobre fixtures ficticios la
línea base y las invariantes de política/booleano y unicidad de abiertos conservados.
Una inconsistencia previa no se corrige silenciosamente: la edición devuelve
conflicto y revierte su transacción. No se usan datos reales como fixtures.

El orden de lista y los cursores llevan versión 2: un cursor anterior devuelve
409 y la ETag cambia aunque la revisión familiar sea igual, evitando mezclar
páginas de órdenes distintos durante un despliegue. Omitir una rutina conservada
avanza desde el día familiar de la omisión, también si la ocasión original no
tenía fecha; no recrea un pendiente automáticamente ese mismo día.

## Alta e interacción

El alta inicial pide solo nombre y muestra que la tarea sigue pendiente hasta
hacerla. «Más opciones» conserva nota, fecha, horario, responsables y repetición
al plegarse. Crear desde el futuro muestra esa fecha también fuera del desplegable.
Las opciones son «No se repite», «Todos los días» y «Elegir días»; la nueva interfaz
envía siempre la política conservada. Las rutinas antiguas muestran su política al
editar programación y solo cambian de comportamiento por elección explícita.

Un error de validación en opciones abre el desplegable y enfoca el campo. Los
diálogos mantienen foco, admiten Escape y devuelven foco al control de apertura.
Un pendiente anterior indica «Pendiente desde…» y conserva el horario original;
una reprogramación indica «Programada para…». No se muestra el horario arrastrado
como si fuera una nueva cita de hoy. La fecha de creación, si se muestra, debe
identificarse separadamente de la fecha programada.

Descartar una tarea individual identifica de quién es ese pendiente. Compartidas
simples usan «Descartar tarea» y rutinas compartidas «Omitir esta ocasión».
Administradores mantienen archivo y «Dejar de repetir». Las excepciones conservadas
se editan como ocasiones independientes incluso después de quitar repetición.

La evidencia y el entorno local de esta entrega están registrados en
[verificación de tareas persistentes](task-persistence-verification.md). No acredita
publicación ni integración remota.
