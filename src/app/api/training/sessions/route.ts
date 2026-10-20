import { readTraining, mutateTraining } from "@/lib/training/server";
export const runtime = "nodejs";
export async function GET(request: Request) { return readTraining(request, "sessions"); }
export async function POST(request: Request) { return mutateTraining(request, "sessions"); }
