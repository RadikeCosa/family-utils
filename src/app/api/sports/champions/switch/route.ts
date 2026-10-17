import { readChampionsSwitch, writeChampionsSwitch } from "@/lib/sports/champions-switch-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) { return readChampionsSwitch(request); }
export async function PUT(request: Request) { return writeChampionsSwitch(request); }
