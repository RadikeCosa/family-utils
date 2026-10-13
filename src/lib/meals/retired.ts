import { NextResponse } from "next/server";
import { getMemberContext } from "@/lib/auth/context";

/** Old clients must reload rather than mutate the preserved source records. */
export async function retiredMealMutation(request: Request) {
  if (!await getMemberContext(request.headers)) return NextResponse.json({ error: "No family access" }, { status: 403 });
  return NextResponse.json({ code: "MEAL_CLIENT_RETIRED", error: "El planificador cambió. Actualizá la página para usar Menús diarios." }, { status: 410 });
}
