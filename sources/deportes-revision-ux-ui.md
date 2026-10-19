# Revisión UX/UI de Deportes

Revisión de la experiencia vigente y propuesta de rediseño, con prioridad en móvil. Fecha: 18 de octubre de 2026.

## Alcance y evidencia

Se revisaron `AgendaApp`, `ChampionsAgenda`, `UfcPredictions`, `UfcDashboard`, sus módulos CSS, la guía de producto y las pruebas E2E disponibles. Se contrastaron navegación, jerarquía, respuesta accesible y adaptación responsive en el código. La referencia visual de cuatro vistas está en [diseños de referencia](deportes-redisenio.html).

El estado de Git de inicio estaba limpio en `main` (`9f8eb531`), al día con `origin/main` tras actualizar referencias. La auditoría y prototipos están en la rama `codex/deportes-ux-ui`; los otros worktrees no se modificaron.

No se pudo iniciar la aplicación con datos familiares ni verificar sus estados visuales reales: no hay `DATABASE_URL` ni `FAMILY_UTILS_TEST_DATABASE_URL` disponibles en este entorno. Los diseños usan contenido ficticio y expresan una propuesta; no son capturas de producción ni acreditan pruebas con usuarios. La prueba E2E de Sports existente incluye Axe y revisión de desbordamiento para la agenda en móvil y escritorio, pero no cubre en esta ejecución Champions y el dashboard con datos conectados.

## Hallazgos priorizados

### P1 · La ficha principal queda después de controles de agenda

