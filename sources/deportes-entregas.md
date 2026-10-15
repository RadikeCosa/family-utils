# Deportes: agenda, resultados y pronósticos

Implementación del 15 de octubre de 2026. Publicación autorizada por el usuario después de completar las comprobaciones. Las tres entregas están activas en producción; el registro operativo está al final de este documento. La carga sigue siendo curada desde el chat; no se habilitan consultas automáticas a proveedores. El endpoint legado de sincronización responde desactivado aunque existan ajustes anteriores habilitados.

## Activación por etapas

Las banderas se evalúan en el servidor y vienen apagadas en `.env.example`:

| Entrega | Bandera | Dependencia |
| --- | --- | --- |
| A: agenda y diseño | `SPORTS_AGENDA_ENABLED` | `SPORTS_ENABLED` |
| B: resultados River | `SPORTS_RIVER_RESULTS_ENABLED` | A |
| C: pronósticos y resultados UFC | `SPORTS_UFC_PREDICTIONS_ENABLED` | B |

Antes de desplegar este paquete, aplicar todas sus migraciones pendientes, hasta `0026_sports_fight_closure`, con conexión directa y respaldo previo. Son aditivas; la migración `0022_sports_fight_block_length` ya está incorporada en la rama principal. Con las tres banderas nuevas apagadas continúa la pantalla anterior. Activar A, B y C por separado únicamente después de autorización y revisión de cada entrega. Desactivar una bandera oculta y bloquea su funcionalidad nueva; no borra datos ni habilita al importador de agenda a reemplazar identidades o resultados protegidos.

## A: agenda y diseño

La URL usa `sport=river|ufc` y `event=<uuid>`, sin índices de posición. La lectura está aislada por familia. Se muestran próximos y anteriores, con conversación y formación del evento seleccionado, y borradores de composición conservados durante la navegación. Los eventos retirados de la fuente quedan en anteriores; los ocultos no se muestran.

La página conserva el fondo cálido, usa ficha grafito, acentos rojos y Manrope/DM Sans existentes. UFC agrupa los tres bloques; la estelar tiene tratamiento propio. Todos los horarios se expresan en Argentina y en formato de 24 horas. Lugar y tipo son informativos y no intervienen en el cálculo de horarios.

El JSON de agenda mantiene `schemaVersion: 1`. En UFC admite `venue`, `city`, `country` y `eventType` (`numerado`, `fight_night`, `otro`). Ausencia conserva lo guardado; `null` borra el dato salvo protección manual por campo. El importador anterior sigue siendo compatible.

“Administrar” aparece al final, cerrado por defecto y solo para administración. Contiene agenda, resultados cuando se habilita B, ocultamiento y marca de semana actual sin UFC. Cada importador ofrece ejemplo, copia y descarga. Los ejemplos ficticios se pueden validar, pero se rechaza su confirmación como carga real. Límite de interfaz: 900 KB; límite de solicitud: 1 MB. Los textos se muestran como texto plano.

## B y C: resultados curados

`POST /api/sports/results/import` admite `{mode:"preview",bundle}` y `{mode:"import",bundle,token}`. El formato de resultados es independiente del de agenda:

```json
{
  "version": 1,
  "checkedAt": "2026-10-15T12:00:00Z",
  "source": "Fuente verificada en el chat",
  "events": [
    {
      "eventId": "UUID del partido existente",
      "result": {"homeGoals": 2, "awayGoals": 1}
    },
    {
      "eventId": "UUID de la cartelera existente",
      "fights": [
        {
          "fightId": "UUID de la pelea existente",
          "result": {"outcome": "winner", "winnerId": "UUID estable del peleador"}
        }
      ]
    }
  ]
}
```

