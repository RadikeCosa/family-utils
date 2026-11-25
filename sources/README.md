# Índice documental

Este índice orienta la lectura por tarea. Los contratos describen el comportamiento
documentado en el repositorio; no certifican qué versión está en producción.
Contrastar contrato, código y pruebas del dominio antes de cambiarlo. Si se
contradicen, explicitar la diferencia y acordar cualquier cambio de producto.

## Contratos de referencia

| Área | Leer primero | Complementos |
| --- | --- | --- |
| Producto y acceso familiar | [Definición del producto](product-brief.md) | Autorización y pruebas en `src/lib/access/` |
| Tareas | [Navegación diaria](task-daily-navigation.md) | Reglas de tareas en la definición del producto |
| Compras | [Compras](shopping-lists.md) | Sus secciones operativas e históricas están fechadas |
| Menús | [Menús diarios](menus-diarios-simples.md) | [Evolución del planificador](meal-planner.md), antecedente de decisiones |
| Recetas | [Catálogo y envío a Compras](recipes.md) | [Lista y etiquetas](recipes-tags.md) |
| Cinemateca | [Cinemateca familiar](cinemateca-familiar.md) | [Datos](cinemateca-datos.md), [géneros](cinemateca-generos.md), [pares](cinemateca-pares.md), [ficha y vistas](cinemateca-ficha-vistas.md), [Cine con Cami](cinemateca-cami.md) |
| Cocina | [Conversor](kitchen-converter.md) | Datos, precisión y verificación en el mismo documento |
| Entrenamiento | [Diario, contrato 3](training-diary.md) | [Contrato anterior](training.md); conservar compatibilidad y transición explícita |
| Navegación y presentación | [Experiencia unificada](unified-experience.md) | Activación, sistema visual y recorridos compartidos |
| Deportes | [Funcionamiento y UX/UI](deportes-ux-ui.md) | [Alcance implementado](deportes-plan.md), [entregas](deportes-entregas.md) |
| Galería cálida y enlaces temporales | [Galería cálida y enlaces temporales](gallery.md) | Experiencia, permisos, enlaces temporales, privacidad, recuperación y [publicación](deployment.md#publicacion-de-galeria-con-enlaces-temporales) |
| River | [Formación y resultado](river-matchday.md) | [Clausura 2026](river-clausura-2026.md), reglas específicas de esa temporada |
| Champions | [Índice Champions](champions/README.md) | [Tabla y agenda](champions/2026-10-20-tabla-y-agenda.md), alcance fechado |
| UFC | [Base documentada como publicada](ufc/base-publicada.md) | [Puntajes e integración](ufc/puntajes-pendientes.md), confirmar pendientes contra código y pruebas |

## Procedimientos operativos

- [Guía de agentes](../AGENTS.md): acuerdos permanentes de trabajo.
- [Skills del proyecto](../agent-skills.md): instalación, comprobación y actualización.
- [Verificación local y matriz de controles](verification.md): PostgreSQL aislado y suites.
- [Preparar y autorizar una publicación](deployment.md): selección de suites,
  evidencia completa previa, preflight de solo lectura y recuperación.
- [Ventana inicial de observación del selector](verification-impact-window.md):
  registro de los primeros 20 PR y disparador de suspensión.
- [Runbook Champions](champions/publicacion-runbook.md): procedimiento especializado;
  su existencia no autoriza ejecutarlo contra producción.
- [Compras](shopping-lists.md), [Recetas](recipes.md), [Cinemateca](cinemateca-familiar.md)
  y [Diario](training-diary.md) también contienen migración, activación y recuperación.
- `scripts/preflight-publicacion.sh` inspecciona requisitos de publicación;
  `scripts/verificar-todo.sh` ejecuta las suites locales. Leerlos antes de usarlos.

## Propuestas y validaciones por confirmar

Estos documentos son antecedentes de diseño o validaciones pendientes. No deben
activar trabajo automáticamente ni sustituir un contrato posterior.

- [Rediseño de Biblioteca](family-library-redesign.md).
- [Validación de Biblioteca en iPhone](family-library-ios-validation.md).
- [Pulido de Cinemateca](cinemateca-ux.md).
- [Benchmark de Deportes](deportes-benchmark-ux.md) y [revisión UX/UI](deportes-revision-ux-ui.md).

## Historia y evidencia fechada

Consultar cuando se necesite explicar una decisión o reconstruir una entrega.
Verificar fecha, versión y destino antes de extrapolar resultados al presente.

- [Plan histórico](next-steps.md) y [Biblioteca original](family-library.md).
- Auditorías del [29/09](audit-2026-09-29.md), [18/10](audit-2026-10-18.md)
  y [Champions fase 1](deportes-champions-auditoria.md).
- Pruebas de [proveedores](deportes-proveedores.md) y [extracción pública](deportes-prueba-publica.md).
- Reportes de carga del [20/10](deportes-carga-2026-10-20-reporte.md)
  y [26/10](deportes-carga-2026-10-26-reporte.md).
- Champions: [publicación registrada](champions/publicar.md),
  [reporte jornada 3](champions/2026-27-jornada-3-reporte.md),
  [comparación de archivos](champions/cambios-vs-produccion.md),
  [revisión de migraciones](champions/revision-migraciones.md),
  [separación de UFC](champions/separacion-ufc.md) y
  [verificaciones fase 1](champions/verificaciones-fase-1.md).
- El estado operativo del 12/10 dentro de Compras y las evidencias fechadas de
  otros contratos son instantáneas históricas, no verificaciones actuales.

Los JSON, SQL, scripts y HTML junto a estos documentos son datos o herramientas
de apoyo. Su presencia no implica que deban importarse, ejecutarse o publicarse.
