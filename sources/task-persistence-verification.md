# Tareas persistentes: implementación y verificación

Fecha: 12 de noviembre de 2026. Cambios locales preparados para revisión; este
informe no acredita integración remota ni publicación en producción.

## Entregas aisladas

| Entrega | Rama | Worktree |
| --- | --- | --- |
| Edición de tareas atrasadas | `codex/tasks-overdue-edit` | `/tmp/family-utils-tasks-persistent` |
| Reglas y API compatibles | `codex/tasks-persistent-rules` | `/tmp/family-utils-tasks-rules` |
| Interfaz y recorridos completos | `codex/tasks-persistent-ui` | `/tmp/family-utils-tasks-ui` |

La primera entrega partió del commit limpio
`ff8420318d17740a80fbbbc7d3f9cc5168e83771`. Antes de modificar el handler se
agregó y ejecutó una regresión real: editar solo el nombre de una tarea de ayer
producía dos ocasiones abiertas; la aserción esperaba una y falló con `2 !== 1`.
Después del arreglo aprobaron las 15 pruebas de rutas de esa entrega.

La interfaz parte de `c799b0b`, una base comprometida con navegación unificada,
y contiene las correcciones de las entregas anteriores. El directorio principal
permanece en `main` con su trabajo previo sin mover ni sobrescribir.

## Comportamiento y cobertura

- Alta con solo nombre y opciones plegables que conservan valores; validación
  que abre opciones y enfoca el campo; foco del diálogo y retorno con Escape.
- Un pendiente ordinario compartido o uno por persona, con descarte individual.
- Continuidad sin repetir; conversión entre simple y rutina sin duplicar;
  excepciones explícitas conservadas y editables independientemente.
- Fechas civiles de Buenos Aires, inicio de ocasiones sin fecha, orden y
  paginación estable. Cursores y ETags anteriores se invalidan por versión.
- Doble finalización, sincronización concurrente, deshacer con sucesores,
  omisión desde el día real, rollback y rechazo de datos previos duplicados.
- Horarios conservados al editar el nombre, con formato de minutos en el
  formulario; no se modifica la precisión del contrato de entrada de la API.
- Las ocasiones completadas y la auditoría se conservan. No hay migraciones
  SQL nuevas ni dependencias de aplicación añadidas.

Los contratos están en [navegación diaria](task-daily-navigation.md),
[producto](product-brief.md) y [corrección inicial](task-overdue-edit.md).

## Entorno y recuperación

Se usaron exclusivamente fixtures ficticios y una instancia PostgreSQL 18.6 propia,
con base `champions_test` en loopback, puerto 55434. La base existente del puerto
55432 no se modificó. El runtime fue Node 24.21.0.

WebKit del host no iniciaba por bibliotecas faltantes. La verificación compatible
usa la imagen oficial Playwright 1.63.0 sobre Ubuntu Noble, fijada al digest
`sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27`,
con `postgresql-client` instalado únicamente en la imagen temporal de pruebas.
No se cambiaron paquetes globales del host ni configuración de producción.

Para recuperar la presentación anterior se puede revertir la entrega de interfaz,
conservando las correcciones de integridad y compatibilidad de API. Una reversión
de lógica debe mantener aceptación de tareas simples con `carry_forward`, su
booleano coherente y la invalidación de cursores; no se deben reescribir datos ni
borrar auditoría. Si se cambia de nuevo el orden, usar una nueva versión de lista.

Antes de integrar se requiere PR con CI correcto. Antes de publicar corresponde
confirmar destino y revisar, con resultados agregados, posibles inconsistencias
reales; no se utilizaron datos de producción como fixtures ni se intentó corregirlos.

## Resultados

El conjunto completo `bash scripts/verificar-todo.sh`, con URL local explícita,
aprobó sobre la base de código `41ad93a` en el entorno compatible:

| Grupo | Aprobados | Fallidos | Omitidos |
| --- | ---: | ---: | ---: |
| Tipos, lint, build, migraciones y permisos SQL | 7 | 0 | 0 |
| Reglas e integración general | 182 | 0 | 0 |
| Rutas | 149 | 0 | 0 |
| Navegador general, incluidos los tres proyectos móviles de Tareas | 250 | 0 | 0 |
| Deportes | 40 | 0 | 0 |
| Champions | 36 | 0 | 0 |
| Accesibilidad general | 3 | 0 | 0 |
| **Total del verificador** | **667** | **0** | **0** |

La navegación compartida aprobó además 8 pruebas unitarias y 15 recorridos Chromium.
Los 25 casos de rutas de Tareas incluyen el handler real, transacciones, permisos,
versiones, cursores y la respuesta condicional HTTP 304. Se detecta una incoherencia
ficticia previa y se comprueba rechazo sin reparación silenciosa.

Durante el desarrollo se corrigió contraste de «Cancelar» en los diálogos de
Tareas. La simulación de revisión usa una respuesta 200 estable porque WebKit no
permite interceptar y devolver 304; la respuesta 304 se comprueba contra la API
real. Un fallo transitorio de preparación de acceso de Cinemateca apareció en un
ensayo y no volvió a reproducirse en las verificaciones completas posteriores.

El ajuste posterior de horario, commit `c271f03`, aprobó lint, build con tipos y
los **48 recorridos de Tareas** (16 en Chromium iPhone, 16 en Chromium Android y
16 en WebKit iPhone). Incluye crear con horario, editar solo el nombre y comprobar
que la ocasión conserva las 18:00 en la base. El diálogo abierto se audita con axe
en los tres proyectos móviles. Las tres pruebas pendientes de navegación WebKit
aprobaron también: la cobertura compartida suma 15 Chromium y 3 WebKit.

No quedaron fallos locales pendientes en estas comprobaciones. La suite completa
precede al ajuste pequeño de formato; después de ese ajuste se repitieron los
controles y recorridos afectados, sin volver a ejecutar dominios ajenos. Los logs
locales de respaldo están en `/tmp/tasks-complete-verification.log` y
`/tmp/tasks-focused-final.log`, fuera de Git.

La instancia temporal `family-utils-tasks-test` se detiene al cerrar el trabajo,
conservando sus datos ficticios para inspección. Los contenedores de navegador se
retiran automáticamente. Las ramas y commits permanecen disponibles para revisión.
