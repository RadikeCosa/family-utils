# Family Utils — definición del producto

## Propósito

Family Utils es una plataforma con aplicaciones útiles para organizar la vida
cotidiana de una familia. Comparte acceso, integrantes, permisos, presencia y
navegación. Cada aplicación mantiene su dominio. La primera es **Tareas y
rutinas**.

La primera instalación se usará con una familia privada de cuatro personas:
dos administradores adultos y dos integrantes jóvenes. Calendarios,
responsabilidades y nombres reales se guardan como configuración privada y no
se fijan en el código ni en documentación pública.

## Tareas y responsabilidades

- Crear una tarea requiere solo un nombre. Descripción, responsable, fecha,
  horario y repetición son opcionales.
- Una tarea sin responsable queda disponible para que cualquier integrante la
  asuma. Puede tener uno o varios responsables.
- Una tarea compartida se completa una vez y registra quién la marcó. Las
  responsabilidades individuales producen ocasiones independientes.
- Todos pueden consultar, crear, editar, asignar, asumir y completar. Editar
  una tarea compartida muestra quién hizo el cambio y cuándo.
- Solo administradores pueden finalizar rutinas, archivar/restaurar tareas y
  archivar/restaurar perfiles. No se elimina permanentemente en la primera
  versión.
- Quien completó una tarea o un administrador puede deshacer esa finalización.
- Las acciones sensibles se autorizan en el servidor. Cambios y revisiones de
  familia se escriben de forma atómica y con control de versión.

## Repetición y estados

Las rutinas repiten una tarea diaria o en días elegidos de la semana. Al
configurarlas se elige si cada ocasión vence al final del día familiar o si
permanece pendiente hasta completarse. En el segundo caso existe como máximo
una ocasión abierta por responsabilidad; al completarla, la próxima se agenda
para el siguiente día programado posterior a la finalización y aparece cuando
llega ese día. Si ayer quedó pendiente, hoy continúa la misma ocasión; no se
crea una segunda. Una ocasión completada se muestra como hecha durante el día
familiar de Buenos Aires y después permanece en el historial.

Las tareas permiten navegar diez años hacia atrás y seis meses hacia adelante.
Hoy sigue automáticamente el día de Buenos Aires; elegir una fecha la fija.
El pasado consulta registros existentes y es de lectura. Una finalización
posterior al vencimiento aparece también como actividad en el día de cierre.
El futuro muestra previsiones sin escribir en la base y separa los pendientes
potenciales. Las excepciones futuras se guardan al editar solo esa ocasión;
las acciones de completar, asumir y omitir se realizan desde Hoy.

Editar permite distinguir la ocasión actual de la programación futura.
Finalizar una rutina detiene las ocasiones futuras y conserva los pendientes.
Archivar además oculta las tareas pendientes de las vistas activas. Restaurar
reanuda a partir de esa fecha y no crea incumplimientos retroactivos.

## Calendario de presencia

Cada integrante puede editar su calendario; los administradores también pueden
editar el de otros. Se admiten horarios semanales, períodos que los reemplazan
temporalmente y excepciones por día, en ese orden de prioridad: excepción,
período temporal y semana habitual.

Las tareas con horario verifican presencia en ese momento. Las tareas sin
horario verifican cualquier solapamiento del día. Si hay varios responsables,
basta con que uno esté presente. Las ausencias no generan incumplimientos ni
reasignaciones automáticas. Un pendiente anterior a una ausencia permanece en
la vista familiar y vuelve a la vista personal cuando corresponde estar en
casa.

Las fechas, el vencimiento diario y los intervalos que cruzan medianoche usan
`America/Argentina/Buenos_Aires`, aunque el teléfono tenga otra zona horaria.
No se usa GPS ni se requiere registrar movimientos reales.

## Acceso y perfiles

- Cada perfil familiar se asocia a una identidad de acceso. Los adultos usan
  una identidad Google verificada por perfil y pueden abrir sesiones en varios
  dispositivos. Los integrantes jóvenes usan una identidad anónima distinta en
  cada dispositivo.
- El perfil familiar es independiente de la identidad y de cada dispositivo.
  Recuperar el acceso mantiene tareas, permisos e historial.
- Invitaciones duran 24 horas y recuperación 30 minutos. Los integrantes
  jóvenes ingresan ambos códigos dentro de la PWA instalada; los adultos usan
  una invitación para vincular su perfil Google por primera vez. Abrir una
  página no canjea ni consume un código.
- Códigos de diez caracteres Crockford se muestran `XXXXX-XXXXX`; el servidor
  guarda HMAC con secreto privado. Tokens largos se almacenan con SHA-256.
- Los códigos son de un solo uso y el canje se realiza de manera atómica. Para
  un integrante joven, recuperar el acceso revoca sus dispositivos anteriores.
  Un adulto vuelve a iniciar sesión con la misma cuenta Google.
- En iPhone, instalar primero la PWA y comenzar OAuth desde el icono asegura
  que la sesión se cree en el mismo contexto en que se usará la aplicación.
