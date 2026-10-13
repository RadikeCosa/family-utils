export const US_CUP_ML = 236.588;
const source = "https://www.kingarthurbaking.com/learn/ingredient-weight-chart";

export type Ingredient = {
  id: string;
  name: string;
  density: number;
  source: string;
  sourceName: string;
  originalMeasure: string;
  note: string;
};

function reference(id: string, name: string, grams: number, cups: number, originalMeasure: string, note: string): Ingredient {
  return { id, name, density: grams / (cups * US_CUP_ML), source,
    sourceName: "King Arthur Baking", originalMeasure, note };
}

// Source values verified 2026-10-13. A US tablespoon is 1/16 US cup;
// it is NOT the 15 ml tablespoon offered by this converter.
export const ingredients: readonly Ingredient[] = [
  { id: "water", name: "Agua", density: 1,
    source: "https://www.nist.gov/glossary-term/21726", sourceName: "NIST",
    originalMeasure: "Aproximadamente 1 g por cm³ (1 ml)",
    note: "Aproximación de cocina; la densidad cambia con la temperatura." },
  { id: "milk", name: "Leche", density: 1.030,
    source: "https://www.fao.org/4/ap815e/ap815e.pdf#page=13", sourceName: "FAO/INFOODS · Density Database v2",
    originalMeasure: "Milk, liquid, whole (TB): 1,030 g/ml",
    note: "Leche entera líquida; varía según el contenido de grasa y la temperatura." },
  { id: "oil", name: "Aceite", density: 0.92,
    source: "https://www.fao.org/4/ap815e/ap815e.pdf#page=14", sourceName: "FAO/INFOODS · Density Database v2",
    originalMeasure: "Oil, other than palmoil (DK): 0,92 g/ml",
    note: "Aceite líquido, excepto palma; varía por tipo y temperatura. No usar para grasas sólidas." },
  reference("flour", "Harina común", 120, 1, "All-Purpose Flour: 120 g / taza US", "Medir sin compactar y nivelar al ras; no equivale a harina leudante."),
  reference("whole-flour", "Harina integral", 113, 1, "Whole Wheat Flour (Premium 100%): 113 g / taza US", "Medir sin compactar y al ras; varía por molienda y marca."),
  reference("sugar", "Azúcar blanca", 198, 1, "Sugar (granulated white): 198 g / taza US", "Azúcar granulada, medida al ras."),
  reference("icing-sugar", "Azúcar impalpable", 113, 1, "Confectioners’ sugar (unsifted): 113 g / taza US", "Sin tamizar, sin compactar y al ras; varía por marca."),
  reference("brown-sugar", "Azúcar rubia compactada", 213, 1, "Brown sugar (dark or light, packed): 213 g / taza US", "Referencia de azúcar morena húmeda compactada; no usar para azúcar rubia seca o demerara."),
  reference("butter", "Manteca", 113, 0.5, "Butter: 113 g / ½ taza US (8 cucharadas US)", "Sin derretir, sin huecos de aire; varía con la temperatura."),
  reference("honey", "Miel", 21, 1 / 16, "Honey: 21 g / cucharada US", "Varía por tipo, marca y temperatura."),
  reference("rice", "Arroz crudo", 99, 0.5, "Rice (long grain, dry): 99 g / ½ taza US", "Grano largo seco, medido al ras; otros arroces pueden pesar distinto."),
  reference("oats", "Avena arrollada", 89, 1, "Oats (old-fashioned or quick-cooking): 89 g / taza US", "Copos secos sin compactar; varía por tamaño y marca."),
  reference("salt", "Sal fina", 18, 1 / 16, "Salt (table): 18 g / cucharada US", "Sal de mesa al ras; varía por marca y granulometría. No equivale a sal gruesa."),
  reference("cocoa", "Cacao amargo", 42, 0.5, "Cocoa (unsweetened): 42 g / ½ taza US", "Cacao sin azúcar, sin compactar y al ras; varía por marca."),
];
