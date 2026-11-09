# Ficha compacta y vistas de la colección

Entrega del 8 de noviembre de 2026. La ficha prioriza la valoración y la colección
permite elegir entre tarjetas y lista. Conserva las tipografías, colores, permisos
y datos existentes. No requiere migraciones, dependencias ni variables nuevas.

## Ficha de película

Dirección, año y duración comparten una línea flexible debajo del título; los
géneros se muestran como texto secundario. Editar datos permanece junto a ellos.
Se retira la tarjeta independiente de metadatos y el rótulo redundante Película.

Mi estado y valoración aparece inmediatamente después de esos datos. En celular,
las estrellas preceden al estado; en pantallas amplias, ambos quedan en columnas.
Se mantienen los cinco radios nativos, objetivos táctiles de 44 px, navegación
por teclado, borradores, conflictos y guardado explícito. Elegir una estrella no
cambia automáticamente el estado ni guarda datos.

Las miradas de la familia siguen al formulario personal, con filas compactas para
nombre, estado y nota. El promedio conserva el cálculo compartido y las notas de
integrantes archivados. Los estados sin valoración siguen siendo visibles.

Sinopsis y reparto conservan todo su contenido en desplegables HTML nativos,
cerrados al entrar y ubicados después de las valoraciones. Solo aparecen cuando
hay contenido. El resumen del reparto muestra la cantidad de nombres y su lista
se distribuye en varias columnas naturales. Aportes, recuerdos y su formulario
siguen disponibles; Archivar o Restaurar se ubica al final y conserva confirmación.

## Tarjetas y lista

La colección incorpora los botones Tarjetas y Lista junto al conteo de resultados.
Ambos exponen su selección mediante `aria-pressed`, tienen texto visible y admiten
teclado. Tarjetas es la opción inicial.

La lista reutiliza los mismos enlaces, datos y orden que las tarjetas. Cada fila
muestra título, dirección, año, duración si existe, géneros, estado, nota personal y
promedio familiar. En escritorio esos bloques se alinean en columnas y en celular
se apilan. Las notas se muestran numéricamente sobre cinco para ahorrar espacio;
la descripción accesible conserva el significado y la cantidad de votos familiar.
No se recortan títulos o nombres para forzar una sola línea.

La preferencia se guarda por navegador en `localStorage`, bajo
`cinemateca:collection-layout`, sin identificar a una persona o familia. Se recupera
al volver de la ficha y al recargar; también se sincroniza entre pestañas. Un valor
inválido recupera Tarjetas. Si el almacenamiento no permite escribir, el selector
sigue funcionando con una preferencia en memoria durante la visita.

La preferencia no forma parte de los filtros ni se envía a la API. Alternar la
vista conserva búsqueda, género, estado, selección de integrantes, archivo y
páginas cargadas. No modifica las URLs canónicas ni el alcance de los cursores.

## Verificación

Los recorridos de `tests/e2e/library.spec.ts` cubren la ficha con sinopsis larga y
30 nombres de reparto, estrellas y guardado dentro de la primera pantalla de
390 × 844 px, apertura de desplegables por teclado, comparación de altura entre
lista y tarjeta, filtros, regreso desde la ficha, recarga, almacenamiento inválido
y error de escritura. Se comprueban anchos de 320, 390, 768 y 1280 px con texto al
200 %, navegación por teclado y análisis axe.

La entrega se verifica con PostgreSQL 18 temporal y datos sintéticos. Se ejecutan
lint, tipos, compilación de producción, pruebas de reglas y API de Cinemateca y
la suite de navegador en Chromium con tamaños iPhone y Android y WebKit con tamaño
iPhone. La validación automática no equivale a una prueba física en Safari o a una
sesión con lector de pantalla real.

## Publicación y recuperación

Repositorio: `RadikeCosa/family-utils`. Rama de entrega:
`codex/cinemateca-ficha-lista`, mediante PR a `main` y CI satisfactorio.
Proyecto Vercel: `family-utils`, equipo `radikecosas-projects`.
URL productiva: <https://family-utils-umber.vercel.app/cinemateca>.

Se publica solo esta entrega de interfaz. Los cambios locales previos de deportes
y archivos de carga se conservan en una copia recuperable de Git y un respaldo
privado fuera de los archivos versionados; no se mezclan con este despliegue.
El árbol local debe terminar limpio y `main` sincronizada con `origin/main`.

No ejecutar migraciones sobre producción para esta entrega. Si fuera necesario
revertir la interfaz, restaurar el despliegue productivo anterior en Vercel o
revertir el PR y desplegar `main`; no hay cambios de datos que compensar.
El registro privado de operación conserva commit publicado, PR, CI, despliegue,
resultado de las comprobaciones y ubicación de los respaldos. No se versionan
sesiones, trazas autenticadas, credenciales ni datos de las familias.
