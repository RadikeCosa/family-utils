# Galería privada

La Galería permite que integrantes de la familia organicen dibujos en
colecciones privadas e inviten a otras personas con enlaces de un solo uso. Cada
colección mantiene la autoría de un único integrante. Los permisos se validan
en el servidor y los datos permanecen aislados por familia. Las invitaciones
pendientes vencen a las 24 horas; la sesión canjeada dura siete días. Revocar la
invitación o retirar la colección corta las lecturas siguientes.

Esta versión requiere conexión. Sketchbook o Drive conservan los originales;
la Galería guarda derivados y no es el respaldo exclusivo de los dibujos.

## Puerta A: medición de imágenes

La medición se ejecutó localmente con `sharp`, sin servidor ni telemetría,
sobre las 21 imágenes suministradas. Son PNG con transparencia, sin perfil ICC
embebido y con orientación normal. La herramienta usa IDs sintéticos en el
reporte y escribe derivados fuera del repositorio.

El formato elegido es WebP sin pérdida: visualización hasta 2048 px y miniatura
hasta 384 px, sin ampliar imágenes pequeñas. La proyección de 200 dibujos es de
aproximadamente 179 MiB para ambos derivados, dentro del presupuesto de 700
MiB. Todas las entradas medidas quedaron bajo 25 MiB y 40 megapíxeles.

## Privacidad y operación

Los nombres originales y hashes quedan en campos privados, nunca en respuestas
de invitados. Los objetos viven en Blob privado y las rutas usan identificadores
aleatorios. Cada handler verifica familia, autoría y sesión antes de responder.
Las lecturas familiares usan `private, no-cache` y ETag persistido; las de
invitados, `private, no-store`. Los blobs de visitantes solo se reutilizan en
memoria durante esa visita. La entrada limita el canje por IP y por clave. Las
lecturas se limitan a 120 por sesión/minuto y 300 por tienda/minuto, con un
intervalo global mínimo de 200 ms. La pantalla de invitación advierte que se
abra el enlace en el navegador habitual; crear un enlace nuevo pide confirmar y
cierra las sesiones anteriores. Los administradores ven el total y detalle de
invitaciones activas, y pueden revocarlas.

La tarea diaria de reconciliación requiere `CRON_SECRET`: elimina cargas
abandonadas y credenciales vencidas, y retira originales temporales que quedaron
tras procesar correctamente un dibujo.

La bandera `GALLERY_ENABLED` queda apagada por defecto y no reemplaza permisos
del servidor. El respaldo cifrado debe cubrir tablas, índices, restricciones,
nombres originales, hashes e invitaciones. Recuperación: apagar la bandera;
conservar las migraciones aditivas.
