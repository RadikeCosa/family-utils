# Family Utils

Plataforma privada de aplicaciones útiles para una familia. La primera app es
**Tareas y rutinas**. El producto está pensado como una PWA para Android y
iPhone.

## Estado

El proyecto está en la etapa de preparación del repositorio y la base de Next.js.
La aplicación todavía no está desplegada y no tiene servicios remotos
configurados.

## Requisitos locales

- Node.js 24.13.1
- npm 11.8.0 o compatible con el lockfile
- Docker y PostgreSQL 17 para desarrollo e integración

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
```

## Documentación

- [Definición del producto](sources/product-brief.md)
- [Plan de implementación](sources/next-steps.md)

Los nombres, calendarios y asignaciones de una familia son configuración
privada; la documentación del repositorio usa roles genéricos y ejemplos
ficticios.
