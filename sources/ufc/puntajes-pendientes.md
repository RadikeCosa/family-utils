# Puntajes UFC 5/3/1 · integración

La integración de `codex/ufc-puntajes` conserva el cierre único publicado y las
mejoras actuales de River, Champions y la interfaz de Deportes.

## Regla y vigencia

Las carteleras con `event_date` desde el 17/10/2026 suman 5 puntos por ganador
acertado de la estelar, 3 por coestelar y 1 por las demás. Las anteriores mantienen
1 punto. La versión queda guardada: cambiar la fecha después no cambia la regla.

La base identifica la estelar marcada y la primera pelea no estelar del bloque
principal por `bout_order`. Los puestos retirados se reservan; un reemplazo activo
con el mismo puesto tiene preferencia antes del cierre. No se promueven preliminares.
Al vencer el cierre se fijan ambas identidades antes de cualquier cambio de composición.
Las altas posteriores al cierre no son elegibles. Retiro, cancelación, empate y
`no_contest` suman cero, sin transferir puntos extra a otra pelea.

Pronósticos, vistas previas de resultados y dashboard comparten la ponderación.
El dashboard ordena y empata por puntos; aciertos y efectividad siguen siendo
estadísticas separadas. La simulación financiera conserva sus reglas anteriores.
El acumulado suma los puntos de cada cartelera según su versión.

## Migración y publicación

`0052_ufc_scoring.sql` añade tres columnas en eventos, inicializa versión y roles
y establece su gestión por triggers. Se añade después de las migraciones publicadas,
con un timestamp posterior y un snapshot del esquema completo integrado. No cambia
los SQL ni los hashes previos. La prueba PostgreSQL comprueba la conservación de
votos, resultados y reglas históricas, la inmutabilidad y la repetición segura.

Antes de publicar:

1. Exigir CI aprobado para el commit final y ensayar sobre una copia reciente de producción.
2. Comprobar las identidades reales de estelar/coestelar del 17/10 (Buckley y
   Blanchfield según el registro original). Si difieren, resolver antes de publicar.
3. Guardar respaldo recuperable y evidencia de datos, puntos y posiciones fuera de Git.
4. Aplicar y verificar la migración antes de fusionar a `main`, cuyo despliegue es automático.
5. Verificar el commit desplegado, ambos rankings, el acumulado, privacidad y River/Champions.

La migración de carteleras ya cerradas toma los roles de su composición registrada;
no existe historial previo que permita reconstruir otra composición.

Ante un fallo de aplicación, recuperar el despliegue anterior conservando columnas,
votos, resultados y cierres. La versión anterior mostrará temporalmente 1 punto por
acierto hasta reponer la aplicación corregida. No deshacer los cierres ni las columnas.

La evidencia privada y el registro final de publicación se mantienen fuera del repositorio.
