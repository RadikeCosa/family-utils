import { setSportsWeek } from "@/lib/sports/server";
export const runtime = "nodejs";
export async function PUT(request: Request) { return setSportsWeek(request); }
