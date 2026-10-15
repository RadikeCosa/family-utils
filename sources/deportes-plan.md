# Deportes: alcance implementado

## Operación actual

La cartelera se mantiene con archivos JSON de datos revisados y curados en el
chat. La app no consulta Google, ESPN, UFC ni otras fuentes por su cuenta. No
hay sondeo ni tarea programada. La documentación de la pantalla y del flujo de
carga está en [Deportes: funcionamiento y guía UX/UI](deportes-ux-ui.md).

Un administrador pega el JSON o lo selecciona como archivo, valida una vista
previa y confirma la importación. La vista previa no escribe. La API valida
permisos y contenido, y actualiza River y UFC por separado en transacciones
breves. Si falla una categoría, se conserva la última información válida para
esa categoría. Los IDs, comentarios, formaciones, eventos ocultos y correcciones
manuales se conservan al actualizar. No se ofrecen formularios para crear o
editar eventos y peleas.

La carga conserva procedencia y fecha de revisión. Se rechazan datos vencidos,
referencias duplicadas, fuentes fuera de la lista HTTPS permitida, horizontes
no completos, carteleras UFC incompletas o peleas inválidas. Cuando cambia una
referencia externa, solo se reutiliza un evento equivalente único dentro de
siete días; si la coincidencia es ambigua, la categoría no se importa.

La información actual preparada para importar está en
[`deportes-carga-2026-10-15.json`](deportes-carga-2026-10-15.json). La cartelera
UFC del 31 de octubre tiene validación oficial completa y verificación
independiente pendiente; esa advertencia aparece en la vista previa.

## Presentación y datos familiares

La página mantiene las pestañas River y UFC. River muestra el próximo partido;
UFC muestra la cartelera de la semana argentina actual y usa la fecha oficial
publicada, con horarios expresados para Argentina. Comentarios y formaciones
continúan disponibles. Ocultar un evento lo saca de la cartelera visible pero
no borra sus datos asociados.

Las correcciones de campos y las peleas protegidas tienen prioridad frente a
datos automáticos posteriores. Los eventos futuros que dejan de aparecer en
una actualización completa se marcan como ausentes, no se borran. Una respuesta
vacía no elimina datos ni equivale a confirmar que no hay evento.

## Automatización futura

La infraestructura de consulta automática está desactivada y no forma parte
del flujo de carga vigente. No activar interruptores ni agregar consultas a
proveedores hasta confirmar una fuente cuyo uso automatizado esté permitido.
Los límites de uso gratuito, reglas de integridad, flags y los scripts de
prueba/limpieza se documentan en las notas de proveedores y en sus propios
archivos; la limpieza de pruebas debe ejecutarse con dry-run primero y sobre
una base aislada.
