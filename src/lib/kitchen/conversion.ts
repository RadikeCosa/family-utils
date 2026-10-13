import { US_CUP_ML, type Ingredient } from "./ingredients.ts";

export const units = {
  g: { label: "g", kind: "weight", factor: 1 },
  kg: { label: "kg", kind: "weight", factor: 1000 },
  oz: { label: "oz (peso)", kind: "weight", factor: 28.349523125 },
  lb: { label: "lb", kind: "weight", factor: 453.59237 },
  ml: { label: "ml", kind: "volume", factor: 1 },
  l: { label: "litros", kind: "volume", factor: 1000 },
  tsp: { label: "cucharaditas (5 ml)", kind: "volume", factor: 5 },
  tbsp: { label: "cucharadas (15 ml)", kind: "volume", factor: 15 },
  cup: { label: "tazas", kind: "volume", factor: US_CUP_ML },
  C: { label: "°C", kind: "temperature", factor: 1 },
  F: { label: "°F", kind: "temperature", factor: 1 },
} as const;
export type Unit = keyof typeof units;
export type CupSize = 250 | 240 | typeof US_CUP_ML;

const fractionInputs: Record<string, string> = {
  "¼": "1/4", "⅓": "1/3", "½": "1/2", "⅔": "2/3", "¾": "3/4",
};

export function parseQuantity(raw: string): number | null {
  let value = raw.trim();
  const culinary = /^(-?)(?:(\d+)\s*)?([¼⅓½⅔¾])$/.exec(value);
  if (culinary) {
    const [, sign, whole, symbol] = culinary;
    value = `${sign}${whole ? `${whole} ` : ""}${fractionInputs[symbol]}`;
  }
  let result: number;
  const fraction = /^(-?)(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(value);
  if (fraction) {
    const [, sign, whole, numerator, denominator] = fraction;
    if (Number(denominator) === 0) return null;
    result = (Number(whole ?? 0) + Number(numerator) / Number(denominator)) * (sign ? -1 : 1);
  } else if (/^-?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value)) {
    result = Number(value.replace(",", "."));
  } else return null;
  return Number.isFinite(result) ? result : null;
}

export function applyFraction(raw: string, fraction: "1/4" | "1/2" | "3/4"): string {
  const parsed = parseQuantity(raw);
  const whole = parsed !== null && parsed >= 0 ? Math.floor(parsed) : 0;
  return whole > 0 ? `${whole} ${fraction}` : fraction;
}

export function needsIngredient(from: Unit, to: Unit): boolean {
  return units[from].kind !== units[to].kind && units[from].kind !== "temperature" && units[to].kind !== "temperature";
}

export function convert(value: number, from: Unit, to: Unit, cup: CupSize = 250, ingredient?: Ingredient): number {
  if (!Number.isFinite(value)) throw new Error("Ingresá una cantidad finita.");
  const source = units[from], target = units[to];
  let result: number;
  if (source.kind === "temperature" || target.kind === "temperature") {
    if (source.kind !== target.kind) throw new Error("Elegí dos unidades de temperatura.");
    result = from === to ? value : from === "C" ? value * 9 / 5 + 32 : (value - 32) * 5 / 9;
  } else {
    if (value < 0) throw new Error("La cantidad no puede ser negativa.");
    const fromFactor = from === "cup" ? cup : source.factor;
    const toFactor = to === "cup" ? cup : target.factor;
    let base = value * fromFactor;
    if (needsIngredient(from, to)) {
      if (!ingredient || !Number.isFinite(ingredient.density) || ingredient.density <= 0) throw new Error("Elegí un ingrediente para convertir entre peso y volumen.");
      base = source.kind === "volume" ? base * ingredient.density : base / ingredient.density;
    }
    result = base / toFactor;
  }
  if (!Number.isFinite(result)) throw new Error("La cantidad es demasiado grande para convertirla.");
  return result;
}

export function numberText(value: number, maximumFractionDigits = 12): string {
  return new Intl.NumberFormat("es-AR", { useGrouping: false, maximumFractionDigits }).format(value);
}

const fractions = [
  { value: 0, text: "" }, { value: 1 / 4, text: "¼" }, { value: 1 / 3, text: "⅓" },
  { value: 1 / 2, text: "½" }, { value: 2 / 3, text: "⅔" }, { value: 3 / 4, text: "¾" }, { value: 1, text: "" },
];

export function formatResult(value: number, unit: Unit): string {
  if (!Number.isFinite(value)) throw new Error("El resultado no es finito.");
  const digits = unit === "kg" || unit === "lb" ? 3 : unit === "C" || unit === "F" ? 1 : 2;
  const resolution = 10 ** -digits;
  if (value > 0 && value < resolution) return `< ${numberText(resolution, digits)}`;
  if (value < 0 && value > -resolution) return `> −${numberText(resolution, digits)}`;
  if (unit === "g" && value >= 1) return numberText(Math.round(value / (value >= 100 ? 5 : 1)) * (value >= 100 ? 5 : 1), 0);
  if ((unit === "cup" || unit === "tbsp" || unit === "tsp") && value > 0) {
    const whole = Math.floor(value);
    const closest = fractions.reduce((best, item) => Math.abs(whole + item.value - value) < Math.abs(whole + best.value - value) ? item : best);
    if (Math.abs(whole + closest.value - value) / value <= 0.02) {
      if (closest.value === 1) return numberText(whole + 1, 0);
      return [whole ? numberText(whole, 0) : "", closest.text].filter(Boolean).join(" ");
    }
  }
  return numberText(Object.is(value, -0) ? 0 : value, digits);
}

export function unitLabel(unit: Unit, cup: CupSize, value = 1): string {
  const plural = value === 1 ? "" : "s";
  if (unit === "cup") return `taza${plural} (${numberText(cup)} ml)`;
  if (unit === "tsp") return `cucharadita${plural} (5 ml)`;
  if (unit === "tbsp") return `cucharada${plural} (15 ml)`;
  if (unit === "l") return `litro${plural}`;
  return units[unit].label;
}

export function describeInput(value: number, unit: Unit, cup: CupSize): string {
  // Preserve the interpreted amount: never reuse the rounded output formatter here.
  const amount = value !== 0 && Math.abs(value) < 1e-12
    ? value.toExponential().replace(".", ",") : numberText(value, 20);
  return `${amount} ${unitLabel(unit, cup, value)}`;
}
