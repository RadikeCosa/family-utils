import { toNextJsHandler } from "better-auth/next-js";
import { createAuth } from "@/lib/auth/server";

export const runtime = "nodejs";

async function handle(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (request.method === "POST" && (path.endsWith("/sign-in/anonymous") || path.endsWith("/delete-anonymous-user"))) {
    return Response.json({ message: "Use the in-app family access flow" }, { status: 404 });
  }
  const auth = createAuth();
  const handler = toNextJsHandler(auth);
  return request.method === "GET" ? handler.GET(request) : handler.POST(request);
}

export const GET = handle;
export const POST = handle;
