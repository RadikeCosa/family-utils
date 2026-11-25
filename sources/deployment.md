# Preparar y autorizar una publicación

Esta guía describe cómo preparar una entrega. El preflight es de solo lectura;
no publica, migra ni activa funciones. La existencia de un commit, una vista
previa o un documento histórico no demuestra por sí sola el estado de producción.

## Verificación durante el desarrollo

El catálogo único está en `scripts/verification-catalog.json`. El selector
`scripts/verification-impact.mjs` resuelve suites, consumidores transitivos,
imports entre dominios y pruebas sin clasificar. Los imports estáticos y
reexports se analizan con TypeScript; un import dinámico no literal obliga a
ejecutar todo. Las dependencias entre dominios no declaradas y pruebas sin grupo
hacen fallar CI hasta corregir el catálogo.

En un PR el workflow siempre se ejecuta: selecciona suites dentro del workflow,
sin filtros `paths` que dejen el control requerido pendiente. Un cambio acotado
ejecuta grupos pertinentes. Los cambios compartidos, desconocidos o con alcance
incierto ejecutan todos. Cualquier cambio de interfaz añade accesibilidad e
interfaz unificada. El workflow compara el ancestro común con historial completo;
si no puede calcularlo, registra la alerta y selecciona todo. Los grupos se
ejecutan secuencialmente y publican alcance, SHA, resultados y duración en el
resumen y el artefacto JSON de CI.

En local, `bash scripts/verificar-todo.sh` selecciona por impacto por defecto.
Usar `--full` para ejecutar todos los grupos. Se comparan cambios confirmados,
modificaciones locales y archivos nuevos con `origin/main`. Si esa referencia
no está disponible o el cambio no se puede clasificar, el selector informa la
causa y elige la suite completa. La URL de pruebas debe seguir siendo local y
terminar exactamente en `champions_test`.

Los primeros **20 PR integrados** forman la ventana inicial de observación.
Registrar en el PR el SHA/ejecución de suites seleccionadas y el resultado de la
suite completa en `main`. Si una falla en `main`, es reproducible, atribuible al
cambio y su prueba no se ejecutó en el PR, suspender inmediatamente la selección
por impacto. Volver a suite completa en PR hasta corregir el catálogo o selector
y agregar una regresión. Aplicar el mismo criterio después de la ventana.

## Evidencia previa a producción

Antes de pedir autorización, el candidato debe incluir el `main` vigente y tener
una suite completa aprobada exactamente para su SHA. Ejecutar el modo manual de
CI sobre esa referencia y conservar enlace, SHA y alcance completo. Si cambia el
candidato o `main`, repetir la suite completa. Si el merge actualiza código que
Vercel publica automáticamente, pedir autorización antes del merge. La suite
completa de `main` es un segundo control y no reemplaza la evidencia previa.

Preparar un archivo privado de evidencia, fuera de Git y sin credenciales:

```json
{
  "deployment": {
    "id": "deployment-id",
    "url": "https://deployment.example.vercel.app",
    "state": "READY",
    "target": "production",
    "commitSha": "<sha actualmente desplegado>",
    "verifiedAt": "2026-11-15T12:00:00.000Z"
  },
  "fullSuite": {
    "status": "success",
    "complete": true,
    "commitSha": "<sha candidato>",
    "mainSha": "<sha main vigente cuando se ejecutó la suite>",
    "runUrl": "https://github.com/example/repo/actions/runs/123"
  },
  "data": {
    "backupRestoreVerified": true,
    "rehearsal": {
      "isolated": true,
      "syntheticFixtures": true,
      "existingRows": true,
      "relations": true,
      "constraints": true,
      "edgeCases": true,
      "historicalCases": true,
      "invariantsPassed": true
    },
    "compatibility": { "previousCodeWorks": true },
    "transition": {
      "steps": ["migración", "despliegue compatible", "activación"],
      "irreversibleStep": "describir paso y punto de parada",
      "recoveryCompatibleSha": "<40 caracteres hexadecimales>"
    }
  }
}
```

Incluir `data` solo si corresponde. `schema` exige además acreditar que el código
anterior funciona con el esquema expandido. `transition` requiere el orden real,
el punto irreversible y el SHA de recuperación compatible. Los datos de ensayo
son ficticios: una base aislada vacía no prueba conservación. Cargar en ella
fixtures sintéticos que reproduzcan filas existentes, relaciones, restricciones,
valores límite y casos históricos; comprobar invariantes y conservación antes y
después. Nunca usar producción como fixture.

Ejecutar desde la raíz y con el SHA de producción obtenido de la evidencia actual:

