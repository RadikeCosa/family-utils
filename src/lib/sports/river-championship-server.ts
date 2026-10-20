import "server-only";
import snapshot from "./river-championship-snapshot.json";
import { parseRiverChampionship } from "./river-championship-rules";

export function loadRiverChampionship() {
  const data = parseRiverChampionship(snapshot);
  if (!data) throw new Error("Invalid curated River championship snapshot");
  return data;
}
