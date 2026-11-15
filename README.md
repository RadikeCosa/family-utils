# Family Utils

Plataforma privada de aplicaciones útiles para una familia. Incluye **Tareas y
rutinas**, **Planificador de menús**, **Listas de compras**, **Cinemateca familiar**
y **Conversor de cocina**. El producto está
pensado como una PWA para Android y iPhone.

## Funcionalidades documentadas

La plataforma incluye una portada, acceso con Google o código, administración
familiar, tareas y rutinas, propuestas y confirmación de las cuatro comidas diarias, y
listas de compras con editores por perfil y sugerencias familiares. Las utilidades
se consultan en
[family-utils-umber.vercel.app](https://family-utils-umber.vercel.app).
Compras se abre desde la portada o en `/compras` y requiere acceso a una
familia. La base de datos requiere aplicar las migraciones antes de desplegar
cambios que alteren su esquema.

Conversor de cocina está implementado en `/cocina` con acceso sin sesión desde
la portada pública. Convierte medidas, ingredientes y temperaturas sin guardar
consultas ni requerir migraciones. Cinemateca familiar conserva su activación
mediante `LIBRARY_ENABLED`.

El [índice documental](sources/README.md) distingue contratos, procedimientos,
propuestas e historia. El estado operativo del 12/10/2026 enlazado desde Compras
es una instantánea histórica: no certifica el despliegue actual. Las afirmaciones
sobre producción requieren comprobar versión, configuración y destino remoto.
Los cambios usan ramas cortas `codex/…` desde `main`, con PR y CI.

## Requisitos locales

- Node.js 24.13.1
- npm 11.8.0 o compatible con el lockfile
- Docker y PostgreSQL 18 para desarrollo e integración

```sh
npm ci
npm run dev
```

La configuración local va en `.env.local`, que Git ignora. No copies secretos
ni datos familiares al repositorio público. Consulta `.env.example` para los
nombres de variables necesarios.

## Calidad

La [guía de verificación](sources/verification.md) explica la selección por
impacto y el entorno aislado PostgreSQL 18. En local, el verificador selecciona
por impacto por defecto; `--full` fuerza todas las suites. Ambas formas requieren
`FAMILY_UTILS_TEST_DATABASE_URL` explícita con `champions_test` local. El
[procedimiento de publicación](sources/deployment.md) define la evidencia
completa previa a producción.

```sh
bash scripts/verificar-todo.sh
bash scripts/verificar-todo.sh --full
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:routes
npm run test:e2e
```

Los comandos sueltos son controles individuales y no acreditan la suite completa.

Las pruebas de invariantes PostgreSQL usan `FAMILY_UTILS_TEST_DATABASE_URL`,
una base aislada PostgreSQL 18. CI prepara un servicio temporal para ellas;
`npm run test:routes` levanta el build y verifica los handlers de invitación,
recuperación y edición contra ese servicio;
no apuntes esa variable a la base de datos de producción.
Playwright verifica la acción de completar y el cambio de día con tamaños de
iPhone y Android. Para ejecutarlo localmente, compilá primero, instalá Chromium
con `npx playwright install chromium webkit` y usá la misma base aislada.
La prueba PostgreSQL de menús verifica que una sola confirmación concurrente
gane.

## Documentación

- [Guía de agentes](AGENTS.md)
- [Índice por dominio y tipo de documento](sources/README.md)
- [Skills: instalación reproducible y mantenimiento](agent-skills.md)
- [Verificación local y matriz de controles](sources/verification.md)

- [Experiencia unificada: navegación, activación y verificación](sources/unified-experience.md)

- [Recetas: catálogo compartido, migraciones y activación](sources/recipes.md)

- [Rediseño de Biblioteca familiar y validación](sources/family-library-redesign.md)
- [Conversor de cocina: datos, precisión y verificación](sources/kitchen-converter.md)
- [Menús diarios: cotejo, conservación y publicación](sources/menus-diarios-simples.md)
- [Definición del producto](sources/product-brief.md)
- [Plan histórico de implementación](sources/next-steps.md)
- [Compras: contratos, migración y operación](sources/shopping-lists.md)
- [Tareas: navegación diaria, sincronización y recuperación](sources/task-daily-navigation.md)
- [Deportes: funcionamiento y guía UX/UI](sources/deportes-ux-ui.md)

Los nombres, calendarios y asignaciones de una familia son configuración
privada; la documentación del repositorio usa roles genéricos y ejemplos
ficticios.

## Entrenamiento

Utilidad personal en `/entrenamiento`, controlada por `TRAINING_ENABLED=true`.
Requiere la migración `0053_training` y el cierre operativo de respaldo y ensayo.
Contratos anteriores en [Entrenamiento](sources/training.md). El [diario personal](sources/training-diary.md) incorpora planificación y resultados separados mediante la migración aditiva `0067_training_diary`, una bandera apagada por defecto y transición administrativa explícita.

## Cinemateca familiar

Funcionamiento actual y operación en [Cinemateca familiar](sources/cinemateca-familiar.md).
Historial de implementación en [Biblioteca familiar](sources/family-library.md).
