# Puntajes UFC: implementación aislada, pendiente de integración y publicación

La rama `codex/ufc-puntajes` contiene el cierre publicado y la implementación de
5/3/1. No se aplicaron migraciones ni cambios de aplicación en producción.
La publicación se hará después de Champions, integrando sobre su versión final.

## Comportamiento

- Carteleras con fecha del 17/10/2026 en adelante: 5 puntos totales por ganador
  acertado de la estelar, 3 por coestelar y 1 por las demás. Las anteriores
  conservan 1 punto por ganador, incluso al cargar o corregir sus resultados.
- La fecha es el día civil `event_date` de la cartelera. La base guarda la versión
  al crear el evento o durante la migración; cambiar después la fecha no cambia
  la regla ni recalcula sus históricos con otra versión.
- La base guarda explícitamente las identidades de estelar y coestelar. Mientras
  está abierta, toma la estelar marcada y la primera pelea no estelar del bloque
  principal por `bout_order`; puede actualizar las identidades con la composición.
  Una pelea retirada reserva su lugar, con preferencia por su reemplazo activo
  en el mismo puesto antes del cierre. No se elige una preliminar como coestelar.
- Al vencer el cierre, se fijan las identidades ANTES de cambiar horarios o peleas.
  Después, reordenar, cambiar bloques o marcas, retirar o cancelar no transfiere
  bonos. Las altas tardías conservan `prode_eligible=false` y suman cero.
- Cancelación, retiro, empate y `no_contest` no dan puntos; resultados pendientes
  mantienen la tabla parcial. Preview, confirmación y ranking usan la misma regla.
- Se conserva el formato del JSON de resultados, los cierres comunes, la
  privacidad familiar y todos los votos/resultados existentes. Las etiquetas y
  textos muestran la regla correspondiente a cada cartelera, también en móvil.

## Migración nueva

`0038_ufc_scoring.sql` añade tres columnas nullable en eventos, rellena solo los
no inicializados y activa un trigger que impide escribir directamente la versión
u otras identidades. No reescribe `0037_ufc_card_closure` ni migraciones anteriores.
Su segunda ejecución conserva eventos, votos, resultados y puntos.

Para carteleras que ya cerraron antes de instalar esta regla, se toman las
identidades actuales de las peleas elegibles. No existe un historial previo que
permita reconstruir un orden distinto al registrado. Antes del despliegue,
verificar que Buckley y Blanchfield siguen siendo estelar y coestelar de la
cartelera del 17/10, y registrar las cantidades y totales afectados.

## Integración después de Champions

1. Partir de la versión finalmente publicada de Champions y conservar sus commits.
   La corrección `4d54860` ya separó el antiguo borrador de su rama activa.
2. Incorporar los cambios funcionales de UFC, preservando las fixtures de Champions
   en las pruebas comunes. No incorporar de nuevo el commit de reconstrucción de
   la base publicada `b2051b7` ni reemplazar archivos completos de Champions.
3. Añadir `0038_ufc_scoring` al FINAL de su registro de migraciones, con el timestamp
   de esta rama y el índice siguiente. Esta rama aislada tiene 29 entradas, mientras
   la combinación verificada tiene 39. No ejecutar su registro de 29 entradas
   directamente contra una producción que ya tenga Champions.
4. Reconciliar/regenerar el snapshot completo de Drizzle sobre el esquema integrado
   (incluyendo Champions y las tres columnas UFC); el snapshot de esta rama es de
   su esquema UFC aislado. Conservar los SQL y hashes de migraciones ya publicadas.
5. Repetir las pruebas integradas y ensayar sobre una rama de la base productiva,
   verificar cierre, roles actuales y conservación de votos/resultados, y publicar
   migración antes de la aplicación. Mantener las protecciones de cierre al recuperar.

Volver temporalmente a una aplicación anterior no borra la versión ni las
identidades congeladas, pero esa aplicación seguirá calculando 1 punto hasta
reponer la aplicación nueva. No deshacer columnas o cierres para recuperar.

## Validación realizada en datos sintéticos aislados

- Compilación de producción, TypeScript y lint correctos.
- Suite general: 105 pruebas aprobadas, incluida migración con votos y ganador
  SuYoung You conservados, corte del 16/17 de octubre, inmutabilidad, reloj real,
  reordenamiento posterior al cierre y repetición de la migración.
- Desktop Chromium: siete recorridos aprobados (seis en conjunto y el histórico
  repetido tras corregir su aserción de preview). Incluyen privacidad, pantalla
  abierta, carga parcial, 5/3/1, correcciones, empate, cancelación y etiquetas históricas.
- iPhone (Chromium): pasan los dos recorridos de puntajes y cartelera histórica.
- Ensayo de 39 migraciones combinadas: pasan las seis comprobaciones UFC y la
  regresión original de migración Champions, sin editar su prueba ni sus migraciones.
- Pruebas locales con credenciales ficticias y puertos exclusivos; ninguna base
  o credencial de producción utilizada. Pendientes integración y ensayo productivo.
