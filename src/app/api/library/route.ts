import { mutateLibrary, readLibrary } from "@/lib/library/server";
export const runtime = "nodejs";
export async function GET(request: Request) { return readLibrary(request); }
export async function POST(request: Request) { return mutateLibrary(request, "create"); }
