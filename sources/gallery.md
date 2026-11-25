# Galería cálida y enlaces temporales

La Galería organiza dibujos familiares en colecciones privadas. La interfaz usa superficies claras, fondo cálido y dibujos completos sin recortar. Las tarjetas de colección muestran hasta tres portadas. Las vistas familiares y públicas comparten grilla y visor; sus controles de acceso permanecen separados.

Cada integrante activo puede compartir toda la Galería. Compartir o revocar un enlace de colección requiere ser su propietario o administrador. Por eso, los permisos de colección protegen su gestión y presentación, pero no ocultan sus dibujos frente a un enlace de Galería completa. Una selección se fija al crear el enlace: los dibujos agregados después no se incorporan.

Los enlaces nuevos son reutilizables e independientes, duran 1 hora, 24 horas o 7 días y usan 24 horas por defecto. Cada uno incluye hasta 200 dibujos (máximo 20 enlaces activos por familia). Si una selección supera el límite, se rechaza completa y no se trunca. El contenido público pagina 24 dibujos y conserva el orden capturado al crear el enlace.

La credencial aleatoria de 256 bits aparece solo en el fragmento de la URL; la base guarda su hash SHA-256. El canje la cambia por una sesión en cookie `HttpOnly`, `Secure` en HTTPS, `SameSite=Lax`, `Path=/` y prefijo `__Host-` en HTTPS. Se eligió `Lax` porque tolera mejor la apertura del enlace desde otros contextos de navegación y sigue restringiendo el envío en solicitudes entre sitios que no sean navegación de nivel superior. Después del canje se limpia el fragmento de la barra de direcciones. Páginas, APIs e imágenes públicas usan `private, no-store` y `no-referrer`.

El aviso visible dice: “Cualquiera con este enlace puede ver estos dibujos hasta que venza o se revoque”. No se garantiza impedir guardar, descargar por otros medios o capturar imágenes. Las respuestas de enlace inválido, vencido o revocado son indistinguibles. El servidor usa UTC y considera vencido el enlace cuando `ahora >= expiresAt`; Buenos Aires se usa solo para mostrar fechas. Sesiones se revalidan cada 30 segundos, al recuperar foco y antes de cargar una página o imagen. La red transitoria pausa y oculta el contenido, con reintentos a 2, 5 y 15 segundos. El sistema no puede retirar bytes que ya empezaron a transferirse.

## Permisos y ciclo de vida

Un integrante activo puede crear enlaces de Galería completa y revocar los de ese alcance aunque los haya creado otra persona. Colecciones e invitaciones anteriores requieren propietario o administrador. Desactivar a un integrante revoca sus enlaces y sesiones, además de los enlaces de sus colecciones; la reactivación no los restaura. Sus dibujos no se quitan de enlaces completos de otras personas.

Archivar un dibujo lo oculta en todos los accesos. Retirarlo de una colección solo quita esa relación. Ambas operaciones invalidan permanentemente su inclusión en los enlaces de colección existentes; restaurar o volver a agregar requiere un enlace nuevo. Retirar de colección no cambia enlaces de Galería completa. Archivar una colección revoca sus enlaces y sesiones. El borrado definitivo elimina inclusiones por claves foráneas; no se agrega una función de borrado definitivo.

Las invitaciones anteriores conservan sus reglas (24 horas para canje y siete días de sesión), se muestran como “invitación anterior” y se pueden revocar en la gestión. No se convierten ni extienden.

## Datos, auditoría y límites

Las tablas nuevas son `gallery_shares`, `gallery_share_drawings` y `gallery_share_sessions`, con claves compuestas que preservan la familia. No guardamos nombre de visitante, IP cruda, agente del navegador ni historial de imágenes. Los eventos mínimos de creación y revocación se escriben en `audit_events` junto con la acción, sin tokens, cookies, URLs secretas ni hashes en auditoría o logs. La auditoría se conserva 90 días; sesiones vencidas o revocadas y enlaces terminales con sus inclusiones se purgan después de 30 días.

El canje limita a 10 intentos por IP cada 10 minutos y 5 por token por minuto, con claves derivadas. Las lecturas públicas limitan a 360 solicitudes por IP y sesión por minuto, 300 globales por minuto y un intervalo global de 200 ms. El límite de sesión/IP se ajustó para permitir una visita con 200 miniaturas, paginación y algunas ampliaciones; las miniaturas cargan de forma perezosa. Se debe mantener una prueba de carga que confirme que el recorrido normal no recibe 429 y que sí se aplican los límites de abuso.

## Imágenes y recuperación

Sketchbook o Drive conservan originales. Blob guarda derivados privados; un dump de PostgreSQL conserva referencias, no los bytes de las imágenes. Esta entrega acepta el riesgo de no tener respaldo independiente de Blob. Verificar los derivados disponibles antes de publicar y dar seguimiento al trabajo futuro de copia y recuperación independiente en la [issue #105](https://github.com/RadikeCosa/family-utils/issues/105).

El respaldo PostgreSQL incluye las cinco tablas de Galería existentes, las tres tablas nuevas y `audit_events` para conservar sus eventos correspondientes. El rol de respaldo recibe lectura de estas tablas mediante migraciones. El procedimiento de restauración empieza con la Galería apagada y sin exposición pública, invalida credenciales antiguas y nuevas y comprueba el saneamiento antes de habilitarla. Un dump anterior a una revocación no contiene esa revocación; una restauración arbitraria fuera del procedimiento no garantiza impedir la reactivación.

La tarea diaria de reconciliación requiere `CRON_SECRET`: mantiene la limpieza de cargas e invitaciones anteriores y purga sesiones/enlaces temporales, sin registrar credenciales. `GALLERY_ENABLED` debe ser exactamente `true`; apagada, las rutas familiares y públicas de Galería responden `404` sin contenido ni almacenamiento en caché. Apagarla no pausa vencimientos ni revoca enlaces. `GALLERY_SHARES_ENABLED` es una puerta adicional de publicación para los enlaces nuevos, apagada por defecto; permite integrar el código en producción sin exponer la función antes del PR 5, mientras la Galería existente sigue activa.

Las migraciones 0069/0070 forman la base ya desplegada; la 0071 agrega los enlaces y los permisos de lectura del rol de respaldo. Cada PR aplica sus migraciones aditivas en producción antes de integrarse a `main`, cuyo merge despliega automáticamente. La publicación final mantiene activación controlada, humo productivo solo con una colección ficticia `PRUEBA`, vencimiento real de una hora y limpieza posterior. No se usa una galería completa real en producción para el humo.

El cierre operativo sigue el procedimiento de [publicación](deployment.md#publicacion-de-galeria-con-enlaces-temporales): respaldo PostgreSQL y snapshot/rama de Neon verificables, ensayo con datos sintéticos, activación posterior al despliegue, revocación y expiración comprobadas desde otro navegador, y limpieza de datos de prueba. El smoke de Galería completa permanece limitado a Preview; hacerlo en producción exigiría decisión explícita y advertir que expondría dibujos familiares reales. El riesgo de que Blob no tenga respaldo independiente queda aceptado para esta entrega y tiene seguimiento en la issue #105.
