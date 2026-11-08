# Películas en común por integrante

La colección incorpora “En común con vos”: cada integrante activo, excepto el
actual, aparece con la cantidad de películas que ambos marcaron `pending`.
Se incluyen coincidencias con terceros; “Todos queremos ver” es un subconjunto
de cualquier par activo y las cantidades de distintos pares no se suman.

Los conteos dependen de búsqueda, género y Colección/Archivadas. Ignoran estado,
persona seleccionada y cursor. Incluyen ceros y toda la colección filtrada, no
solo las 50 películas de una página. Se calculan en una consulta agrupada dentro
de la misma transacción `REPEATABLE READ` que obtiene los resultados.

## Contrato

`GET /api/library?view=pair_pending&withMember=<uuid>` exige `pending` de ambos.
La respuesta de colección agrega
`commonPendingCounts: { memberId: string; count: number }[]`, en orden familiar.
No cambia la respuesta de detalle ni agrega conteos al sondeo `revisionOnly`.

La API responde `400 INVALID` si falta la persona, el ID es inválido, inexistente,
ajeno a la familia o propio; también ante parámetros `withMember` repetidos,
`withMember` fuera de la vista de pares o una vista combinada con estado personal.
Los UUID se normalizan a minúsculas. Un integrante archivado de la misma familia
produce `400 MEMBER_UNAVAILABLE` en lecturas completas. Los sondeos permiten esa
selección para detectar el cambio mediante `accessRevision`.

La UI recupera enlaces a integrantes archivados quitando vista, persona y cursor,
conservando búsqueda, género y archivo, y muestra un aviso. Los identificadores
inválidos requieren usar “Quitar selección”; no se descartan silenciosamente.

El ETag `library-v4` depende de la revisión de cinemateca de toda la familia y de
la revisión de acceso. Un cambio personal de cualquier integrante lo modifica.
Los cursores de pares incluyen al integrante actual y al elegido; las revisiones
no invalidan cursores. No se requieren migraciones ni índices nuevos.

## Interacción y consistencia

Seleccionar una persona reemplaza el estado o la vista de toda la familia.
Deseleccionarla vuelve a Todas. Elegir un filtro de estado quita la persona.
Búsqueda, género y archivo se conservan. La URL permite recarga e historial.

Los botones usan `aria-pressed`, permiten selección con cero coincidencias y se
distribuyen en varias líneas. Los nombres duplicados reciben ordinales según el
orden familiar; las etiquetas se reutilizan en mensajes y anuncios de resultados.
Sin otros integrantes activos se oculta la sección.

Un aviso de cambios conserva resultados, perfiles y conteos anteriores. Cargar
más agrega la página, mantiene perfiles/conteos de la consulta original y conserva
el aviso si cambió la revisión. Refrescar reemplaza los datos juntos. Archivar al
integrante seleccionado activa primero el aviso; refrescar recupera la selección.

## Verificación

Las pruebas de reglas cubren URLs y nombres; las de rutas cubren conteos, filtros,
paginación, límites familiares, errores, integrantes archivados y ETags tras cambios
de la otra persona. Los recorridos de navegador cubren selección, cero, recuperación,
consistencia al paginar/refrescar, accesibilidad y ancho de 320 px.

El estrés de Cinemateca verifica el SQL de producción con 10.000 películas y
20 integrantes. Los recorridos paralelos de PostgreSQL se distinguen de los
escaneos secuenciales completos repetidos por película; estos últimos hacen fallar
la prueba. No hay una consulta por integrante ni un umbral temporal dependiente
de la máquina.

### Resultado local — 8 de noviembre de 2026

- PostgreSQL 18 descartable con datos exclusivamente sintéticos: 43 pruebas de
  reglas, API, restricciones y migraciones satisfactorias, sin omisiones.
- 129 recorridos de navegador satisfactorios: 43 en cada entorno (Chromium con
  tamaños iPhone y Android, WebKit con tamaño iPhone), con comprobaciones axe.
- Tipos, lint, compilación de producción y `git diff --check` satisfactorios.
- Conteos sobre 10.000 películas y 20 integrantes: aproximadamente 71 ms en esta
  máquina; recorridos paralelos globales, sin escaneos completos por película.
- WebKit usó bibliotecas existentes en un directorio temporal, sin cambios del
  sistema ni dependencias nuevas en la aplicación.

No se publicaron cambios ni se ejecutaron migraciones sobre datos familiares.
