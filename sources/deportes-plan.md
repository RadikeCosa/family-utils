# Deportes: decisiones de implementación

La v1a funciona con carga manual y comentarios familiares. No requiere claves deportivas ni hace llamadas externas. Se implementa sobre Next.js, Better Auth, Drizzle y PostgreSQL en Neon; el servidor limita cada consulta a la familia autenticada.

## v1a

- Fútbol: agenda de HOY, River destacado y filtro «Solo River». Partidos manuales con competencia, rival, fecha/hora, canal y resultado opcionales.
- UFC: una cartelera vigente, con peleas, estelar y horarios de preliminares y principal; carga y edición manual en bloque.
- Conversaciones de texto: resultados del día, partido de River asociado a ese día y evento UFC. El autor edita o borra lo suyo; un administrador puede retirar cualquier comentario familiar.
- Si un partido de River cambia de fecha, la nueva ficha enlaza la conversación del día original; la conversación conserva su fecha.
- Eventos incluyen desde el inicio `manually_edited`, referencia externa opcional, estado de cartelera y `prediction_close_mode = null`.
- `SPORTS_ENABLED` permanece apagado por defecto. No incluye sincronización, pronósticos ni ranking.

## Paso 0: prueba de cobertura posterior a v1a

Se ejecuta tras entregar v1a y no bloquea su uso. Revisar API-Football, football-data.org, API-Sports MMA y TheSportsDB para temporadas vigentes, próximos eventos, límites, atribución, almacenamiento y términos aplicables. No se configuraron credenciales durante la planificación: disponibilidad de datos autenticados queda **no comprobada**.

| Fuente | Lo comprobado por documentación | Lo que queda no comprobado |
|---|---|---|
| API-Football | Plan gratuito: 100 consultas/día; el acceso gratuito limita temporadas. La lista pública menciona Liga Profesional argentina, Libertadores, Sudamericana y Champions. | Fixtures gratuitos de temporada vigente de River y de cada copa, y uso/retención aplicable a la app. |
| football-data.org | Champions aparece en cobertura gratuita; fixtures y resultados pueden ser demorados. Requiere atribución visible. | Fixtures gratuitos 2026/27 disponibles y utilidad de actualización para esta app. River y copas sudamericanas no aparecen en la cobertura gratuita revisada. |
| API-Sports MMA | Documentación de endpoints de peleas y cuota gratuita anunciada de 100 consultas diarias por API. | Próxima cartelera UFC, horarios por bloque, cobertura futura gratuita y permisos pertinentes a este uso. |
| TheSportsDB | API JSON gratuita con límites por endpoint; próximos eventos gratuitos por equipo se limitan a partidos como local. Sus términos públicos admiten modificación del contenido de sus endpoints, pero exigen suscripción paga para publicar en tiendas. | Cobertura vigente completa, carteleras UFC y compatibilidad de licencia con el despliegue concreto. |

Una fuente pasa a v1b solo después de una consulta real y cotejo con un calendario oficial. Sin cobertura gratuita adecuada, la carga manual sigue siendo el producto.

## v1b: automatización opcional

Solo se incorpora una categoría que apruebe el paso 0. Sin cron: los datos automáticos se actualizan cuando un integrante abre Deportes o pulsa «Actualizar». La interfaz siempre indica «Última actualización hace X». No se prometen datos al minuto. Un evento editado manualmente no se sobrescribe hasta que un administrador libere ese bloqueo.

## v1c: pronósticos opcionales

`prediction_close_mode` queda en `null` y los pronósticos apagados hasta que se elija una regla. Recomendación pendiente: cierre por bloque. Si falta el horario de un bloque, solo se deshabilitan pronósticos de ese bloque; el otro permanece habilitado si tiene horario válido.

## Decisiones y supuestos

- Argentina usa `America/Argentina/Buenos_Aires`, UTC−3, sin horario de verano. Los instantes se guardan en UTC y se presentan con esa zona IANA; una hora ausente se muestra «A confirmar».
- Supuesto del usuario para futuro UFC: al publicar una cartelera siguiente, la anterior pasa a finalizada y conserva peleas, resultados y, en v1c, pronósticos. No hay pantalla de historial en v1. El supuesto es reversible sin borrar esos datos.
- Fuera de v1: pantalla de historial UFC, bloque separado de preliminares tempranas, eventos sin fecha en agenda y amistosos como caso especial. Si River se posterga, el hilo conserva la fecha original y la ficha reprogramada enlaza a esa conversación.
