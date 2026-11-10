# Experiencia unificada de Family Utils

## Activación y reversión

La nueva presentación se selecciona en el servidor, desde las entradas de página:

- `UNIFIED_UI_ENABLED=true`: activar para todos, incluidos visitantes públicos.
- `UNIFIED_UI_ENABLED=false`: conservar la presentación anterior.
- `UNIFIED_UI_PREVIEW_MEMBER_IDS`: UUIDs de integrantes separados por comas. Con activación general apagada, solo esos integrantes acceden a la presentación nueva.

La configuración no modifica permisos ni habilita aplicaciones. Las variables de cada app siguen siendo las fuentes de sus capacidades. La lista de prueba no se envía al navegador.

Se mantiene la presentación anterior durante la estabilización. La reversión consiste en vaciar la lista de prueba, apagar la activación general y redesplegar. No hay migraciones asociadas a esta funcionalidad.

La activación general debe realizarse en una sola entrega, después de las verificaciones descritas abajo. No se activa automáticamente desde tests ni al compilar.

## Estructura

El catálogo tipado define orden, rutas, nombres, iconos, acentos y subsecciones. El marco compartido recibe únicamente aplicaciones habilitadas e identidad familiar mínima; no consulta contenidos de todas las apps.

El layout raíz conserva su función documental. Las páginas siguen comprobando acceso y capacidades; la capa de datos mantiene la autorización de cada operación. En Recetas se agrega comprobación explícita en ambas páginas, además de las comprobaciones existentes del layout y los servicios.

Inicio muestra el lanzador autenticado o la portada pública. Conversor conserva una única ruta y un único componente de cálculo, con presentación pública o autenticada. Acceso usa la presentación pública.

Sidebar persistente desde 1024 px; debajo se usa un único drawer nativo modal. El botón del header y la sección junto al título abren ese mismo drawer. La sección actual se expande y el enlace activo queda visible. Escape, cierre y navegación devuelven el foco al disparador; la modalidad mantiene el foco dentro y bloquea el desplazamiento exterior.

El contenido de las apps conserva sus componentes y reglas de negocio. Marcadores explícitos identifican navegación anterior, superficies y encabezados; los estilos de unificación solo se aplican dentro de la experiencia nueva.

## URLs y contexto

La URL prevalece sobre el almacenamiento local. Secciones y detalles crean entradas de historial; búsquedas y filtros reemplazan la entrada actual. Las fechas explícitas crean entradas, mientras que las actualizaciones automáticas de Hoy reemplazan la actual. Los parámetros desconocidos o inválidos se normalizan sin escribir datos de negocio.

| Aplicación | Estado navegable |
| --- | --- |
| Tareas | `fecha`, `seccion=historial`, `estado=completed/archived` |
| Menús | `fecha`, `vista=dia/semana`, `comida` |
| Recetas | `q`, `archived=true`, contexto `fecha` y `comida`; detalle en la ruta |
| Compras | `archived=true`; detalle en la ruta |
| Cinemateca | Parámetros existentes, incluida selección familiar, estados, género y búsqueda; detalle en la ruta |
| Deportes | Deporte, evento y ronda existentes; filtro de integrante del tablero UFC |
| Entrenamiento | `seccion=historial`, `archived=true`, `detalle` |
| Conversor | `temperatura=true`; no se guardan cantidades ni ingredientes |

No se restauran scroll, cursores, cantidad de páginas ni resultados anteriores. Las colecciones consultan datos actuales desde la primera página.

Los breadcrumbs y el enlace al padre abren la vista predeterminada de ese nivel. Atrás/Adelante siguen el historial nativo. El regreso contextual abre la URL de procedencia con sus filtros.

Los orígenes se registran en aperturas explícitas de detalles y conexiones entre apps. Se guardan en `sessionStorage`, asociados al destino y separados por familia e integrante. No se añade `from` a la URL ni se reemplaza el estado interno de Next.js. Se rechazan destinos externos, desconocidos, deshabilitados o iguales al origen.

Recientes guarda hasta cuatro apps, sin duplicados, en `localStorage`. Cada registro contiene solo identificador de app y URL; no guarda nombres de elementos ni borradores. Las claves incluyen familia e integrante. Un cambio de identidad usa otro espacio de almacenamiento. Salir borra recientes y orígenes del perfil saliente. El bloqueo del almacenamiento no impide navegar.

## Sistema visual

Fondo cálido, superficies claras, texto oscuro y verde oscuro de acción. DM Sans para interfaz y Manrope para títulos y marca. Las superficies lavanda, durazno y menta son decorativas; el contenido informativo conserva texto e iconos oscuros. Errores y éxitos usan significados comunes.

Controles táctiles de al menos 44 px, foco visible, zonas seguras de teléfonos y movimiento reducido. Los breadcrumbs y el header reservan espacio estable mientras se obtiene el nombre del detalle. Recientes usa una altura estable para evitar desplazar el catálogo al leer el almacenamiento del dispositivo.

## Inventario verificable

Cada entrada debe comprobar marco, selección, título, acción principal, ubicación, filtros, estados, permisos, teclado y adaptación:

| Familia de pantallas | Composiciones incluidas en la suite |
| --- | --- |
| Plataforma | Inicio autenticado, portada pública, acceso y drawer |
| Tareas | Vista diaria, historial y formulario de nueva tarea |
| Menús | Día y semana |
| Recetas | Colección, detalle y editor |
| Compras | Listas y detalle con edición de productos |
| Cinemateca | Colección, detalle y edición de datos |
| Deportes | River, UFC, Champions y las tres páginas de estadísticas/tablas |
| Entrenamiento | Rutinas, historial, detalle de rutina/sesión y editor |
| Conversor | Medidas e ingredientes, temperatura y ambas presentaciones |
| Mi familia | Integrantes y controles de acceso |

Las capturas se generan en 360, 390, 768, 1024 y 1440 px con datos ficticios creados por API en una base aislada. Los tests comprueban que no exista desbordamiento horizontal del documento y ejecutan axe sobre cada pantalla y formulario capturado. Los recorridos de drawer, regreso contextual y conversión también se ejecutan en WebKit. Las capturas requieren revisión visual; su generación por sí sola no implica aprobación.

## Verificación

```sh
npm run lint
npm run typecheck
npm run build
npm run test:navigation
FAMILY_UTILS_TEST_DATABASE_URL=postgres://.../family_unified_test npm run test:unified
```

La suite específica exige una base local cuyo nombre termine en `_test`, ya migrada, y levanta cuatro servidores de producción: presentación nueva, anterior, prueba por integrante y aplicaciones opcionales deshabilitadas. Las capturas y mediciones quedan en `test-results-unified/`. Las credenciales usadas por los servidores de prueba son ficticias. La suite no usa la base configurada en `.env.local`.

Incluye flag apagado/encendido, prueba por integrante, ambos disparadores del drawer, foco, regreso contextual frente al padre, historial, normalización, recientes, cambio de perfil sin cierre de sesión y almacenamiento bloqueado.

El presupuesto de Inicio usa cinco contextos de navegador nuevos por variante, públicos y autenticados: diferencia de medianas de LCP ≤200 ms y CLS ≤0,1. El resultado se adjunta como `performance.json`. Para reproducibilidad, la medición bloquea la descarga externa de fuentes en ambas variantes; no sustituye el seguimiento de usuarios reales.

Además deben pasar las pruebas de reglas, rutas y recorridos existentes relevantes. La activación requiere revisar también errores, conflictos, estados vacíos/solo lectura, permisos, acceso por Google/código e instalación PWA.
