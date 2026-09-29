# Plan de implementación

## 1. Repositorios y acceso

- Revisar autenticación de GitHub antes de cualquier acción remota.
- Anonimizar toda la documentación y revisar exclusiones y secretos.
- Inicializar el repositorio local, crear `RadikeCosa/family-utils` público,
  enlazarlo y activar secret scanning y push protection antes del primer push.
- Crear `RadikeCosa/family-utils-backups` privado cuando se prepare el
  respaldo.

## 2. Next.js y CI

- Preparar Next.js App Router, React, TypeScript, CSS Modules y npm.
- Usar Node 24.13.1 en local/CI (`.nvmrc`) y `24.x` en Vercel.
- Configurar lint, tipos, build y PostgreSQL 18 en un servicio temporal de
  GitHub Actions.

## 3. Servicios y conexiones

- Configurar Vercel y Neon solo dentro de cuotas gratuitas.
- Usar Drizzle con `pg` sobre la conexión agrupada para la app Node.
- Mantener migraciones y dumps sobre conexión directa; no depender del estado
  de sesión ni de prepared statements con nombre en el pooler.
- Configurar Google OAuth con scopes básicos y Better Auth autogestionado.
- Añadir logs estructurados sin texto de tareas, nombres, códigos ni secretos.
- El vínculo automático del perfil adulto queda detrás de `GOOGLE_AUTO_LINK_ENABLED=false`;
  para activar la transición tras desplegar, cambiarlo a `true` en Production y
  hacer un nuevo deployment. Los códigos adultos existentes siguen funcionando
  mientras la bandera permanece apagada.

## 4. Plataforma y prueba temprana de acceso

- Abrir primero la plataforma; separar `/`, `/tareas`, `/familia` y `/acceso`.
- Mantener una identidad Google verificada por perfil adulto y una identidad
  anónima por dispositivo joven; exigir instalación antes de comenzar OAuth en
  iPhone.
- Usar invitaciones de 24 horas y recuperación joven de 30 minutos, códigos
  Crockford con HMAC y rate limits persistentes; `prepare` no recibe códigos.
- Probar callback OAuth desde la PWA instalada en un iPhone real y Android
  antes de aceptar el vínculo adulto.

## 5. Respaldo y restauración

- Automatizar dump diario cifrado a un artefacto privado de GitHub, con
  retención de 30 días y ejecución manual.
- Usar rol de solo lectura, conexión directa y `pg_dump` mayor 18.
- Probar restauración aislada e invalidar sesiones restauradas antes del
  piloto adulto.

El respaldo manual de producción se ejecutó y restauró correctamente en un
PostgreSQL 18 aislado el 2026-09-29. El artefacto cifrado queda en el repositorio
privado de respaldos por 30 días. La clave privada debe conservarse además en
un gestor de contraseñas o en una copia física protegida.

### Reversión de la migración de producción

Las migraciones de acceso son aditivas. Si el despliegue nuevo falla, volver a
la versión anterior de la aplicación y dejar las columnas, el tipo y el índice
añadidos en la base; la versión anterior los ignora. No restaurar un dump
completo como primera medida, porque descartaría cambios posteriores al
respaldo. Corregir y volver a aplicar la migración hacia delante; restaurar la
copia completa solo ante corrupción confirmada y con una decisión explícita.

## 6. Tareas y piloto adulto

- Implementar tareas puntuales, responsables, asumir, completar, deshacer,
  auditoría y control de versión.
- Guardar estado, auditoría y revisión familiar en una transacción.
- Probar concurrencia contra el pooler real de Neon antes del piloto.
- Desplegar para uso de los dos adultos y medir siete días de cómputo, tráfico,
  consultas, arranque en frío y costo proyectado.

## 7. Rutinas y ocasiones

- Implementar repetición diaria o por días elegidos, vencimiento al cierre del
  día o pendiente conservado, edición actual/futura, finalización y archivo.
- Garantizar generación idempotente y una sola ocasión abierta por
  responsabilidad en el modo pendiente.

## 8. Presencia y autonomía

- Añadir calendarios semanales, períodos temporales, excepciones,
  America/Argentina/Buenos_Aires y reglas de solapamiento.
- Implementar Mi semana y completadas recientes antes de incorporar a los
  integrantes sin correo.
- Permitir que todos organicen tareas y presencia según los permisos.

## 9. Archivo e historial

- Incorporar historial paginado, filtros, atribución de cambios, reversión
  administrativa y archivo/restauración de tareas y perfiles.
- Mantener pendientes de perfiles archivados visibles para reasignación
  manual; no crear ocasiones retroactivas al restaurar.

## 10. PWA completa

- Completar manifest, iconos, instrucciones de instalación, actualizaciones y
  experiencia en pantallas pequeñas.
- Verificar instalación y sesiones en Android y iPhone.

## 11. Consulta sin conexión

- Implementar lectura de datos ya cargados, aviso de antigüedad, aislamiento
  por usuario y limpieza al salir.
- Si una validación segura no se completa en dos jornadas de desarrollo,
  posponerla y continuar con el uso conectado.

## 12. Validación y operación

- Cerrar privacidad, permisos, calendario, concurrencia, recuperación,
  restauración y experiencia familiar.
- Documentar instalación, mantenimiento, recuperación, cuotas gratuitas y
  monitoreo de respaldos atrasados.

## Reglas de aceptación

- Solo el nombre de tarea es obligatorio; responsable, fecha, horario y
  repetición son opcionales. Las tareas sin responsable se pueden asumir.
- Con varios responsables, basta que uno esté presente. Un pendiente anterior
  a una ausencia permanece familiar y vuelve a la vista personal al regresar.
- Finalizar conserva pendientes y detiene futuras ocasiones. Archivar oculta
  también pendientes activos. Restaurar no genera incumplimientos retroactivos.
- Los días e intervalos nocturnos usan la zona horaria familiar, no la del
  dispositivo.
- Los integrantes consultan completadas recientes antes de recibir acceso.
- La consulta offline puede posponerse según el límite del paso 11.
- Si algún servicio requiere plan pago o consumo pago, se detiene esa
  provisión hasta elegir una alternativa gratuita.

## Planificador de menús

- La primera versión permite sugerencias familiares para almuerzo y cena,
  asistencia manual y confirmación adulta con control de concurrencia.
- Validar migraciones en una rama aislada de Neon antes de producción; usar la
  conexión directa para migraciones.
- Pilotear autenticación y flujos familiares en producción solo tras revisar el
  destino de despliegue, la migración y la sesión OAuth.
- Posponer la lectura automática desde calendarios de presencia a una etapa
  posterior.
