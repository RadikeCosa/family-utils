import { saveSportsFormation } from "@/lib/sports/server";
export const runtime = "nodejs";
type Context = { params: Promise<{ eventId: string }> };
export async function PUT(request: Request, { params }: Context) { return saveSportsFormation(request, (await params).eventId); }
export async function DELETE(request: Request, { params }: Context) { return saveSportsFormation(request, (await params).eventId); }
