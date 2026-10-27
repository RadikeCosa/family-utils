import type { DailyPlan } from "./daily.ts";
import { MEAL_TYPES, type MealType } from "./rules.ts";

type PresentedMeal = { plan: DailyPlan; readOnly: boolean };

/** Completion describes dishes only; attendance and historical dates are independent. */
export function mealChoiceState(meal: PresentedMeal) {
  if (meal.readOnly) return { complete: false, label: "Revisar plan anterior" };
  const missing = meal.plan.menus.filter(menu => !menu.selection);
  if (meal.plan.menus.length > 0 && missing.length === 0) return { complete: true, label: "Elegida" };
  if (missing.length === meal.plan.menus.length) return { complete: false, label: "Sin elegir" };
  return { complete: false, label: `Falta elegir opción ${missing[0].number}` };
}

export function countChosenMeals(meals: (PresentedMeal & { date: string; mealType: MealType })[], date: string) {
  return MEAL_TYPES.filter(type => {
    const meal = meals.find(meal => meal.date === date && meal.mealType === type);
    return meal && mealChoiceState(meal).complete;
  }).length;
}
