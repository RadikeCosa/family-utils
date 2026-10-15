# Deportes: River y UFC manuales

La pantalla tiene dos pestañas, River y UFC. Funciona con carga manual y no hace llamadas externas. Requiere migraciones hasta `0017_sports_river_weekly` y `SPORTS_ENABLED=true`; la bandera sigue apagada por defecto.

## River

Se muestra el primer partido no cancelado ni oculto con fecha argentina mayor o igual a hoy. El partido de hoy permanece hasta cambiar el día argentino. Los pendientes sin fecha van después de los fechados; los finalizados sin fecha se excluyen. La ficha incluye rival, cancha, torneo, fecha, hora y resultado opcional.

Cada integrante puede comentar y guardar una formación libre de hasta 500 caracteres, única por integrante y partido. `PUT /api/sports/events/:id/formation` reemplaza la propia; `DELETE` elimina únicamente la propia. Los comentarios de River se consultan por evento sin requerir fecha; las fechas anteriores siguen almacenadas y se incluyen en esa conversación.

## UFC

Se consideran eventos cuya fecha oficial cae en la semana argentina actual, de lunes a domingo. Se elige el primero con fecha oficial mayor o igual a hoy; si no queda ninguno, el último de esa semana. Se desempata por horario y por identificador. No se usa `is_current` para seleccionar ni se finaliza una cartelera al cargar otra.

La fecha oficial se carga directamente. Los horarios de preliminares y principal usan cada uno su propia fecha argentina. Los instantes se guardan en UTC. Una fecha oficial del sábado puede tener cartelera principal el domingo en Argentina.

Solo un administrador (adulto en esta familia) puede marcar «Sin evento esta semana», mediante `PUT /api/sports/week`. Esa marca pertenece a una semana, tiene prioridad sobre las carteleras y no se hereda el lunes siguiente. Cargar o editar una cartelera desactiva la marca de la semana de su fecha oficial. Sin marca ni cartelera se muestra «No pudimos confirmar la cartelera».

## Conservación y permisos

Reprogramar edita el mismo evento: no modifica comentarios ni formaciones. `PATCH /api/sports/events/:id` con `action=hide` lo oculta sin borrar datos; no existe DELETE para eventos. Las referencias de comentarios, peleas y formaciones impiden borrar físicamente un evento con contenido asociado. Cancelados y ocultos no se seleccionan. Se conservan registros anteriores, sin pantalla de historial.

Carga, edición, ocultamiento y marca semanal requieren administración. Cada integrante administra su formación; se mantienen los permisos de autor/moderación de comentarios y el aislamiento por familia.

## Automatización opcional pendiente

[Resultado de la prueba de proveedores](deportes-proveedores.md): no hay categorías aprobadas. API-Football/MMA carecen de credenciales; las consultas gratuitas realizadas a TheSportsDB no devolvieron la muestra completa ni horarios UFC verificables. Por eso no se añade una integración incompleta a la app.

Una futura integración requiere aprobación de cobertura y términos, bandera independiente apagada por defecto y claves solo en el servidor. El modelo ya conserva `manually_edited` y `external_reference` (varchar de 200 caracteres). Esa entrega añadirá proveedor, unicidad por familia/proveedor/referencia y una fila de sincronización por familia.

Comportamiento acordado para esa entrega: devolver primero lo guardado, consultar después del renderizado con timeout de 5 segundos, registrar el intento mediante actualización condicional antes de llamar, reutilizar éxitos 60 minutos, reintentar fallos tras 10 minutos y limitar «Actualizar» a un intento por minuto. Respetar ediciones manuales y permitir a adultos volver a automático. Una API vacía no genera «No hay evento»; ante fallos se conservan datos y se muestra antigüedad. Sin cron ni pronósticos.
