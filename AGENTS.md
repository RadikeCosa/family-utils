# Trabajo de agentes en Family Utils

## Producto y alcance

- Plataforma privada de utilidades familiares, pensada como PWA móvil.
- Incluye tareas, menús, compras, Cinemateca, cocina, deportes, recetas y entrenamiento.
- Leer el [índice documental](sources/README.md) y el contrato del dominio afectado.
- La presencia de código o documentación no demuestra su publicación en producción.
- Confirmar el estado remoto solo cuando la tarea lo requiera y con evidencia actual.

## Autonomía y decisiones

- Implementar y verificar de forma autónoma dentro del alcance acordado.
- Resolver detalles reversibles siguiendo los patrones existentes.
- Consultar antes de cambiar requisitos, comportamiento de producto o permisos.
- Consultar también cambios de arquitectura principal, servicios o costos.
- No pedir nuevamente una autorización ya otorgada para la misma acción y alcance.
- Preparar cambios, comprobaciones y recuperación antes de pedir autorización final.
- Publicar, migrar producción o activar funcionalidades requiere autorización explícita.
- No habilitar delegación automática: usar subagentes solo cuando se soliciten.
- No modificar la configuración global, plugins, modelo o preferencias personales.

## Preservación del trabajo

- Inspeccionar `git status` y los cambios relevantes antes de editar.
- Conservar modificaciones y archivos pendientes de otras tareas.
- No limpiar, revertir, formatear ni reorganizar archivos fuera del alcance.
- Si hay cambios en el mismo archivo, añadir solo lo necesario y revisar el diff.
- Usar ramas cortas `codex/…` desde main actualizado cuando el estado lo permita.
- Si hay trabajo pendiente, no cambiar de rama ni moverlo de forma automática.
- Preparar commits con archivos seleccionados explícitamente; evitar `git add .`.
- No usar reset destructivo, limpieza forzada ni borrado de volúmenes.
- Integrar por PR con CI correcto; un cambio local no equivale a una entrega publicada.

## Stack y mapa

- Next.js App Router, React, TypeScript, CSS Modules y npm con su lockfile.
- Node 24 según `.nvmrc`; PostgreSQL 18 para desarrollo nuevo y verificación.
- Better Auth autogestionado; Drizzle ORM con `pg` para persistencia.
- `src/app/`: páginas, componentes de cada utilidad y handlers en `api/`.
- `src/components/`: componentes compartidos de presentación y navegación.
- `src/lib/`: reglas, servicios, autorización y contratos de cada dominio.
- `src/db/`: conexión y esquema; `drizzle/`: migraciones y metadatos.
- `tests/`: integración y navegador; reglas unitarias junto a `src/lib/`.
- `scripts/`: herramientas operativas; `sources/`: contratos y procedimientos.
- `.github/workflows/ci.yml`: controles de integración existentes.

## Implementación

- Conservar las convenciones y dependencias existentes salvo necesidad justificada.
- Explicar por qué hace falta una dependencia nueva antes de incorporarla.
- Mantener autorización, pertenencia familiar y capacidades en el servidor.
- Una bandera de interfaz no sustituye permisos ni controles de escritura.
- Preservar aislamiento entre familias y privacidad de los dominios personales.
- Mantener reglas de negocio separadas de la presentación cuando el patrón exista.
- Respetar el día civil familiar de Buenos Aires en los dominios que lo definen.
- Usar el sistema visual actual; no introducir rediseños incidentales.
- Verificar navegación, teclado, etiquetas y tamaños móviles cuando cambie la interfaz.

## Datos, privacidad y migraciones

- No imprimir secretos, URLs con credenciales ni datos familiares en evidencias públicas.
- Usar roles genéricos y ejemplos ficticios en documentación, fixtures y capturas.
- Mantener `.env.local`, respaldos y artefactos privados fuera de Git.
- Documentar nombres de variables en `.env.example`, nunca valores privados.
- Conservar SQL y hashes de migraciones aplicadas; añadir nuevas migraciones.
- Comprobar el destino antes de ejecutar cualquier escritura o migración.
- Usar `DATABASE_URL` para la app y conexión directa para migraciones y respaldos.
- No reemplazar variables locales ni cambiar de proyecto Neon incidentalmente.
- Ensayar esquema, datos y recuperación en una base aislada antes de producción.
- Usar exclusivamente datos ficticios en las pruebas; nunca producción como fixture.

## Skills y herramientas

- Seguir la [instalación reproducible](agent-skills.md) de las cuatro skills requeridas.
- Preferir las revisiones del proyecto a copias personales de procedencia incierta.
- Aplicar recomendaciones externas dentro de estas reglas y del alcance autorizado.
- No instalar servicios, migrar autenticación ni cambiar el stack por sugerencia de una skill.
- Sleek y `ui-ux-pro-max` son opcionales; consultar sus limitaciones en la guía.
- Mantener skills propias en Git solo si encapsulan un procedimiento reutilizable.
- Usar herramientas externas cuando la tarea requiera GitHub, Vercel o Neon.
- No consultar servicios remotos para resolver trabajo que solo necesite archivos locales.

## Verificación y entrega

- Seguir la [matriz de verificación](sources/verification.md) según el cambio.
- Ejecutar comprobaciones locales por impacto durante el desarrollo; usar CI y la [guía de publicación](sources/deployment.md) para la evidencia completa previa a producción.
- `bash scripts/verificar-todo.sh` selecciona por impacto; agregar `--full` para todas las suites y auditorías del inventario.
- Todo PR ejecuta CI por impacto. Al integrar, `main` reutiliza evidencia de PR solo si API, base, árbol, alcance y workflow coinciden; si no, ejecuta cobertura completa. La corrida semanal y `workflow_dispatch` con SHA explícito ejecutan cobertura completa; la certificación manual no usa reintentos.
- La cobertura funcional completa incluye todos los grupos y pruebas funcionales del catálogo; cobertura completa/`--full` añade auditorías amplias.
- Antes de autorizar producción, el preflight debe consultar una evidencia CI aprobada, confiable y suficiente para el SHA candidato y la base `main` vigente.
- Si una suite completa de `main` descubre un fallo reproducible que el PR por impacto no ejecutó, suspender selección por impacto y volver a suite completa hasta corregir y cubrir el selector.
- Esa herramienta acepta solo PostgreSQL local en la base descartable `champions_test`.
- Preparar PostgreSQL 18 y navegadores según la guía; no reutilizar el volumen de PostgreSQL 17.
- Ejecutar secuencialmente suites que compartan base, puertos, build o artefactos.
- No presentar una ejecución con pruebas omitidas como verificación completa.
- Distinguir fallos introducidos, fallos previos y limitaciones del entorno con evidencia.
- No repetir comprobaciones aprobadas salvo cambios posteriores o una duda concreta.
- Actualizar contratos y documentación cuando cambien comportamientos acordados.
- Al entregar, indicar resultado, comprobaciones ejecutadas, fallos y pendientes.
- Antes de publicar, identificar versión, destino, migraciones, activación y recuperación.
- Mejorar esta guía cuando una corrección recurrente justifique una regla breve y concreta.
