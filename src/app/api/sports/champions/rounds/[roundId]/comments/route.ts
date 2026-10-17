import { championsComments } from "@/lib/sports/champions-comments-server";
export const runtime = "nodejs";
type Context = { params: Promise<{ roundId: string }> };
export async function GET(request: Request, { params }: Context) { return championsComments(request, (await params).roundId); }
export async function POST(request: Request, { params }: Context) { return championsComments(request, (await params).roundId); }
