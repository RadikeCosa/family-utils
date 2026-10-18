# Champions · reporte público de publicación

**Estado al 18/10/2026:** Jornada 3 publicada y habilitada para la familia, antes del corte acordado del **20/10/2026 a las 13:45 de Argentina**. Las condiciones pendientes de la auditoría inicial se resolvieron durante la publicación; los documentos de preparación conservan sus resultados como evidencia histórica.

La apertura corresponde al [commit c285d60](https://github.com/RadikeCosa/family-utils/commit/c285d6035eb7703e4c49859f87efcc955d19848e), con [CI aprobado](https://github.com/RadikeCosa/family-utils/actions/runs/39153224018). Los PR [#42](https://github.com/RadikeCosa/family-utils/pull/42), [#44](https://github.com/RadikeCosa/family-utils/pull/44) y [#43](https://github.com/RadikeCosa/family-utils/pull/43) preservaron el historial del candidato, corrigieron la sincronización de dos pruebas y restablecieron los despliegues automáticos, respectivamente.

- Dos restauraciones aisladas en PostgreSQL 18, incluida una posterior al ajuste operacional de permisos. Se reconstruyeron los permisos omitidos por la restauración y se comprobó la conservación de los datos protegidos.
- Diez migraciones Champions aplicadas; 38 entradas, timestamps y hashes verificados. Se conservaron los datos previos de 45 tablas y los puntos y cierres UFC.
- CI final: **383 pruebas aprobadas, cero fallos y cero omisiones**: reglas/base 108, rutas 106, navegador general 114, Deportes 20, Champions 32 y accesibilidad 3. Dependencias, snapshots, migraciones, permisos, lint, tipos y compilación aprobados.
- Calendario revalidado contra UEFA el 18/10/2026 antes de importar: 18 partidos y 36 equipos. La segunda vista previa reconoció los partidos existentes sin proponer nuevos; no se confirmó una segunda importación.
- Sesión administradora real y revisión familiar desde otra cuenta: elecciones ajenas ocultas antes del cierre. Pronóstico temporal eliminado y apagado/reencendido comprobados sin perder la jornada. No se repitió un inicio de sesión Google desde cero ni se condujo independientemente una sesión productiva de rol integrante; la confirmación de privacidad de la otra cuenta fue aportada por el operador.
- Publicación manual inicial y despliegue automático posterior verificados. Las incidencias de CI se corrigieron sin cambiar las reglas ni omitir pruebas. Los contenedores, las copias restauradas y el checkout temporal se eliminaron; los respaldos y la evidencia permanecen privados.

Pendiente del uso real: revisar el primer cierre el 20/10 a las 13:46 de Argentina y cargar posteriormente los resultados oficiales. El seguimiento local requiere la computadora encendida, la aplicación abierta y acceso válido. La revisión de dependencias y las advertencias preexistentes constan en el registro privado; no se cambiaron dependencias durante esta publicación.

El [resumen de publicación](publicar.md) contiene el estado vigente y los controles generales. Los identificadores de infraestructura, conexiones y procedimientos detallados se conservan únicamente en la copia privada del operador.
