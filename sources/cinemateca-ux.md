# Pulido de UX/UI de Cinemateca

Registro de la entrega anterior. La evolución de filtros, géneros y valoración
se documenta en [cinemateca-generos.md](./cinemateca-generos.md).

Entrega en cuatro commits: colección y filtros; ficha y estrellas; acompañantes;
validación y errores. Colores y familias tipográficas conservados. Sin cambios en
rutas, contratos públicos, base de datos ni migraciones.

## Colección y navegación

La cabecera es más compacta y las tarjetas muestran título, dirección/año, estado,
nota propia y promedio identificado como Familia. No se repiten el ícono y la
categoría Película. El promedio conserva las notas de perfiles archivados, se
presenta con un decimal localizado y distingue cero, una o varias valoraciones.

Hay un único selector de estado y un botón independiente de pendientes comunes.
Al activar la vista común se elimina el estado personal; elegir un estado elimina
la vista común. Más filtros controla únicamente archivo y su limpieza conserva
búsqueda y vista/estado. Las películas archivadas pueden ser pendientes comunes.

Los parámetros siguen siendo `q`, `status=pending|in_progress|finished|none`,
`view=common_pending` y `archived=true`. Todas omite status. En páginas, los valores
vacíos o inválidos se eliminan y common_pending prevalece sobre status. La URL se
normaliza con replace, conserva parámetros ajenos y elimina kind/type/cursor.
La API sigue rechazando combinaciones inválidas: no se alteró su validación.

## Ficha y controles

Mi experiencia aparece antes de las miradas familiares y los aportes. La nota
usa cinco radios HTML nativos con etiquetas «N de 5 estrellas»: teclado con flechas
y Espacio, foco visible, selección diferenciada por forma y botón Quitar valoración.
Quitar devuelve null, anuncia Sin valorar y enfoca la primera estrella; pulsar la
misma estrella no borra. Guardar mi experiencia sigue siendo obligatorio para
persistir cambios.

Acompañantes usa details/summary sin animación, cerrado al crear y editar. El
resumen muestra Opcional o hasta dos nombres y +N. Lista y resumen se ordenan
alfabéticamente en español, con desempate por identificador. No hay selección
automática; autor y perfiles archivados siguen disponibles. La selección se
conserva al plegar, recuperar el borrador y mientras se guarda.

Los checkboxes mantienen su semántica nativa y se distribuyen en filas compactas,
con etiquetas táctiles de al menos 44 px. Se corrigió la especificidad del selector
.page label sobre .check. Estrellas, selector y summary también tienen objetivos
mínimos de 44 × 44 px. Los tamaños de texto son relativos para admitir ampliación
sin sustituir las familias tipográficas.

## Validación

Se valida al enviar y luego solo se revalidan los campos que ya mostraban error.
Los mensajes se asocian mediante aria-describedby y aria-invalid. Se abre cualquier
details que contenga el primer campo inválido antes de enfocarlo, esperando la actualización de aria-invalid y las descripciones.
En el diálogo se centra el control en el espacio libre entre cabecera y pie fijo.
Se eliminó su rótulo decorativo para recuperar espacio con texto ampliado. Los mensajes
quedan fuera de las etiquetas para que no cambien el nombre accesible del control.

Los códigos conocidos se traducen a textos propios. Errores desconocidos y de red
usan un mensaje genérico seguro; no se presentan textos crudos del servidor.
Los errores se ubican en el formulario afectado, permiten reintentar y conservan
borradores. Se mantienen las verificaciones de permisos, conflicto y archivo.


## Verificación local

Criterios medidos a 390 × 844 px con fuentes cargadas y datos sintéticos:

| Medida | Chromium | WebKit | Límite |
| --- | ---: | ---: | ---: |
| Inicio de primera tarjeta | 493,19 px | 522,19 px | antes de 560 px |
| Final de primera tarjeta | 614,58 px | 643,58 px | dentro de 844 px |
| Acompañantes cerrados, seis seleccionados | 57 px | 57 px | hasta 80 px |

Los casos de navegador incluyen creación, edición, filtros canónicos e inválidos,
archivo con vista común, navegación, conflictos, borradores, guardado manual de
estrellas, acompañantes plegados durante el guardado, perfiles archivados y nombres
largos. Validación probada con título vacío, año inválido, enlace no permitido y
fechas imposibles o futuras. Se simularon fallos conocidos y desconocidos para
comprobar mensajes seguros, ubicación del error y conservación del borrador.

Se revisan 320, 390, 768 y 1280 px. La ampliación de texto al 200 % se prueba elevando
el tamaño raíz con tipografías relativas, separada de la prueba de zoom CSS al 200 %.
No se equiparan estas emulaciones a una prueba física de Safari o un lector de
pantalla real. Se comprueban roles, nombres accesibles, teclado, foco, aria-invalid,
aria-describedby y los análisis automáticos de axe.

El contraste forzado se prueba en Chromium. WebKit también cubre teclado,
redistribución de fecha con texto ampliado y foco no tapado en el diálogo.
Los campos de fecha se distribuyen en más filas cuando el tamaño de texto lo exige,
sin esconder el desbordamiento ni reducir el texto.

El entorno usado es PostgreSQL 18 temporal con datos sintéticos; no se accedió a
producción para estas pruebas. No hay nuevas dependencias ni migraciones.

Resultado final: 81 casos de navegador aprobados (27 por proyecto: dos perfiles de
Chromium y uno de WebKit), 11 pruebas de reglas, 11 de rutas API y 3 recorridos de
accesibilidad general. También aprobaron tipos, lint, compilación y comprobación
del diff. El pulido se entrega en cuatro commits independientes, sin publicación
ni cambios en la base de producción.