- Las sesiones vencen tras 90 días de inactividad y se renuevan a diario.
- No se puede degradar, archivar ni dejar sin recuperación al último
  administrador.
- Administradores pueden archivar perfiles duplicados o mal cargados. Se
  bloquea su acceso y la generación futura, se conserva el historial y sus
  pendientes quedan visibles para reasignación manual.

## Experiencia y sincronización

La plataforma abre primero sus aplicaciones y la gestión familiar. Tareas y
rutinas ofrece la vista diaria, edición, alta e historial paginado. La vista de
semana se incorporará en una entrega posterior. La aplicación valida membresía
y permisos en el servidor.

Un endpoint autenticado de revisión/ETag familiar incluye el día de Buenos
Aires para refrescar también al pasar la medianoche. Se consulta cada 30
segundos con la app visible y actividad
reciente, y se pausa tras dos minutos de inactividad. Volver a la app, recuperar
conexión o pedir actualización inicia una consulta. Se muestra la última
actualización.

## Planificador de menús

La vista principal resume una semana, con desayuno, almuerzo, merienda y cena.
Seleccionar un día abre su detalle en orden cronológico; volver conserva la
semana consultada. Los enlaces con fecha abren directamente el día. Desayuno y merienda son bloques compactos expandibles,
sin asistencia. Almuerzo y cena muestran la asistencia resumida con edición en
un diálogo. Almuerzo y cena separan Casa y las luncheras necesarias; cada grupo
puede elegir un plato, y una lunchera puede seguir el menú de Casa. Las ideas
aparecen junto al menú, con hasta tres alternativas y
acceso a todas; cambiar o quitar una elección queda en un menú de acciones.
El banco familiar permite guardar ideas con nota y etiquetas orientativas, buscar,
filtrar, archivar y restaurar. Usar una crea una propuesta independiente para una
fecha y comida; editar o archivar el original no cambia lo planificado. Guardar
una propuesta en el banco es explícito; no se importa el historial. Cada integrante
administra sus ideas y los adultos pueden administrar todas. Todos
los integrantes activos pueden proponer ideas y cualquier integrante activo
puede registrar o corregir la asistencia de cualquier persona activa de su
familia en almuerzo y cena. Se muestra quién hizo el último cambio de asistencia
y cuándo; si hay
ediciones simultáneas, prevalece la última escritura.

Solo un administrador adulto puede elegir la comida de cada grupo a partir de una
idea o escribir una nueva y elegirla en el mismo paso. La asistencia es
informativa y no bloquea esa elección, incluso si todos figuran ausentes.
Quitar una elección no retira la idea. La elección se comparte al consultar o
actualizar la app; esta versión no envía notificaciones ni altera la asistencia
al elegir.

Las mutaciones se cierran al comenzar el día siguiente según la zona horaria
familiar, actualmente `America/Argentina/Buenos_Aires`. Los días anteriores
son de solo lectura. La vista conserva la revisión propia de menús para no
refrescar por cambios de tareas. La participación puede heredar una rutina semanal configurable por persona y
comida, con vigencia desde una fecha y excepciones puntuales. La primera elección
guarda la distribución; los ajustes manuales se identifican y Volver a la rutina
permite recalcular conservando platos. Para vacaciones se programan nuevas
versiones y se puede copiar una anterior al regresar. La integración con
calendarios queda para una etapa posterior.

La experiencia offline se limita a consultar datos ya cargados; no escribe ni
sincroniza cambios. Si el aislamiento por usuario, la limpieza al salir y la
recuperación del almacenamiento no se verifican en dos jornadas, la consulta
offline se pospone sin frenar el uso conectado.

## Tecnología y operación

Next.js App Router, React, TypeScript, CSS Modules, PostgreSQL 18 en Neon,
Drizzle y `node-postgres`. La app usa la conexión agrupada con runtime Node y
transacciones sobre una única conexión. Migraciones y respaldos usan conexión
directa. Vercel hospeda la aplicación.

La provisión remota debe mantenerse en planes gratuitos. No se activa consumo
pago ni se elige un plan pago. Un respaldo diario cifrado con `age` se conserva
30 días como artefacto de un repositorio privado independiente. Se usa un rol
de base de datos de solo lectura y `pg_dump` de versión mayor 18. La clave
privada se conserva fuera de Git y tiene una copia protegida adicional.

## Fuera de la primera versión

Recordatorios, registro público de familias, escritura offline y aplicaciones
adicionales quedan para después del uso familiar del primer módulo.

## Listas de compras

La tercera utilidad, ya publicada, está disponible desde la portada y en
`/compras`. Todos los integrantes activos pueden consultar las listas
familiares y crear listas. Cada dueño elige editores por perfil; nombre de
producto es obligatorio, marca y cantidad son opcionales. Se puede marcar lo
comprado, reutilizar una lista y administrar sugerencias aprendidas al comprar.
Los administradores pueden transferir la propiedad indicando motivo. La
definición, contratos, resultados de validación y estado operativo están en
[Compras](shopping-lists.md).
