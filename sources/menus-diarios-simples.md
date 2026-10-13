# Menús diarios simples — cotejo y conservación

## Paso 0 — 2026-10-13

Vercel identifica producción como `dpl_9jkcfJ6CqGbYzLMEhH5DsacHj9Dr`, commit
`f90ba0bac878b65b3cc147bdf318c849db366d33` (PR #27, foco en hoy).
El checkout inicial estaba en `2db947e`, anterior a las cuatro comidas, grupos,
rutinas, semanal y banco. La implementación parte de la versión publicada.

La consulta de inventario se realizó en una transacción READ ONLY, sin nombres
ni platos en la salida: 13 horarios, 13 grupos (todos home, ninguno follows_home),
9 distribuciones guardadas, 2 excepciones explícitas home y 4 rutinas. No hay
horarios con más de dos grupos con plato. La verificación con el traductor
real (`scripts/inspect-meal-translation.mjs`, READ ONLY) clasifica los 13 horarios
como compatibles y ninguno como ambiguo; proyecta 23 estados home, 5 away y
24 unknown, sin aplicar rutinas ni escribir registros. Los contratos de esa versión usan
home/packed/away/unknown; no existen valores literales casa/lunchera/ninguna.

Permisos comprobados: el código publicado permite cambiar la distribución
familiar a cualquier integrante y reserva la elección de platos a administrator.
La nueva experiencia restringe estado/asignación: administrator a todos, member
solo a sí mismo. Las propuestas siguen abiertas a todos.

| Origen comprobado | Traducción |
| --- | --- |
| home explícito o distribución congelada | Está |
| packed (comida preparada en esta casa) | Se lleva |
| away (afuera sin comida de casa) | No preparar |
| unknown, null o sin registro | Sin elegir, sin opción marcada |
| present/absent de la primera versión, sin registro posterior | Está/No preparar |
| follows_home | Mismo menú que el grupo principal |
| Grupo con plato y destinatarios explícitos | Asignar al menú de ese plato |
| Estado/grupo incoherente, referencia rota, más de dos menús | Plan anterior de solo lectura |

No se aplica una rutina para completar un día nuevo. Las distribuciones ya
guardadas sí son datos explícitos y se conservan. Los registros antiguos no se
reescriben: una tabla adicional guarda el plan nuevo y una copia de su origen al
primer cambio. La lectura proyecta los datos compatibles sin escribir. Los planes
ambiguos se conservan y muestran como anteriores; no se fuerza su conversión.

## Publicación y recuperación

La migración es aditiva y no convierte ni elimina datos de producción. Debe
verificarse primero en PostgreSQL aislado con casos compatibles, ambiguos y con
más de dos platos. La implementación local no publica ni migra producción;
la salida requiere la autorización de publicación. Publicar servidor y pantalla
juntos tras aplicar y verificar
la migración. Los endpoints antiguos de grupos, distribución, asistencia, elección
y rutinas no aceptan nuevas escrituras: evitan que una pestaña antigua saltee
permisos o siga modificando los datos de origen.

Conservar la tabla nueva en cualquier reversión; volver a la pantalla anterior
oculta las decisiones nuevas y requiere cotejarlas antes de reabrir escrituras.

## Evaluación a los 14 días de uso

Sin telemetría familiar nueva. Contar en una muestra de días los cambios de estado,
asignación y confirmación necesarios, y preguntar si hace falta copiar un día.
No habilitar rutinas ni copia automáticamente.

## Implementación y comprobaciones

- `GET /api/meals/planner?weekStart=...`: lectura coherente de las cuatro comidas,
  sin generación ni herencia de rutinas. Proyecta los registros antiguos compatibles.
- `PUT /api/meals/planner`: acciones person, propose, confirm, add-second,
  remove-second y clear. Exige versión, permisos y día abierto. La eliminación del
  menú 2 y la reasignación ocurren en una única transacción.
- `meal_daily_plans` guarda elecciones nuevas y una copia inmutable del origen.
  Sin elegir no se persiste como respuesta: se omite a esa persona y la lectura
  completa la pantalla con ninguna opción marcada. Se conservan también los datos
  de integrantes archivados.
- Las ideas anteriores no se editan ni retiran desde clientes antiguos. Las
  propuestas nuevas no confirmadas mantienen edición/retiro con permisos y versión.
- Entrada nueva: hoy/día. URL con fecha o vista: recarga y navegación histórica
  respetan el contexto. Semana es consulta. Confirmar un único menú vacío es directo;
  reemplazar o elegir entre dos menús abre una revisión breve.

Verificado en PostgreSQL 18 aislado: migraciones e historial de hashes, pruebas
unitarias y de base, rutas autenticadas, concurrencia, errores y conservación.
Verificado con las suites móviles de iPhone/Android y accesibilidad entre 320 y
1280 px, incluyendo el flujo de Menús a 360 px. Los escenarios anteriores de grupos
visibles/rutinas se reemplazaron por pruebas del contrato nuevo, conservando las
pruebas históricas de reglas y migraciones.

La implementación inicial se mantuvo local. La publicación fue autorizada
expresamente el 13/10/2026, después de solicitar una revisión completa.

## Revisión final y salida — 2026-10-13

Diff revisado contra `f90ba0b`: contratos, aislamiento familiar, permisos por
persona, versiones, transacciones, conservación, navegación, ideas, accesibilidad
y sustitución de las pruebas de la interfaz anterior. Sin hallazgos bloqueantes
pendientes después de los ajustes siguientes:

- Una respuesta de una semana anterior, incluso al usar Atrás durante un guardado,
  no puede sustituir los datos de la semana seleccionada. Se agregó un escenario
  móvil específico para esta carrera.
- Las lecturas dentro de una transacción se ejecutan en orden en su única conexión,
  evitando la advertencia de consultas simultáneas del driver.
- Se agregó una prueba que aplica la migración sobre tablas anteriores pobladas,
  compara su contenido completo y comprueba que repetirla no modifica el historial.

Verificación local final, PostgreSQL 18 aislado y sin pruebas omitidas:

| Comprobación | Resultado |
| --- | --- |
| Diff sin errores de espacios, lint y tipos | Correcto |
| Compilación de producción | Correcto |
| Unitarias, base y migraciones | 53 aprobadas |
| Rutas autenticadas | 50 aprobadas |
| Flujos móviles completos | 54 aprobados |
| Accesibilidad, 320–1280 px | 3 aprobadas |

### Migración de producción

Se comprobó que las 15 migraciones aplicadas coincidían exactamente con el
prefijo del historial local (timestamps y SHA-256). Solo estaba pendiente
`0015_meal_daily_plans`; la conexión directa y la agrupada apuntaban a la misma
base. El traductor siguió clasificando los 13 horarios como compatibles.

Se aplicó exclusivamente la migración aditiva y se verificaron las 16 migraciones
con sus hashes. Se compararon cantidades y digests de contenido antes/después:
las nueve tablas anteriores de Menús permanecieron idénticas, sin reescrituras.
La tabla nueva quedó vacía: la conversión continúa siendo de lectura y la copia
se realiza al primer cambio explícito de una comida.

La salida de la aplicación se realiza mediante PR a `main`, esperando el check
obligatorio de CI antes de integrar. El despliegue de Vercel debe quedar READY y
servir la revisión integrada; el cierre en la descripción del PR registra la URL,
el despliegue y la comprobación posterior en producción.
