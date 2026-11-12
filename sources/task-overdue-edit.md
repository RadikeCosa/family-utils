# Edición de tareas simples pendientes

La edición de una tarea sin repetición conserva la identidad y fecha de sus
ocasiones abiertas, también cuando son anteriores a hoy. Cambiar solo el nombre
no reprograma ni duplica el pendiente. Una fecha nueva explícita reprograma la
misma ocasión; no se permite introducir una fecha pasada distinta de la actual.

Las responsabilidades que continúan conservan ocasión y origen; las retiradas
se archivan con auditoría y las nuevas reciben su propia ocasión. Las completadas
no se modifican ni se reabren. Tarea, ocasiones, auditoría y revisión familiar se
actualizan en la misma transacción, con rechazo de versiones obsoletas.

Base de reproducción: ff8420318d17740a80fbbbc7d3f9cc5168e83771.
La prueba de rutas de edición atrasada falla antes del arreglo con dos ocasiones
abiertas en lugar de una. Esta corrección no cambia políticas ni formularios.
