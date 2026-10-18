import { loadUfcDashboard } from "@/lib/sports/ufc-dashboard-server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return loadUfcDashboard(request);
}
