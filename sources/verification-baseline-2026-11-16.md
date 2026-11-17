# Línea base de verificación, 16/11/2026

## Ejecución completa aprobada en CI

- Check: [CI manual #309](https://github.com/RadikeCosa/family-utils/actions/runs/43780561701).
- Workflow: `.github/workflows/ci.yml`, evento `workflow_dispatch`, intento 1, conclusión `success`.
- Duración del job: **16 min 51 s** (00:28:29–00:45:20 UTC).
- Instalación de dependencias: **48 s**; compilación, lint y tipos: **42 s**; instalación Chromium/WebKit: **45 s**; migración auxiliar: **1 s**; suites seleccionadas: **13 min 53 s**.
- La descripción del PR #87 registra que la corrida completa verificó el candidato `c9511ff4c58b6a86e4ff1d14648998c7306e6777`: 9 grupos, 781 casos aprobados y ninguno omitido. La API de GitHub confirma el resultado, intento, ruta del workflow y hora del job; `head_sha` es el ref confiable del workflow manual, no el SHA objetivo enviado como input.
- No se dispone de una corrida aprobada comparable que desglosara tiempo de arranque del servicio PostgreSQL; en ese workflow el contenedor ya estaba inicializado antes de comenzar el job.

## Ejecución local disponible

El reporte local guardado corresponde a una corrida completa fallida: 799.978 ms de suites (13 min 20 s), 4 de 9 grupos fallidos. No contiene tiempos de preparación ni build. No se toma como comparación aprobada.

Durante esta implementación, Docker no está disponible en el entorno local (`permission denied` al conectar con el daemon); por ello no se repetirá esa corrida aquí. Las duraciones de referencia de CI vienen del check enlazado arriba.

## Comparación posterior

Registrar la misma descomposición y ambiente tras las entregas del selector. Para probar escenarios, usar cambios sintéticos representativos (HIIT, API, documentación, estilos compartidos, migración); no sumar sus duraciones como si fueran ejecuciones reales. La reducción de pruebas queda fuera de esta comparación inicial y requiere su propia corrida completa antes y después.

## Revisión de GitHub Actions

La API confirma que `family-utils` es público, `main` es la rama por defecto y
`main` exige el check `check`. Una corrida real anterior muestra `workflow_id`,
`path`, `head_sha`, `event`, `run_attempt`, job y artefactos con vencimiento; la
guía oficial documenta `job.workflow_sha` como la revisión exacta del archivo de
workflow que ejecutó el job. Esa combinación permite comprobar la identidad del
workflow y comparar el contenido de su revisión con `main`. El endpoint de
configuración Actions no estuvo disponible por la conexión de lectura; antes de
integrar, confirmar en Settings que Actions y el permiso de crear issues estén
habilitados.

La revisión vigente de GitHub indica que los runners estándar hospedados son sin
cargo en repositorios públicos, pero el almacenamiento de artefactos es compartido.
La última corrida observada subió 29,7 MB de capturas; por eso el workflow conserva
capturas 7 días y el manifiesto pequeño 90 días. El cron puede demorarse, solo corre
desde la rama por defecto y se desactiva después de 60 días sin actividad pública.