Este fragmento explica la estructura y usa marcadores de UUID; la plantilla descargable incluye los identificadores reales de la familia y nombres de referencia. No hay que inventarlos ni identificarlos por posición. `GET /api/sports/templates?kind=results` genera una plantilla con resultados `null`, hasta 20 eventos recientes. Para ejemplos completos usar `&example=true`; contienen datos ficticios y su importación se rechaza. El ejemplo y la plantilla de agenda se obtienen con `kind=agenda`.

En River, ambos goles son enteros no negativos. En UFC, `outcome` es `winner`, `draw`, `no_contest` o `cancelled`; `winnerId` solo se completa para `winner`. `result:null` significa pendiente y se ignora. La omisión no elimina registros. Una plantilla sin resultados efectivos no se confirma como importación exitosa.

La vista previa no escribe. Su token dura 15 minutos, está firmado, ligado al administrador, familia, archivo y estado de cada evento. La confirmación revalida con bloqueo por evento y transacción independiente; informa éxitos y errores por evento. Los estados que incorporan elecciones se resumen con HMAC para que tampoco puedan inferirse por enumeración. Corregir un resultado muestra antes/después y, en UFC, el cambio de puntos. Reimportar el mismo desenlace no duplica datos ni auditoría. No se crean eventos desde resultados.

## Pronósticos UFC

`GET|PUT|DELETE /api/sports/events/<uuid>/predictions` consulta la cartelera o modifica únicamente la elección del integrante autenticado. `PUT` recibe `fightId` y `winnerId`; `DELETE`, `fightId`. No acepta actuar por otro integrante.

Cada pelea y sus dos peleadores tienen identidad estable. Invertir el orden visual conserva la elección. Retirar o cambiar un rival conserva la pelea anterior como histórica y anula sus elecciones. No se reabre una elección por cambiar el bloque o el horario: hay cierres persistentes por bloque y por pelea. Una postergación después del cierre requiere un evento nuevo con otra referencia.

El servidor valida el cierre usando su reloj, incluida la escritura final. Sin hora confirmada no se pronostica ni se acepta un resultado deportivo; sí una cancelación. Las elecciones ajenas no se devuelven antes del cierre, ni a administradores. No se escriben elecciones en auditoría ni plantillas. La pantalla consulta el estado familiar cada 30 segundos para actualizar cierres; esto no consulta proveedores.

Cada ganador acertado suma un punto; empate, sin resultado válido y cancelación suman cero. La tabla usa puestos compartidos (1.º, 1.º, 3.º), sin desempates. Es parcial hasta resolver todas las peleas activas; retiradas y canceladas no mantienen la tabla pendiente. Corregir un ganador recalcula desde los registros, sin contadores acumulados. No hay cierre manual, pronósticos River, método, round ni clasificación acumulada.

La agenda no puede reemplazar peleas con resultado confirmado ni omitir una cartelera parcialmente resuelta dentro de su cobertura. Tampoco sobrescribe marcadores ni devuelve eventos finalizados a próximos; el conflicto requiere revisar el archivo.

## Verificación

Se verificaron las entregas en orden, antes de iniciar la siguiente:

- A: compilación, navegación entre eventos, borradores independientes, administración cerrada, ejemplos, contraste y desbordamiento móvil; regresión de permisos e importación existente.
- B: vista previa sin escrituras, autorización, desconocidos, duplicados, token obsoleto, correcciones, idempotencia y conservación del marcador ante una nueva agenda.
- C: privacidad incluso para administración, ganador estable al invertir nombres, falta de horario, cancelación anticipada, rival reemplazado, cierre persistente tras actualizar y mover bloques, resultados parciales/finales, corrección de puntos, confirmaciones simultáneas y accesibilidad.

