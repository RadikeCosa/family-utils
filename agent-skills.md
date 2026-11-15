# Skills del proyecto

Las reglas permanentes están en [AGENTS.md](AGENTS.md). Las skills aportan
procedimientos especializados y sus recomendaciones quedan dentro del alcance
autorizado: no habilitan cambios de producto, servicios ni producción por sí solas.

## Requisitos externos

| Instalación local | Fuente y ruta | Revisión inmutable |
| --- | --- | --- |
| `neon` | [neondatabase/agent-skills](https://github.com/neondatabase/agent-skills/tree/5bc1845c9bd436dba9d9c2d389bd6b14bf465354/skills/neon) · `skills/neon` | `5bc1845c9bd436dba9d9c2d389bd6b14bf465354` |
| `neon-postgres` | [neondatabase/agent-skills](https://github.com/neondatabase/agent-skills/tree/5bc1845c9bd436dba9d9c2d389bd6b14bf465354/skills/neon-postgres) · `skills/neon-postgres` | `5bc1845c9bd436dba9d9c2d389bd6b14bf465354` |
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices) · `skills/react-best-practices` | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/web-design-guidelines) · `skills/web-design-guidelines` | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` |

`skills-lock.json` versión 2 es el registro propio de este proyecto. Conserva
fuente y ruta y añade commit descargable, árbol Git y SHA-256 del directorio.
Reemplaza los antiguos `computedHash`, que no identificaban una revisión
descargable. Mantenerlo con la herramienta del proyecto; otros instaladores
pueden usar un formato distinto o sobrescribirlo.

## Instalar desde un checkout limpio

Requiere Node 24, Git y acceso HTTPS a GitHub. No necesita credenciales de Neon,
Vercel, OpenAI ni información familiar. Desde la raíz del repositorio:

```sh
node scripts/project-skills.mjs install
node scripts/project-skills.mjs check
```

El instalador descarga los commits fijados, verifica árboles y archivos y copia
los directorios completos a `.agents/skills/`. No ejecuta scripts descargados,
no instala dependencias ni modifica archivos globales. Valida todas las colisiones
antes de instalar; una copia existente distinta produce error y queda intacta.
Las copias idénticas se aceptan sin cambios. Iniciar un chat nuevo para comprobar
la disponibilidad de las instrucciones instaladas.

Para revisar la reconstrucción sin tocar instalaciones existentes:

```sh
skills_review_dir="$(mktemp -d)"
node scripts/project-skills.mjs install --dest "$skills_review_dir"
node scripts/project-skills.mjs check --dest "$skills_review_dir"
```

El chequeo compara contenido completo, incluidos ejemplos y referencias, y falla
si faltan archivos, hay diferencias o aparecen enlaces simbólicos. Es local y
no consulta la red. El digest ordena rutas relativas y concatena para cada archivo
`ruta + NUL + sha256(contenido) + NUL`, luego calcula SHA-256 del conjunto.
No depende de timestamps, permisos de checkout ni ubicación del directorio.

## Instalaciones existentes y herramientas opcionales

Las instalaciones presentes al introducir esta configuración se conservan.
`check` puede detectar diferencias respecto de las revisiones fijadas: eso
significa que falta adoptar la versión reproducible, no que se haya actualizado
la instalación. Revisar una copia temporal y coordinar el reemplazo explícito
de la copia local. No eliminar copias personales o plugins para resolverlo.

Preferir las versiones del proyecto y comprobar el catálogo de un chat nuevo;
si hay nombres duplicados, identificar la ruta seleccionada antes de aplicar
la skill. Esta preferencia no cambia la precedencia de instrucciones impuesta
por Codex o por el entorno.

- **Sleek:** opcional para trabajos explícitos de diseño con ese servicio;
  requiere acceso propio y puede consumir créditos. No forma parte del arranque.
- **ui-ux-pro-max:** opcional. La copia local usa rutas
  `${CLAUDE_PLUGIN_ROOT}/.claude/...`, incompatibles con esta instalación.
  No ejecutar esas rutas literalmente; si se necesita, resolver su ubicación
  real dentro de la skill y verificar el procedimiento para esa tarea.

Las cuatro skills requeridas y estas dos opcionales están excluidas de Git por
directorio. Las futuras skills propias bajo `.agents/skills/<nombre>/` quedan
versionables. `.agents/tmp/`, `.agents/cache/` y cachés Python se excluyen.
No crear una skill propia para duplicar las reglas generales del repositorio.

## Actualizar una versión

1. Elegir y revisar un commit completo del repositorio de origen. No usar ramas
   móviles ni `latest` como referencia final. Comprobar licencias, dependencias,
   rutas, servicios externos y cambios de comportamiento respecto de la versión fijada.
2. En un clon temporal del origen, extraer solamente el directorio de la skill
   del commit elegido. Obtener su árbol con `git rev-parse <commit>:<ruta>`.
3. Calcular su digest con `node scripts/project-skills.mjs hash --dest <directorio>`.
   Actualizar `revision`, `gitTree` y `directorySha256` de esa entrada en el lock.
   Mantener `sourceType: github`, fuente, ruta y nombre de instalación coherentes.
4. Actualizar la tabla de esta guía y revisar el diff. Instalar las cuatro skills
   en otra carpeta vacía con el lock modificado y ejecutar `check`.
5. Acordar la adopción de la copia local si ya existe una versión diferente;
   el instalador no ofrece una opción de sobrescritura automática.

La organización de guía permanente y skills sigue la
[documentación oficial de personalización](https://learn.chatgpt.com/docs/customization/overview).
