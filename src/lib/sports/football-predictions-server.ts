import { getPool } from "@/db";
import { createAuth } from "@/lib/auth/server";
import { sportsFeatures } from "./config";
import { SPORTS_UUID } from "./rules";
import { privateHeaders, reject, sportsActor, sportsBody, sportsResponseError } from "./request";

export type FootballChoice = "home" | "draw" | "away";
export type FootballPredictionView = {
  eventId: string;
  closesAt: string | null;
  closed: boolean;
  canPredict: boolean;
  ownChoice: FootballChoice | null;
  choices: Array<{ memberId: string; name: string; choice: FootballChoice }>;
};

// This adapter does not read predictions or decide deadlines/privacy in JavaScript.
export async function footballPredictions(request: Request, eventId: string) {
  if (!sportsFeatures().agenda || process.env.SPORTS_CHAMPIONS_ENABLED !== "true")
    return Response.json({ error: "No encontrado." }, { status: 404, headers: privateHeaders });
  try {
    await sportsActor(request);
    if (!SPORTS_UUID.test(eventId)) reject(400, "Identificador inválido.");
    const session = await createAuth().api.getSession({ headers: request.headers });
    if (!session) reject(403, "Ingresá a tu familia.");
    const action = request.method === "GET" ? "read" : request.method === "PUT" ? "put" : "delete";
    const body = action === "put" ? await sportsBody(request) : null;
    if (body && (Object.hasOwn(body, "memberId") || Object.hasOwn(body, "familyId")))
      reject(400, "Solo podés modificar tu propio pronóstico.");
    const choice = typeof body?.choice === "string" ? body.choice : null;
    // One statement/transaction: even a rejected late write commits the lazy closure.
    const { rows: [row] } = await getPool().query<{ response: { status: number; data: FootballPredictionView | { error: string } } }>(
      "SELECT public.sports_football_predictions_api($1,$2,$3,$4) AS response",
      [session.session.token, eventId, action, choice],
    );
    return Response.json(row.response.data, { status: row.response.status, headers: privateHeaders });
  } catch (error) {
    const response = sportsResponseError(error);
    for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
    return response;
  }
}
