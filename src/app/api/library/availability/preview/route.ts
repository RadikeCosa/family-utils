import { availabilityEndpoint } from "@/lib/library/availability-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return availabilityEndpoint(request, "preview");
}
