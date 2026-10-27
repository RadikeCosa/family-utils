import assert from "node:assert/strict";
import test from "node:test";
import { addSecondMenu, changePerson, emptyPlan, translateLegacy, type DailyPlan } from "./daily.ts";
import { countChosenMeals, mealChoiceState } from "./presentation.ts";
import { MEAL_TYPES } from "./rules.ts";

const selection = { suggestionId: "dish", title: "Puré", note: null, confirmedByMemberId: null, confirmedAt: null };
const state = (plan: DailyPlan, readOnly = false) => mealChoiceState({ plan, readOnly });

test("completion requires every existing option, including an unassigned second option", () => {
  const plan = emptyPlan(["alex"]);
  assert.deepEqual(state(plan), { complete: false, label: "Sin elegir" });
  plan.menus[0].selection = selection;
  assert.deepEqual(state(plan), { complete: true, label: "Elegida" });
  const two = addSecondMenu(plan);
  assert.deepEqual(state(two), { complete: false, label: "Falta elegir opción 2" });
  two.menus[1].selection = { ...selection, title: "Ensalada" };
  assert.equal(state(two).complete, true);
  two.menus[0] = { number: 1, selection: null };
  assert.deepEqual(state(two), { complete: false, label: "Falta elegir opción 1" });
  two.menus[1].selection = null;
  assert.deepEqual(state(two), { complete: false, label: "Sin elegir" });
  assert.equal(state({ menus: [], people: [] }).complete, false);
});

test("attendance changes and their reversal do not change completion", () => {
  const plan = emptyPlan(["alex"]);
  plan.menus[0].selection = selection;
  for (const status of ["home", "packed", "away", "unknown"] as const) {
    assert.deepEqual(state(changePerson(plan, "alex", status)), state(plan));
  }
});

test("incompatible legacy projection is excluded, compatible history counts normally", () => {
  const groups = [1, 2, 3].map(n => ({ id: `g${n}`, kind: "home", followsHome: false, suggestionId: `s${n}`, confirmedByMemberId: null, confirmedAt: null }));
  const previous = { memberIds: [], groups, suggestions: groups.map((g, i) => ({ id: g.suggestionId, title: `Dish ${i}`, note: null })), participants: [], attendance: [], selection: null };
  const incompatible = translateLegacy(previous);
  assert.equal(incompatible.readOnly, true);
  assert.deepEqual(mealChoiceState(incompatible), { complete: false, label: "Revisar plan anterior" });
  const compatible = translateLegacy({ ...previous, groups: [], selection });
  assert.equal(mealChoiceState(compatible).complete, true);
});

test("day counter counts zero, one or four meals and excludes other dates", () => {
  const meals = MEAL_TYPES.map(mealType => ({ date: "2026-10-27", mealType, plan: emptyPlan([]), readOnly: false }));
  assert.equal(countChosenMeals(meals, "2026-10-27"), 0);
  meals[0].plan.menus[0].selection = selection;
  assert.equal(countChosenMeals(meals, "2026-10-27"), 1);
  meals.forEach(meal => { meal.plan.menus[0].selection = selection; });
  assert.equal(countChosenMeals(meals, "2026-10-27"), 4);
  assert.equal(countChosenMeals(meals, "2026-10-28"), 0);
  meals[1].readOnly = true;
  assert.equal(countChosenMeals(meals, "2026-10-27"), 3);
  meals[1].readOnly = false;
  meals[1].plan = addSecondMenu(meals[1].plan);
  assert.equal(countChosenMeals(meals, "2026-10-27"), 3);
});
