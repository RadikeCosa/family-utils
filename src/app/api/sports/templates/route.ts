import { resultsTemplate } from "@/lib/sports/results-server";
import { getMemberContext } from "@/lib/auth/context";
import { sportsFeatures } from "@/lib/sports/config";
import { agendaExample, singleUfcCardExample } from "@/lib/sports/templates";
import { importUfcOdds, ufcOddsTemplate } from "@/lib/sports/ufc-odds-server";
export async function GET(request: Request) {
  if (!sportsFeatures().agenda && !(process.env.SPORTS_ENABLED === "true" && new URL(request.url).searchParams.get("kind") === "ufc-card"))
    return Response.json({ error: "No encontrado." }, { status: 404 });
  if (new URL(request.url).searchParams.get("kind") === "results")
    return resultsTemplate(request);
  if (new URL(request.url).searchParams.get("kind") === "odds")
    return ufcOddsTemplate(request);
  const actor = await getMemberContext(request.headers);
  if (!actor || actor.role !== "administrator")
    return Response.json({ error: "Solo administración." }, { status: 403 });
  return Response.json(new URL(request.url).searchParams.get("kind") === "ufc-card" ? singleUfcCardExample() : agendaExample(), {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(request: Request) {
  return importUfcOdds(request);
}
