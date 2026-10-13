# Conversor de cocina

Utilidad pública en `/cocina`, con tarjeta siempre visible en la portada pública.
No consulta sesión, membresía ni base de datos. El catálogo y los cálculos se
ejecutan en el dispositivo; no se guardan consultas ni preferencias. Con la
página cargada, perder conexión no impide convertir. Abrirla sin conexión no
está soportado en esta entrega.

## Datos y unidades

El catálogo inicial contiene 14 ingredientes. Cada entrada incluye densidad
en **g/ml**, fuente enlazada, medida original y nota de preparación/variabilidad.
Las referencias de [King Arthur Baking](https://www.kingarthurbaking.com/learn/ingredient-weight-chart)
se verificaron el 13/10/2026 y se normalizan usando taza US de 236,588 ml;
una cucharada US de esa fuente representa 1/16 de taza US. Agua usa la
aproximación de [NIST](https://www.nist.gov/glossary-term/21726), 1 g/ml.
Leche entera líquida usa 1,030 g/ml (TB) y aceite líquido excepto palma usa
0,92 g/ml (DK), publicados directamente como densidades en
[FAO/INFOODS Density Database v2](https://www.fao.org/4/ap815e/ap815e.pdf),
páginas 13 y 14 del PDF, verificadas en la misma fecha.
Son referencias culinarias aproximadas, no mediciones de marcas locales.

Cambiar entre taza de 250 ml (inicial), 240 ml y US de 236,588 ml cambia solo
el volumen. No se duplican densidades. Ejemplo de regresión: harina común,
120 g por taza US, da 121,7 g en 240 ml y 126,8 g en 250 ml antes de redondear.
Las cucharas del conversor son métricas: cucharadita de 5 ml y cucharada de
15 ml. `oz (peso)` equivale a 28,349523125 g; no se ofrece onza fluida.

## Entrada y resultado

- Coma o punto indican decimal; nunca agrupación de miles. `1.000` significa
  uno. Se rechazan separadores combinados, valores no finitos y fracciones con
  denominador cero. Se admite cero y temperatura negativa.
- Fracciones `1/2` y mixtas `1 1/2`. Los botones ¼, ½ y ¾ conservan la parte
  entera y reemplazan la fracción. Campo con teclado decimal móvil.
- También se admiten fracciones copiadas del resultado (`½`, `1 ½`) y
  decimales sin cero inicial (`.5`, `,5`). Tocar el modo ya seleccionado no
  reinicia la cantidad ni las unidades.
- Intercambiar cambia solo unidades y conserva cantidad e ingrediente.
- Resultado visible inmediato con entrada interpretada; solo el anuncio
  accesible completo espera 300 ms de quietud. Una nueva edición cancela el
  anuncio pendiente; entradas vacías o inválidas retiran el resultado anterior.
- Todos los números se presentan en es-AR con `useGrouping: false`.

El módulo mantiene precisión interna. Para presentación: gramos desde 100 al
múltiplo de 5 más cercano, desde 1 hasta menos de 100 al entero y por debajo
de 1 con dos decimales. kg y lb tienen hasta tres decimales; oz, ml y litros,
dos; °C y °F, uno. Tazas y cucharas usan enteros y fracciones culinarias
¼, ⅓, ½, ⅔, ¾ si su error relativo no supera 2 %; si no, dos decimales.
Un positivo menor a la resolución se presenta como `< resolución`, nunca
cero. Temperaturas negativas muy pequeñas usan `> −resolución`.

Cada unidad se redondea a partir del cálculo completo: una misma taza de
harina puede mostrar 125 g o 0,127 kg. Es una diferencia de presentación
deliberada, no un cálculo encadenado. Peso ↔ volumen lleva “aproximadamente”
y la nota del ingrediente.

## Verificación y siguientes mejoras

`npm test` incluye las pruebas del módulo. `npx playwright test
tests/e2e/kitchen.spec.ts` verifica acceso anónimo desde portada y URL directa,
interacciones, redondeo, anuncio diferido, accesibilidad y tamaños de iPhone y
Android sin requerir una base de pruebas. También ejecutar lint, tipos y build.

Revisión previa a publicación del 13/10/2026: diff completo sin cambios de
dependencias, permisos ni esquema; lint, tipos y build aprobados. En PostgreSQL
18 temporal y aislado pasaron 63 pruebas de lógica/base de datos, 50 de rutas,
64 recorridos de navegador (10 del conversor) y 3 auditorías de accesibilidad,
sin omisiones. La auditoría general incluye `/cocina` sin sesión en nueve
anchos entre 320 y 1280 px. Los recorridos del conversor comprueban también los
14 ingredientes, las fuentes visibles, ausencia de llamadas a API y errores
de ejecución, fracciones copiadas, modo activo sin reinicio y el anuncio
diferido al volver a una cantidad anterior.

No incluye sustituciones, recetas completas, porciones, moldes ni integración
con menús o compras. Mejora futura: guía de horno argentino (mínimo, moderado,
fuerte y reguladores), con advertencia sobre diferencias entre modelos.
