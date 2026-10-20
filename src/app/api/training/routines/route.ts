import { readTraining, mutateTraining } from "@/lib/training/server";
export const runtime = "nodejs";
export async function GET(request: Request) { return readTraining(request, "routines"); }
export async function POST(request: Request) { return mutateTraining(request, "routines"); }
