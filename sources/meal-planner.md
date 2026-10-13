# Evolución del planificador familiar

Plan acordado el 2026-10-13. App familiar: una rama por etapa, entrega utilizable
antes de avanzar, sin capas temporales de compatibilidad ni doble escritura.

## Etapa 1: cuatro comidas y pantalla compacta

Desayuno, almuerzo, merienda y cena comparten tipos y nombres centralizados.
Desayuno/merienda: un único menú, ideas y confirmación adulta, sin asistencia,
en bloques compactos expandibles. Orden cronológico en una columna.
Almuerzo/cena conservan su asistencia manual, con conteos únicos y edición en
diálogo. Ideas junto al menú: tres alternativas y Ver todas. Solo adultos eligen;
todos proponen. Cambiar/quitar quedan en un menú, con confirmación para quitar.
Fecha nativa y fecha larga en español. Caché por familia, semana, revisión,
versión de contrato y día familiar para renovar el estado de solo lectura.

Migración 0012: agrega breakfast y snack al enum, sin reclasificar platos ni
modificar elecciones, asistencia, versiones o autoría. Se revisó la numeración
de main y ramas de Tareas/Biblioteca: el último número reservado era 0011.

Validación local: tipos, lint, compilación, reglas/PostgreSQL, rutas y recorrido
Playwright con accesibilidad a 375 y 820 px. La migración se prueba también con
un almuerzo confirmado y asistencia preexistentes. Registrar ensayo Neon y
publicación en el PR.

## Etapa 2: grupos, luncheras y rutinas

Comida fechada separada de grupos, participantes y elecciones. Casa más cero
o más luncheras en almuerzo/cena; grupo compartido en desayuno/merienda.
Participación: casa, lleva comida, afuera sin comida de casa, por definir.
Una persona como máximo en un grupo; afuera/por definir no tienen preparación.
Lleva comida asigna a Lunchera; se pueden separar grupos para platos distintos.
Menús por grupo, con destino Casa preseleccionado o el grupo de origen.
Luncheras solo visibles si existen. Confirmar no exige completar participación.

Lo mismo que en casa es una vinculación dinámica; desvincular conserva el plato
vigente, o deja pendiente si no hay. Quitar Casa deja pendientes las vinculadas.
Un grupo vacío conserva plato y se señala. Todos los integrantes pueden editar
grupos y personas; solo adultos confirman/quitan elecciones y administran rutinas.
Casa y grupos compartidos no se eliminan. Para eliminar una lunchera debe estar
sin personas ni elección propia; una vinculación pendiente no impide eliminarla.
Una propuesta confirmada en cualquier grupo no se edita ni retira.

Versiones solo para elecciones e ideas. Asignaciones de última escritura,
guardando solo personas modificadas y refrescando. Grupo eliminado mientras se
edita: rechazar y ofrecer actualizar. Conservar bloqueos y auditoría existentes.

Rutinas semanales por persona para almuerzo/cena, con versiones desde una fecha
sin retroactividad. Una versión reemplaza a la anterior; suspender usa por definir.
Rutinas organizan personas, nunca platos. Excepciones por fecha prevalecen,
incluido por definir explícito; quitar excepción vuelve a heredar.

Primera confirmación de cualquier grupo guarda toda la distribución, incluidos
pendientes. Ajustes posteriores editan esa distribución; sin ella, crean
excepciones. Quitar elecciones no borra la distribución. Sin distribución,
resolver excepciones y rutina vigente históricamente; sin datos, por definir.
Origen: Según rutina, Ajustada para esta fecha, Guardada, Guardada · ajustada,
o Por definir. La marca ajustada se activa al editar manualmente una guardada.

Volver a la rutina: cualquier integrante en día abierto, con confirmación de que
borra distribución y excepciones, incluso ajenas. Advertir qué personas sin
rutina quedarán por definir. Mantener platos/grupos; quienes llevan pasan a
Lunchera y se señalan grupos vacíos. Sigue rutina hasta la próxima confirmación
o cambio de elección; consultar no guarda snapshot.

Migración: elecciones a Casa conservando autoría/propuestas/versiones. Con menú
confirmado, asistencia a distribución guardada (presente=casa, ausente=afuera,
desconocido=por definir). Sin menú, solo presente/ausente crean excepciones;
desconocido no crea nada. No inferir luncheras. Rutinas inicialmente vacías.

