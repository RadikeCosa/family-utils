import { availabilityEndpoint } from "@/lib/library/availability-server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return availabilityEndpoint(request, "platforms");
}
export async function POST(request: Request) {
  return availabilityEndpoint(request, "createPlatform");
}
export async function PATCH(request: Request) {
  return availabilityEndpoint(request, "editPlatform");
}
