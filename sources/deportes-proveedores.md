# Prueba de proveedores — 15 de octubre de 2026

Ejecutar `node scripts/probe-sports-providers.mjs`. Carga el entorno local sin imprimir secretos; las consultas son de solo lectura y tienen timeout de cinco segundos. No aprueba proveedores automáticamente: hace falta comparar los casos y revisar términos.

| Proveedor | Resultado real | Decisión |
|---|---|---|
| API-Football | No hay `API_SPORTS_KEY` configurada; no se pudieron consultar tres partidos. | Pendiente, River manual. |
| API-Sports MMA | No hay `API_SPORTS_KEY` configurada; no se pudieron consultar dos eventos. | Pendiente, UFC manual. |
| TheSportsDB, clave pública gratuita 123 | `eventsnext` devolvió solo un partido de River. `eventsnextleague` para UFC devolvió solo un evento; no contiene peleas completas ni horarios de preliminares/principal. | Ninguna categoría aprobada. |

Muestra obtenida de TheSportsDB:

- River: evento `2398133`, Belgrano vs River Plate, temporada 2026, fecha 2026-10-18, cancha Estadio Julio César Villagra. `dateEventLocal=2026-10-18`, `strTimestamp=2026-10-18T23:15:00` sin zona explícita.
- UFC: evento `2541772`, UFC Fight Night 291 Buckley vs Malott, fecha 2026-10-17, Rogers Place. `dateEventLocal=2026-10-17`, `strTime=00:00:00`, sin horarios de bloques. No debe interpretarse ese valor como horario confirmado. No se cotejó con UFC oficial porque la muestra ya incumple el criterio de dos carteleras completas.

No se verificaron tres partidos y dos carteleras completas. Los datos anteriores son evidencia del proveedor, no horarios aprobados para importar en la app. La fecha oficial UFC todavía necesita verificación contra eventos oficiales, especialmente cuando el inicio UTC/argentino es el domingo.

## Fuentes y condiciones revisadas

- [TheSportsDB: documentación](https://www.thesportsdb.com/documentation): clave pública 123, límites gratuitos por método. La ficha de la liga UFC identifica `4443` ([temporada](https://www.thesportsdb.com/season/4443-ufc/2026)).
- [TheSportsDB: términos](https://www.thesportsdb.com/docs_terms_of_use.php), revisión publicada 17/09/2026: permite copiar/modificar contenido de endpoints oficiales sujeto a derechos de terceros; plan gratuito para desarrollo y publicación en tiendas requiere pago. No constituye aprobación de todos los derechos aplicables al despliegue familiar.
- [API-Football: planes](https://www.api-football.com/pricing): 100 consultas diarias gratuitas y temporadas limitadas.
- [API-Sports MMA](https://api-sports.io/sports/mma): anuncia 100 consultas gratuitas diarias.
- [API-Sports: términos](https://www.api-football.com/terms): contempla aplicaciones pero no concede por sí mismo licencia de publicación de los datos de terceros. El uso concreto sigue pendiente de verificación.

## Consecuencia para la entrega

Se implementa la versión manual completa. No se incorpora proveedor, botón de actualización externa, claves en la app, banderas de integración ni tabla de sincronización hasta que una categoría apruebe la prueba. Se conservan `manually_edited` y `external_reference` existentes. La unicidad por proveedor y los metadatos de sincronización pertenecen a esa futura integración, no a la migración manual.

Para retomar, configurar una clave gratuita de API-Sports en el entorno del script, repetir la muestra y cotejar tres partidos/dos carteleras con fuentes oficiales. Nunca truncar identificadores para adaptarlos a `external_reference` (varchar de 200 caracteres); rechazar o ampliar el modelo si el proveedor excede ese límite.