```sh
bash scripts/preflight-publicacion.sh \
  --mode code \
  --candidate <sha-candidato> \
  --deployed <sha-desplegado> \
  --main <sha-main-vigente> \
  --destination production \
  --evidence-file /ruta/privada/release-evidence.json
```

Usar `schema` para migraciones compatibles y `transition` para transformaciones
o activaciones incompatibles. Los dos modos de datos requieren
`DATABASE_URL_UNPOOLED` explícita, `psql`, `pg_dump`, `pg_restore`, versión
compatible del cliente y evidencia de respaldo restaurado y ensayo sintético.
El preflight contrasta el destino/SHA del despliegue, la frescura de esa evidencia,
la suite completa para el candidato y el `main` indicados, la ascendencia de Git y los archivos entre los
SHAs. `code` falla ante cualquier cambio en `drizzle/`, `drizzle-deferred/` o
`src/db/schema.ts`; un archivo de migración existente no puede modificarse,
borrarse ni renombrarse. La ausencia de historial o de prueba no equivale a un
resultado aprobado.

## Publicación de Galería con enlaces temporales

Cada merge a `main` despliega automáticamente a producción. Las migraciones de
cada PR de Galería son aditivas y se aplican en producción antes del merge, para
que ninguna versión desplegada dependa de tablas que todavía no existen. Antes
de cada aplicación se verifica el destino y se conserva respaldo recuperable.

Los enlaces nuevos tienen una puerta independiente `GALLERY_SHARES_ENABLED`,
apagada por defecto, además de `GALLERY_ENABLED`. Esto permite integrar los PRs
sin exponer la funcionalidad mientras la Galería existente sigue activa. En
Preview se comprueban ambas posiciones de la puerta; no se apaga `GALLERY_ENABLED`
en producción solo para probar el `404`.
El alcance de Galería completa se prueba solo en Preview con datos ficticios.
Si se decide probar ese alcance en producción, requiere una decisión explícita,
un enlace de una hora y un aviso de que incluirá dibujos familiares reales.

Antes de migrar producción se obtiene un dump y un snapshot/rama de Neon y se
ensayan las migraciones pendientes en una rama temporal con datos ficticios.
Migrar primero; desplegar después. El smoke productivo usa únicamente una
colección `PRUEBA` con dibujos ficticios: crear enlace de una hora, abrir desde
otro navegador, revocar y confirmar `410`; otro enlace espera una hora completa
para comprobar el vencimiento natural. Limpiar registros y objetos `PRUEBA` al
final, conservando los eventos mínimos de auditoría.

La reversión preferida es rollback instantáneo de Vercel al despliegue previo,
compatible con el esquema aditivo. Si no está disponible, apagar
`GALLERY_SHARES_ENABLED`; `GALLERY_ENABLED` queda como corte general. Revocar
credenciales afectadas. Un dump recupera datos PostgreSQL, no bytes de Blob ni
bytes que un visitante ya recibió. La entrega acepta la falta de respaldo Blob
independiente y mantiene la issue [#105](https://github.com/RadikeCosa/family-utils/issues/105) para resolverla después.

## Autorización, ejecución y recuperación

La autorización de una entrega enumera por separado, en este orden:

1. **Migraciones:** archivos, orden, conexión/destino y comprobaciones posteriores.
2. **Publicación o integración:** commit candidato, destino y si el merge dispara
   publicación automática.
3. **Activaciones o transición:** banderas, comando administrativo, punto
   irreversible y momento de parada.
4. **Recuperación:** versión/binario compatible, rollback de despliegue, acción
   sobre banderas y tratamiento del esquema/datos.

Detenerse en el primer fallo y no iniciar pasos posteriores. Si falla la suite de
`main`, congelar entregas y aplicar la recuperación ya autorizada: revertir el
código y despliegue cuando el esquema lo permita. Si una transición impide volver
al binario previo, detener activaciones y usar la versión compatible o el apagado
previsto. No revertir destructivamente migraciones ni restaurar toda la base para
resolver un fallo de código.

Las migraciones compatibles siguen expansión y luego contracción: publicar el
esquema aditivo mientras el código anterior aún funciona; desplegar el lector y
escritor compatibles; retirar dependencias antiguas en una entrega posterior;
contraer solo cuando ninguna instancia o cliente vigente necesite el esquema
anterior. Las transiciones incompatibles conservan el runbook específico del
dominio y amplían esta autorización con sus pasos reales.

Consultar el [índice documental](README.md) para las excepciones de Recetas,
Entrenamiento, Cinemateca y otros dominios.
