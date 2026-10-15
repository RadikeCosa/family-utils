import { sportsEnabled } from "./rules.ts";
export { sportsEnabled };
export function sportsFeatures() {
  const agenda = sportsEnabled() && process.env.SPORTS_AGENDA_ENABLED === "true";
  const results = agenda && process.env.SPORTS_RIVER_RESULTS_ENABLED === "true";
  return { agenda, results, ufc: results && process.env.SPORTS_UFC_PREDICTIONS_ENABLED === "true" };
}