Comandos: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:sports-next`. La suite nueva exige `FAMILY_UTILS_TEST_DATABASE_URL`; no se ejecuta sin una base aislada. Las pruebas de rutas existentes se ejecutaron también sobre PostgreSQL descartable.

Las migraciones se ensayaron en la rama Neon `sports-ux-rehearsal-2026-10-15`, creada desde producción, con respaldo previo y verificación de hashes. Expira el 17 de octubre de 2026 a las 09:00 de Argentina. Las pruebas funcionales usan familias ficticias y no modifican producción. Se generó un respaldo productivo actualizado y se comprobó su restauración en una base local separada: conserva los 6 eventos y las 35 peleas. La autorización de publicación incluye aplicar las migraciones y activar las tres entregas por etapas.


## Registro de publicación: 15 de octubre de 2026

- [PR de implementación #40](https://github.com/RadikeCosa/family-utils/pull/40), fusionado a las 04:19 de Argentina. Commit productivo: `fb0343d5d0ba92e184442304c330de5e44d91536`.
- [CI del PR](https://github.com/RadikeCosa/family-utils/actions/runs/38697273491): aprobado. También se comprobó la integración de la rama principal.
- Verificación local completa: tipos, lint y compilación; 90 pruebas de reglas/base, 58 de rutas, 111 recorridos generales, 12 de Deportes en Chromium móvil/escritorio y WebKit, y 3 de accesibilidad. Ninguna omitida en la ejecución final.
- Neon: proyecto `green-meadow-92440811`, rama `production` (`br-lucky-bird-b5jop51y`). Migraciones hasta `0026` aplicadas mediante conexión directa; verificados los 27 registros de migración y sus hashes.
- Respaldo previo: `sports-production-2026-10-15-before.dump`, local, fuera de Git y con permisos `0600`, 198631 bytes. SHA-256: `b5e8db720e2f2ba5d3e7e2afdf45809aa719e53cb16de69aff5b8b2f5d9f5935`. Se restauró correctamente en PostgreSQL 18 aislado. No contiene una copia de las nuevas tablas posteriores a la publicación.
- Antes y después de migrar y publicar: 6 eventos y 35 peleas, con los mismos identificadores; comentarios y formaciones conservados. Las comprobaciones productivas no crearon elecciones ni resultados ficticios. La vista previa de River se verificó sin confirmar escrituras.

Los despliegues se prepararon con configuración de producción sin mover el dominio, se verificaron y se promovieron en orden:

| Etapa | Despliegue comprobado | Configuración |
| --- | --- | --- |
| A | `dpl_ELvLXagWoFbYDtpPEJSB6HGK8bMS` | Agenda activa; resultados y UFC bloqueados |
| B | `dpl_J3mrXYCjzjRnGU4yx4VHQGYV7hGd` | Agenda y resultados River activos; UFC bloqueada |
| C | `dpl_HM2aeU7nM4B8tfkvtger8cfSXQk9` | Las tres entregas activas |

[Deportes en producción](https://family-utils-umber.vercel.app/deportes). Se recorrieron los tres partidos River y las tres carteleras UFC, incluidos los tres bloques de UFC 333, y se comprobaron cierres, tabla parcial y acceso restringido. `SPORTS_ENABLED`, `SPORTS_AGENDA_ENABLED`, `SPORTS_RIVER_RESULTS_ENABLED` y `SPORTS_UFC_PREDICTIONS_ENABLED` están en `true`; `SPORTS_AUTO_SYNC_ENABLED` permanece en `false`.

### Reversión operativa

Ante una incidencia, apagar primero la bandera de la funcionalidad afectada y preparar un nuevo despliegue de **este mismo código** con la configuración corregida. Para volver a la pantalla anterior, apagar A (sus dependencias B y C quedan bloqueadas); mantener la sincronización automática apagada. Los cambios de configuración requieren un nuevo despliegue para tener efecto. Verificarlo antes de promoverlo.

No revertir las migraciones ni eliminar tablas, elecciones o resultados como parte de una reversión visual. Los controles de identidad y resultados deben conservarse aunque las banderas estén apagadas. El respaldo se reserva para recuperación de datos, con revisión del alcance antes de restaurarlo sobre producción; la restauración ya ensayada fue únicamente en una base descartable.
