# Family Utils

Plataforma privada de aplicaciones útiles para una familia. Incluye **Tareas y
rutinas**, **Planificador de menús**, **Listas de compras**, **Biblioteca familiar**
y **Conversor de cocina**. El producto está
pensado como una PWA para Android y iPhone.

## Estado

La plataforma incluye una portada, acceso con Google o código, administración
familiar, tareas y rutinas, propuestas y confirmación de las cuatro comidas diarias, y
listas de compras con editores por perfil y sugerencias familiares. Las utilidades
publicadas están disponibles en
[family-utils-umber.vercel.app](https://family-utils-umber.vercel.app).
Compras se abre desde la portada o en `/compras` y requiere acceso a una
familia. La base de datos requiere aplicar las migraciones antes de desplegar
cambios que alteren su esquema.

Conversor de cocina está implementado en `/cocina` con acceso sin sesión desde
la portada pública. Convierte medidas, ingredientes y temperaturas sin guardar
consultas ni requerir migraciones. Biblioteca familiar conserva su activación
mediante `LIBRARY_ENABLED`.

El [estado operativo y orden del repositorio](sources/shopping-lists.md#estado-operativo-y-orden-del-repositorio--2026-10-12)
registra la verificación del 12/10/2026, los retiros pendientes y la medición
desde el 18/10. Los cambios usan ramas cortas `codex/…` desde `main`, con PR y CI.

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

```sh
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:routes
npm run test:e2e
```

Las pruebas de invariantes PostgreSQL usan `FAMILY_UTILS_TEST_DATABASE_URL`,
una base aislada PostgreSQL 18. CI prepara un servicio temporal para ellas;
`npm run test:routes` levanta el build y verifica los handlers de invitación,
recuperación y edición contra ese servicio;
no apuntes esa variable a la base de datos de producción.
Playwright verifica la acción de completar y el cambio de día con tamaños de
iPhone y Android. Para ejecutarlo localmente, compilá primero, instalá Chromium
con `npx playwright install chromium` y usá la misma base aislada.
La prueba PostgreSQL de menús verifica que una sola confirmación concurrente
gane.

## Documentación

- [Rediseño de Biblioteca familiar y validación](sources/family-library-redesign.md)
- [Conversor de cocina: datos, precisión y verificación](sources/kitchen-converter.md)
- [Menús diarios: cotejo, conservación y publicación](sources/menus-diarios-simples.md)
- [Definición del producto](sources/product-brief.md)
- [Plan histórico de implementación](sources/next-steps.md)
- [Compras: contratos, migración y operación](sources/shopping-lists.md)
- [Tareas: navegación diaria, sincronización y recuperación](sources/task-daily-navigation.md)

Los nombres, calendarios y asignaciones de una familia son configuración
privada; la documentación del repositorio usa roles genéricos y ejemplos
ficticios.

## Biblioteca familiar

Implementación por etapas y estado operativo en [Biblioteca familiar](sources/family-library.md).
