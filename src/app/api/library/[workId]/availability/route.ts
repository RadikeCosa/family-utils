import { availabilityEndpoint } from "@/lib/library/availability-server";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ workId: string }> },
) {
  return availabilityEndpoint(request, "read", (await context.params).workId);
}
