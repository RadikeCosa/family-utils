import assert from "node:assert/strict";
import { test } from "node:test";
import { ingredients, US_CUP_ML } from "./ingredients.ts";
import { applyFraction, convert, describeInput, formatResult, needsIngredient, parseQuantity, units, type Unit } from "./conversion.ts";

const flour = ingredients.find(item => item.id === "flour")!;
const water = ingredients.find(item => item.id === "water")!;
function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

test("decimal input never treats a point as a grouping separator", () => {
  for (const [input, expected] of [["1.000", 1], ["1,000", 1], ["1250", 1250], ["1.5", 1.5], ["1,5", 1.5], [".5", 0.5], [",5", 0.5], ["-.5", -0.5], [" 0 ", 0], ["-40", -40]] as const) assert.equal(parseQuantity(input), expected);
  for (const input of ["", " ", "1.000,5", "1,000.5", "1.000.000", "1 000", "NaN", "Infinity", "1e3", "1/0", "a", "1/2/3", "1,", "9".repeat(400)]) assert.equal(parseQuantity(input), null, input);
});

test("fractions and shortcuts preserve the integer and replace the fraction", () => {
  assert.equal(parseQuantity("1/2"), 0.5);
  assert.equal(parseQuantity("1 1/2"), 1.5);
  assert.equal(parseQuantity("3/2"), 1.5);
  assert.equal(parseQuantity("-1 1/2"), -1.5);
  assert.equal(parseQuantity("-1/2"), -0.5);
  assert.equal(parseQuantity("1 ½"), 1.5);
  assert.equal(parseQuantity("1½"), 1.5);
  assert.equal(parseQuantity("-½"), -0.5);
  close(parseQuantity("⅓")!, 1 / 3);
  assert.equal(applyFraction("", "1/2"), "1/2");
  assert.equal(applyFraction("1", "1/2"), "1 1/2");
  assert.equal(applyFraction("1 3/4", "1/2"), "1 1/2");
  assert.equal(applyFraction("1,9", "1/4"), "1 1/4");
  assert.equal(applyFraction("1 1/2", "1/2"), "1 1/2");
});

test("known mass, volume and temperature conversions", () => {
  close(convert(1, "kg", "g"), 1000);
  close(convert(1, "lb", "oz"), 16);
  close(convert(1, "oz", "g"), 28.349523125);
  close(convert(1, "l", "ml"), 1000);
  close(convert(1, "tbsp", "tsp"), 3);
  close(convert(180, "C", "F"), 356);
  close(convert(-40, "F", "C"), -40);
  close(convert(32, "F", "C"), 0);
  close(convert(0, "ml", "g", 250, water), 0);
  close(convert(100, "ml", "g", 250, ingredients.find(item => item.id === "milk")), 103);
  close(convert(100, "ml", "g", 250, ingredients.find(item => item.id === "oil")), 92);
  assert.equal(needsIngredient("cup", "g"), true);
  assert.equal(needsIngredient("g", "kg"), false);
});

test("US source density scales with cup volume and rounds only at presentation", () => {
  close(convert(1, "cup", "g", US_CUP_ML, flour), 120);
  close(convert(1, "cup", "g", 240, flour), 120 / US_CUP_ML * 240);
  close(convert(1, "cup", "g", 250, flour), 120 / US_CUP_ML * 250);
  assert.equal(formatResult(convert(1, "cup", "g", 240, flour), "g"), "120");
  assert.equal(formatResult(convert(1, "cup", "g", 250, flour), "g"), "125");
  assert.equal(formatResult(convert(1, "cup", "kg", 250, flour), "kg"), "0,127");
  close(convert(250, "ml", "g", 250, water), 250);
});

test("all supported measurement pairs round trip before formatting", () => {
  const measurements = (Object.keys(units) as Unit[]).filter(unit => units[unit].kind !== "temperature");
  for (const from of measurements) for (const to of measurements) {
    const result = convert(1.2345, from, to, 240, flour);
    close(convert(result, to, from, 240, flour), 1.2345);
  }
});

test("incompatible, missing, negative and overflowing conversions fail", () => {
  assert.throws(() => convert(1, "cup", "g"));
  assert.throws(() => convert(1, "C", "g"));
  assert.throws(() => convert(-1, "g", "kg"));
  assert.throws(() => convert(Infinity, "g", "kg"));
  assert.throws(() => convert(Number.MAX_VALUE, "kg", "g"));
  assert.throws(() => convert(1, "cup", "g", 250, { ...flour, density: 0 }));
  assert.throws(() => formatResult(NaN, "g"));
});

test("rounding boundaries, fractions and tiny quantities", () => {
  for (const [value, unit, expected] of [
    [99.4, "g", "99"], [99.8, "g", "100"], [100, "g", "100"], [102.5, "g", "105"],
    [0.125, "g", "0,13"], [0.001, "g", "< 0,01"], [0.0001, "kg", "< 0,001"], [0, "g", "0"],
    [-0.01, "C", "> −0,1"], [-40, "C", "-40"], [1.5, "cup", "1 ½"], [1 / 3, "tbsp", "⅓"],
    [0.51, "cup", "½"], [0.52, "cup", "0,52"], [0.1, "tsp", "0,1"], [0.99, "cup", "1"],
  ] as const) assert.equal(formatResult(value, unit), expected, `${value} ${unit}`);
});

test("no output contains grouping points; decimal output can be pasted as input", () => {
  for (const unit of Object.keys(units) as Unit[]) for (const value of [0, 0.52, 1250, 12345.67, 1e25]) {
    const formatted = formatResult(value, unit);
    assert.ok(!formatted.includes("."), `${formatted} ${unit}`);
    if (!/[¼⅓½⅔¾<>]/.test(formatted)) assert.notEqual(parseQuantity(formatted), null);
  }
  assert.equal(formatResult(1250, "ml"), "1250");
  assert.equal(parseQuantity(formatResult(1250, "ml")), 1250);
  assert.equal(describeInput(parseQuantity("1.000")!, "cup", 250), "1 taza (250 ml)");
  assert.equal(describeInput(parseQuantity("1 1/2")!, "cup", 250), "1,5 tazas (250 ml)");
});

test("culinary output can be pasted back into the quantity field", () => {
  for (const value of [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1.5, 2.75]) {
    close(parseQuantity(formatResult(value, "cup"))!, value);
  }
});

test("catalog is complete, traceable and has plausible densities", () => {
  assert.equal(ingredients.length, 14);
  assert.equal(new Set(ingredients.map(item => item.id)).size, ingredients.length);
  for (const item of ingredients) {
    assert.ok(Number.isFinite(item.density) && item.density >= 0.3 && item.density <= 1.5, item.id);
    assert.ok(item.name && item.originalMeasure && item.note && item.sourceName, item.id);
    assert.equal(new URL(item.source).protocol, "https:");
  }
});
