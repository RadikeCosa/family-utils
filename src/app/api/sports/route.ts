import { createSportsEvent, readSportsPage } from "@/lib/sports/server";
export const runtime = "nodejs";
export async function GET(request: Request) { return readSportsPage(request); }
export async function POST(request: Request) { return createSportsEvent(request); }
