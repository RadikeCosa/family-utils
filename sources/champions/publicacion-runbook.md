# Runbook de publicación: Champions 2026/27

Usar este procedimiento una sola vez y en este orden. El cambio de datos y el código llegan primero con Champions apagado; la habilitación familiar se hace al final. Si una comprobación falla o no termina antes del corte duro del **19/10/2026 18:00 Argentina**, parar y posponer el estreno a Jornada 4. No reducir pruebas.

## 1. Respaldo y ensayo aislado

1. **manual, pendiente:** En [Actions del repositorio privado de respaldos](https://github.com/RadikeCosa/family-utils-backups/actions), ejecutar el flujo de respaldo de producción ahora. Descargar el artefacto a almacenamiento privado con acceso restringido. Comprobar que el job terminó correctamente, que `pg_restore --list <respaldo>` lista el esquema y que el tamaño no es cero. Restaurarlo en una base desechable aislada, nunca sobre producción.
2. **manual, pendiente:** Comprobar la restauración con las consultas de conteo de eventos, peleas, comentarios, formaciones y elecciones que usa el procedimiento de respaldo. Guardar sus salidas junto al respaldo; no copiar esos datos a este repositorio.
3. **manual, pendiente:** En la rama/base de ensayo aislada, desplegar el commit final con `SPORTS_ENABLED=true`, `SPORTS_AGENDA_ENABLED=true`, `SPORTS_RIVER_RESULTS_ENABLED=true`, `SPORTS_UFC_PREDICTIONS_ENABLED=true` y `SPORTS_CHAMPIONS_ENABLED=false`. Usar credenciales de esa base aislada.
4. **manual, pendiente:** Aplicar y verificar las migraciones de ensayo desde la terminal, después de comprobar visualmente el host de la URL de conexión:
   ```sh
   DATABASE_URL_UNPOOLED="$CHAMPIONS_REHEARSAL_DATABASE_URL" npm run db:migrate
   DATABASE_URL_UNPOOLED="$CHAMPIONS_REHEARSAL_DATABASE_URL" npm run db:verify
   ```
   Comprobar 38 migraciones aplicadas con hashes correctos, bandera familiar apagada por defecto, regresiones River/UFC y suite completa verde. Repetir el ensayo de importación de Jornada 3 con token en esa base, comprobar 18 partidos/36 equipos/horarios, segunda confirmación idempotente y privacidad con dos integrantes y administrador. No usar credenciales de producción en este paso.
5. **manual, pendiente:** Revertir el despliegue/branch de ensayo y destruir su base temporal solo después de guardar el resultado de las pruebas. El respaldo restaurado de producción queda conservado.

## 2. Migrar producción manteniendo Champions apagado

6. **manual, pendiente:** Antes de actuar, confirmar el proyecto Neon `green-meadow-92440811`, rama `production` (`br-lucky-bird-b5jop51y`), base destino y respaldo que se restauró correctamente. Si alguno no coincide, parar.
7. **manual, pendiente:** Con el respaldo recién generado y su restauración ya comprobada, aplicar únicamente migraciones aditivas mediante conexión directa. En una terminal con la cadena de conexión directa de producción ya cargada de forma segura:
   ```sh
   DATABASE_URL_UNPOOLED="$PRODUCTION_DATABASE_URL" npm run db:migrate
   DATABASE_URL_UNPOOLED="$PRODUCTION_DATABASE_URL" npm run db:verify
   ```
   No pegar ni imprimir la cadena. Comprobar 38 migraciones y hashes exactos, incluidas `0033_sports_champions_switch`, `0034_champions_suspended_resolution` y `0035_champions_result_corrections`; comprobar que las filas nuevas están apagadas por defecto y que los datos existentes no cambiaron. Si falla cualquier paso, detener la publicación y seguir la reversión de abajo; no borrar tablas ni revertir migraciones.
   Inmediatamente después, ejecutar el chequeo de permisos de solo lectura contra la misma conexión directa:
   ```sh
   psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f sources/champions/permisos-check.sql
   ```
   Revisar todas las filas: `public_can_execute`, `anon_can_execute` y `authenticated_can_execute` deben ser `false`. El script termina con excepción si encuentra una función ejecutable por alguno de esos roles; no continuar hasta corregirlo y repetir la consulta.
   Si el chequeo falla, revisar la firma completa de cada fila y ejecutar manualmente el `REVOKE` exacto, sustituyendo la firma copiada del resultado:
   ```sql
   REVOKE ALL PRIVILEGES ON FUNCTION public.nombre(argumentos_exactos) FROM PUBLIC, anon, authenticated;
   ```
   Repetir el chequeo hasta que no haya filas con permisos efectivos. No aplicar un revoke en lote a funciones ajenas al deporte sin verificar que ningún consumidor legítimo dependa de ellas.
   La migración 0030 aplica `ALTER DEFAULT PRIVILEGES` solo al propietario que la ejecuta. Si el propietario de migraciones de producción difiere del local, identificarlo con `SELECT current_user;` en la misma sesión migradora y ejecutar como ese rol (o como superusuario autorizado):
   ```sql
   ALTER DEFAULT PRIVILEGES FOR ROLE "PRODUCTION_MIGRATION_OWNER" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
   ALTER DEFAULT PRIVILEGES FOR ROLE "PRODUCTION_MIGRATION_OWNER" IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
   ALTER DEFAULT PRIVILEGES FOR ROLE "PRODUCTION_MIGRATION_OWNER" IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
   ```
   Volver a correr `permisos-check.sql` y revisar las ACL de tablas Champions. La migración 0036 revoca ACL actuales de funciones/tablas deportivas, pero los defaults futuros deben quedar también establecidos para el rol propietario de producción.
8. **manual, pendiente:** Mantener apagada la variable `SPORTS_CHAMPIONS_ENABLED` en la configuración de producción. No crear ni habilitar aún registros familiares.

## 3. Desplegar el código apagado

9. **manual, pendiente:** En Vercel, crear un despliegue Preview protegido del commit revisado, con el entorno de producción y las cinco banderas de Deportes anteriores activas salvo `SPORTS_CHAMPIONS_ENABLED=false`. En Project Settings → Deployment Protection, activar protección para todos los Preview Deployments con Vercel Authentication o contraseña individual compartida solo por canal seguro; limitar acceso a las personas que ejecutan la operación y exigir inicio de sesión. La URL no cuenta como protección. No habilitar acceso público, dominios alias sin protección ni excepciones para crawlers. No promoverlo al dominio de producción todavía.
   Confirmar antes de probar qué `DATABASE_URL` tiene ese Preview: por diseño este paso usa la base de producción ya migrada, así que las acciones administrativas sí escriben allí. Mientras el interruptor de Champions esté apagado, la prueba de humo solo lee Deportes/River/UFC, consulta estado del interruptor y comprueba 404; no debe crear ni editar datos Champions. Si se cambia la conexión para una comprobación de UI, usar una restauración aislada, nunca una URL productiva no identificada.
10. **manual, pendiente:** Abrir el Preview protegido y ejecutar las pruebas de humo: acceso a Deportes, River y UFC; rutas Champions responden 404; interruptor administrativo muestra apagado; no hay escrituras de Champions. Confirmar que las rutas genéricas no exponen el evento. Revisar logs de aplicación por errores y verificar con los conteos previos/posteriores que las tablas deportivas no cambiaron. Si hay error, dejar ese Preview sin promover.

## 4. Importar y verificar en el Preview protegido

11. **manual, pendiente:** Abrir Deportes en ese Preview como administrador de la familia objetivo y volver a validar la agenda con el archivo de Jornada 3 revalidado esa mañana. La hora de `checkedAt` debe ser la hora real de revalidación. La vista previa no escribe. Ver todos los errores; continuar solo con HTTP 200, 18 partidos, 36 equipos y 0 errores.
12. **manual, pendiente:** Confirmar la importación desde el Preview. **Esto escribe en producción** y queda restringido a la familia objetivo: inserta/actualiza las 36 identidades de equipo, 18 eventos y sus temporadas/jornada/referencias UEFA; también registra la auditoría de la importación. No confirma resultados ni crea pronósticos. Verificar 18 partidos, 36 equipos, horarios argentinos de 13:45/16:00 y correspondencia de los 18 IDs y pares UEFA. Repetir la confirmación del mismo archivo y comprobar que devuelve `changed:false` sin cambios en filas de dominio/auditoría.
   La comprobación de privacidad de dos elecciones ya se ejecutó en la base aislada y está registrada en `2026-27-jornada-3-ensayo.json`; en producción no guardes pronósticos de prueba ni uses elecciones de integrantes reales como fixture. Así, los únicos datos deportivos nuevos de este paso son la agenda importada y su auditoría, sin resultados, pronósticos ni comentarios de prueba. El cambio posterior del interruptor sí escribe su estado y auditoría.
13. **manual, pendiente:** Si hay una discrepancia, no habilitar la bandera. Corregir el archivo, hacer una vista previa nueva y repetir esta sección; no editar identificadores a mano ni emitir tokens fuera de la vista previa.

## 5. Desplegar habilitado y retirar acceso temporal

14. **manual, pendiente:** Preparar el siguiente despliegue de producción desde el mismo commit probado, ahora con `SPORTS_CHAMPIONS_ENABLED=true`. Mantener todas las dependencias activas. Antes de promover, verificar que la migración está aplicada y la importación familiar verificada.
15. **manual, pendiente:** Promover ese despliegue al dominio de producción. Como el switch de la familia sigue apagado, primero comprobar que Deportes conserva River/UFC, Champions sigue oculto y el endpoint de administración del switch está disponible.
16. **manual, pendiente:** Retirar la protección y credenciales temporales del Preview solo después de verificar el dominio público. En Vercel, borrar el Preview temporal y revocar la contraseña/usuarios temporales o quitar su allowlist; retirar variables secretas exclusivas de ese Preview y eliminar credenciales de prueba. Comprobar en Vercel que no queda el Preview activo ni un dominio alias asociado, que Deployment Protection sigue activa para Preview y que los usuarios temporales ya no están autorizados. En una ventana privada, abrir la URL anterior: debe responder con el control de acceso (401/403 o redirección de autenticación), no mostrar la app. Comprobar además que el dominio público no depende de la URL protegida y que no quedan secretos temporales en la configuración de producción.
17. **manual, pendiente:** En el dominio público, iniciar sesión como administrador de la familia objetivo y hacer `PUT /api/sports/champions/switch` con `{"enabled":true}` (la pantalla administrativa «Champions: apagado» realiza la misma acción). Comprobar que responde `{"enabled":true,"effective":true}`, y que la pestaña muestra la Jornada 3, los 18 horarios y el hilo. Revisar una segunda vez privacidad, pronósticos y navegación. No activar familias que no deban participar.

## 6. Comprobar el apagado operativo

18. **manual, pendiente:** En la misma familia, pulsar «Champions: encendido» o llamar al mismo endpoint con `{"enabled":false}`. La respuesta no debe llegar hasta que terminen las escrituras Champions ya autorizadas. Comprobar `effective:false`, que todas las rutas Champions y sus accesos desde endpoints genéricos responden 404 o devuelven colección vacía, y que River/UFC siguen accesibles. Comprobar que eventos, equipos, pronósticos y comentarios Champions siguen almacenados. Volver a encender solo después de terminar esta comprobación.
19. **manual, pendiente:** Registrar hora, despliegue, resultado de importación, verificación de privacidad y prueba de apagado. Si no queda tiempo para completar estos pasos antes del corte, apagar Champions y anunciar internamente que el estreno será en Jornada 4.

## Reversión

- **manual, pendiente — antes de promover:** cancelar el Preview fallido y corregirlo sin tocar la publicación actual.
- **manual, pendiente — después de promover, antes de abrir:** dejar `SPORTS_CHAMPIONS_ENABLED=false` y confirmar el despliegue apagado.
- **manual, pendiente — después de abrir o ante incidente:** el administrador apaga inmediatamente el switch familiar por la pantalla o `PUT /api/sports/champions/switch` con `{"enabled":false}`. Verificar `effective:false` y River/UFC activos. Si la ruta no responde, desactivar `SPORTS_CHAMPIONS_ENABLED` en Vercel y desplegar esa configuración; comprobar el 404 en el dominio público.
- **manual, pendiente:** no revertir ni borrar migraciones, marcadores, pronósticos, comentarios o identidades para apagar la funcionalidad. Restaurar el respaldo solo ante una pérdida de datos confirmada, con evaluación del alcance; primero ensayar la restauración en otra base aislada.
