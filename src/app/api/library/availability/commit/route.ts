import { availabilityEndpoint } from "@/lib/library/availability-server";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  return availabilityEndpoint(request, "commit");
}
