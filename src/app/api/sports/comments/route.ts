import { mutateSportsComment, readSportsComments } from "@/lib/sports/server";
export const runtime = "nodejs";
export async function GET(request: Request) { return readSportsComments(request); }
export async function POST(request: Request) { return mutateSportsComment(request); }
