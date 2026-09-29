# Family Utils

Plataforma privada de aplicaciones útiles para una familia. La primera app es
**Tareas y rutinas**. El producto está pensado como una PWA para Android y
iPhone.

## Estado

La plataforma incluye una portada, acceso con Google o código, una aplicación de
tareas y administración familiar. La base de datos requiere aplicar las
migraciones antes de desplegar cambios que alteren su esquema.

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

## Documentación

- [Definición del producto](sources/product-brief.md)
- [Plan de implementación](sources/next-steps.md)

Los nombres, calendarios y asignaciones de una familia son configuración
privada; la documentación del repositorio usa roles genéricos y ejemplos
ficticios.