Publicación: respaldo y ensayo en rama Neon, migración productiva y un despliegue
con servidor/interfaz juntos. Se acepta un corte breve; PWA antigua se recarga.
Tablas viejas quedan como referencia, no respaldo actualizado. Corregir hacia
delante; no volver a un servidor que solo conozca tablas viejas.

Corte opcional 2A: grupos/luncheras/migración/distribución explícita por fecha.
2B incorpora rutinas/excepciones/volver a rutina sin cambiar reglas de migración.
En 2A no se ofrece Volver a la rutina. Mantener desconocidos sin asignación
separados de decisiones explícitas. Cargar rutinas reales de Camí/Pedro solo con
horarios aportados por la familia, y probar un día concreto.

Pruebas puntuales: desconocido no tapa rutina; snapshot estable y ajuste marcado;
volver a rutina conserva platos; vincular lunchera, quitar Casa, reasignar y
eliminar lunchera vacía. Lectura semanal ya devuelve grupos en esta etapa.

## Etapa 3: semana

Semana como entrada, enlaces con fecha abren Día. Reutilizar GET /api/meals con
weekStart (ya existe y no crea registros): una consulta para siete días y cuatro
comidas, con grupos desde etapa 2 y caché por semana. Casa/luncheras/pendientes,
desayuno/merienda secundarios. Texto además de color para vínculos/pendientes;
Casa + lunchera para un plato vinculado. Cuadrícula en escritorio, días apilados
en móvil, sin scroll horizontal. Volver del día conserva la semana.

## Etapa 4: banco de ideas

Nombre, nota, etiquetas por comida y apta para lunchera; búsqueda, filtros,
archivo. Etiquetas orientativas. Usar crea una propuesta independiente fechada
con referencia al original. Editar/archivar original no cambia lo planificado.
Guardar propuesta en banco es explícito, sin importar historial. Cada integrante
administra propias, adultos todas; confirmación adulta.

## Límites y calidad

Hoy/futuro editables en zona familiar; pasado solo lectura. Auditoría y aislamiento
familiar. Tipos, lint, pruebas existentes adaptadas, reglas nuevas relevantes y
recorrido móvil/tablet, sin tests de conteo de toques. Fuera: recetas completas,
ingredientes, compras automáticas, calendarios y notificaciones. Retirar tablas
viejas solo en una entrega posterior validada.

## Registro de entregas

- Etapa 1 publicada en PR #23; migración 0012 verificada en producción.
- Etapa 2: migración 0013 ensayada en `menus-etapa-2-ensayo`, conservando
  íntegramente las tablas anteriores y las elecciones. Desconocidos sin menú
  no crean excepciones. Respaldo previo: ejecución 38400662969 correcta.
- Rutinas configurables con nombre, siete días y fecha de inicio; copiar
  versiones permite preparar vacaciones y regreso. No hay horarios familiares
  fijos en el código.

- Etapa 2 publicada en PR #24; migración 0013 verificada y rutinas configuradas
  desde la app. Los ajustes puntuales migrados conservan prioridad; Usar rutina
  por persona permite retirar un ajuste sin tocar a los demás.
- Etapa 3: semana como entrada, Día para detalle y enlaces fechados. Un GET por
  semana; cambiar de vista dentro de la misma no consulta otra vez. Cuadrícula
  en tablet/escritorio, días apilados en móvil y menús vinculados combinados.
  Cinco recorridos de interfaz/accesibilidad locales aprobados a 375/820 px.

- Etapa 3 publicada en PR #25; vista semanal verificada en producción.
- Etapa 4: banco con búsqueda y etiquetas orientativas, archivo reversible,
  permisos propios/adultos y copia independiente hacia propuestas fechadas.
  Migración 0014 ensayada en `menus-etapa-4-ensayo`: banco vacío y datos
  anteriores conservados, incluidas distribuciones y rutinas. Se verificó
  lectura por el rol de respaldo. Pruebas locales: 47 de reglas/base de datos,
  47 de rutas y seis recorridos de interfaz/accesibilidad en móvil/tablet.

## Ajuste de navegación a hoy

Entrar con el selector Semana o Día vuelve a la fecha actual según la zona
familiar. La semana desplaza la vista hasta la tarjeta de hoy; el día muestra
su fecha al comienzo del contenido. Elegir explícitamente otra fecha o un día
de la cuadrícula conserva esa elección. Consultas posteriores de actualización
no desplazan la vista otra vez.
