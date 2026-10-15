import { resultsTemplate } from "@/lib/sports/results-server";
import { getMemberContext } from "@/lib/auth/context";
import { sportsFeatures } from "@/lib/sports/config";
import { agendaExample } from "@/lib/sports/templates";
export async function GET(request: Request) {
  if (!sportsFeatures().agenda)
    return Response.json({ error: "No encontrado." }, { status: 404 });
  if (new URL(request.url).searchParams.get("kind") === "results")
    return resultsTemplate(request);
  const actor = await getMemberContext(request.headers);
  if (!actor || actor.role !== "administrator")
    return Response.json({ error: "Solo administración." }, { status: 403 });
  return Response.json(agendaExample(), {
    headers: { "Cache-Control": "no-store" },
  });
}