En River y UFC, la página muestra las pestañas, selección de eventos, estados Próximos/Anteriores y botón Actualizar antes de la ficha del evento ([AgendaApp.tsx, línea 215](../src/app/deportes/AgendaApp.tsx#L215), [línea 245](../src/app/deportes/AgendaApp.tsx#L245)). En un teléfono, esta secuencia desplaza fecha, hora y enfrentamiento —la información más consultada— hacia abajo, y la lista horizontal de eventos requiere un gesto lateral cuyo contenido adicional puede pasar inadvertido.

**Mejora:** presentar primero la ficha del evento seleccionado, con fecha, hora argentina y estado; colocar selección de evento en un control compacto y accesible después o dentro de la ficha. Hacer visible que la lista tiene más contenido lateral cuando se conserve el carrusel.

### P1 · Atrás no recupera deporte o evento anterior

`navigate` actualiza la URL con `router.replace` al cambiar de deporte o evento ([AgendaApp.tsx, línea 108](../src/app/deportes/AgendaApp.tsx#L108)). El destino queda enlazable, pero cada selección sustituye el historial; Atrás puede abandonar Deportes en lugar de volver a la selección previa.

**Mejora:** usar navegación que cree historial para cambios explícitos y mantener selección e historial sincronizados con la URL. Probar Atrás/Adelante en cada pestaña y selección.

### P2 · La navegación a Champions no comparte la misma continuidad

Champions presenta su propia tira de jornadas, conteo de pronósticos y tarjetas de partidos ([ChampionsAgenda.tsx, línea 43](../src/app/deportes/ChampionsAgenda.tsx#L43)). La selección de jornada también reemplaza la URL. El patrón no indica claramente el evento/jornada activa en una ficha resumida antes del listado.

**Mejora:** conservar el patrón de cabecera y selector entre deportes, mostrando nombre, rango de fechas, avance de pronósticos y estado; preservar Atrás/Adelante.

### P2 · Los flujos de participación pueden quedar lejos de la información del evento

La ficha ofrece enlaces directos a formación, pronósticos y conversación, y los anclajes tienen margen de desplazamiento ([AgendaApp.tsx, línea 303](../src/app/deportes/AgendaApp.tsx#L303); [agenda.module.css](../src/app/deportes/agenda.module.css)). Sin embargo, al aterrizar en una ficha la persona debe interpretar qué participación está abierta o qué acción le falta. UFC comunica cantidad elegida y cierre dentro del bloque de pronósticos, no junto al resumen del evento ([UfcPredictions.tsx, línea 124](../src/app/deportes/UfcPredictions.tsx#L124)).

**Mejora:** mostrar un resumen pequeño de tarea/estado bajo la ficha (“X de Y pronósticos · cierre …”) que lleve al bloque; añadir progreso equivalente de jornada en Champions. Mantener privacidad de elecciones hasta el cierre.

### P2 · Las estadísticas UFC combinan varias lecturas extensas

El dashboard apila métricas, tabla expandible, evolución, batacazos, detalle por pelea y simulación financiera ([UfcDashboard.tsx, línea 75](../src/app/deportes/ufc-dashboard/UfcDashboard.tsx#L75)). En móvil, la tabla financiera conserva desplazamiento horizontal y algunos valores usan tamaño compacto ([dashboard.module.css](../src/app/deportes/ufc-dashboard/dashboard.module.css)). La tabla familiar de Champions, en cambio, solo expone puesto, integrante y puntos.

**Mejora:** mantener al principio velada, resumen y ranking; dar acceso por anclas a evolución y detalle; permitir leer cada resultado sin depender de la tabla ancha. Mantener la simulación secundaria y declarada como hipotética. Asegurar unidad y significado visibles para todos los números.

### P3 · Herramientas administrativas requieren demasiado recorrido

Los importadores y acciones de administración aparecen al pie de la página en un `details` que contiene varias herramientas ([AgendaApp.tsx, línea 439](../src/app/deportes/AgendaApp.tsx#L439)). Esto mantiene limpia la vista de familia, pero hace difícil localizar la operación correcta y recorrerla en teléfono.

**Mejora:** conservar el acceso protegido y cerrado por defecto, pero ordenar las operaciones en grupos con nombre, estado y propósito. Mantener plantilla, validación, vista previa, confirmación y errores inline.

## Dirección propuesta

- **Estructura común:** encabezado familiar compacto → selector River/UFC/Champions → ficha/resumen activo → acción o progreso familiar → contenido del deporte → conversación → administración al final.
- **River:** identidad roja discreta; enfrentamiento, horario/estado y resultado arriba; bloques separados para formación oficial y formación deseada; conversación vinculada al partido.
- **UFC:** tipo y fecha de cartelera; horarios por bloque argentino y estelar; avance/cierre de pronósticos cerca de la ficha; conversación; ranking accesible desde la cartelera.
- **Champions:** selector de jornadas con temporada, rango y progreso; partido por día con hora, estado, opciones local/empate/visitante y explicación del cierre; tabla de familia y conversación de jornada.
- **Ranking UFC:** velada/histórico y selector visibles al inicio; posición y aciertos primero; detalles y simulación financiera bajo demanda; detalle por pelea legible en ancho móvil.
- **Visual:** superficies claras y cálidas alineadas con Family Utils, tipografía actual y acentos propios de cada deporte. Usar color junto con texto/estado, nunca como única señal.

## Secuencia sugerida de implementación

1. Reordenar cabecera y ficha de River/UFC; corregir comportamiento Atrás/Adelante y validar enlaces profundos.
2. Unificar resumen y selector de ronda en Champions; hacer visible progreso y mejorar orientación entre jornadas.
3. Ordenar la información del dashboard y mejorar lectura móvil del detalle y de la tabla financiera.
4. Reagrupar herramientas administrativas y revisar estados de carga, éxito, error, confirmación y borradores.
5. Ejecutar pruebas visuales y de accesibilidad en 360, 390, 430 y 1365 px, incluidos integrante/administrador, datos largos, vacío y errores.

## Compatibilidad y validación

La propuesta conserva rutas, tipos y contratos de datos; permisos, privacidad de pronósticos, reglas de cierre y puntos, identidad de eventos, comentarios, formaciones, resultados e historial. No añade datos, fuentes, seguimiento en vivo ni edición manual de eventos.

La prueba `tests/e2e/sports-next.spec.ts` ya revisa accesibilidad automatizada y ancho horizontal en móvil y escritorio para la agenda. La siguiente validación debe completar recorridos con base PostgreSQL aislada para Champions, dashboard y controles administrativos, además de Atrás/Adelante y borradores entre cambios de vista. No se ejecutaron pruebas que requieran base porque faltaba la URL de prueba.
