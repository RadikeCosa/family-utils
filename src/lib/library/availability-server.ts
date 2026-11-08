import { NextResponse } from "next/server";
import { getPool } from "@/db";
import { getMemberContext } from "@/lib/auth/context";
import { availabilityEnabled } from "./config";
import { AvailabilityError, AvailabilityStore } from "./availability-store";
import { keys, object } from "./availability";
import { UUID_PATTERN } from "./rules";

export async function availabilityEndpoint(
  request: Request,
  command:
    | "platforms"
    | "createPlatform"
    | "editPlatform"
    | "read"
    | "preview"
    | "commit",
  workId?: string,
) {
  if (!availabilityEnabled())
    return NextResponse.json(
      { code: "NOT_FOUND", error: "No encontrado." },
      { status: 404 },
    );
  try {
    const origin = request.headers.get("origin");
    if (
      request.method !== "GET" &&
      origin &&
      origin !== new URL(request.url).origin
    )
      throw new AvailabilityError(403, "NO_ACCESS", "Origen no permitido.");
    const actor = await getMemberContext(request.headers);
    if (!actor)
      throw new AvailabilityError(403, "NO_ACCESS", "Ingresá a tu familia.");
    if (workId && !UUID_PATTERN.test(workId))
      throw new AvailabilityError(400, "INVALID", "Identificador inválido.");
    const store = new AvailabilityStore(getPool(), actor);
    if (command === "platforms")
      return NextResponse.json(await store.platforms(), {
        headers: { "Cache-Control": "private, no-store" },
      });
    if (command === "read")
      return NextResponse.json(await store.availability(workId!), {
        headers: { "Cache-Control": "private, no-store" },
      });
    let raw: unknown;
    const reader = request.body?.getReader();
    let length = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 1048576) {
            await reader.cancel();
            throw new AvailabilityError(
              413,
              "TOO_LARGE",
              "La carga no puede superar 1 MB.",
            );
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new AvailabilityError(400, "INVALID", "Ingresá un JSON válido.");
    }
    let result: unknown;
    if (command === "preview") result = await store.preview(raw);
    else if (command === "commit") {
      if (
        !object(raw) ||
        !keys(raw, ["previewId", "proposalHash", "idempotencyKey"]) ||
        typeof raw.previewId !== "string" ||
        !UUID_PATTERN.test(raw.previewId) ||
        typeof raw.proposalHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(raw.proposalHash) ||
        typeof raw.idempotencyKey !== "string" ||
        !UUID_PATTERN.test(raw.idempotencyKey)
      )
        throw new AvailabilityError(400, "INVALID", "Confirmación inválida.");
      result = await store.commit({
        previewId: raw.previewId,
        proposalHash: raw.proposalHash,
        idempotencyKey: raw.idempotencyKey,
      });
    } else if (
      command === "createPlatform" &&
      object(raw) &&
      keys(raw, ["action"]) &&
      raw.action === "initialize"
    )
      result = await store.initialize();
    else result = await store.platform(raw, command === "editPlatform");
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AvailabilityError)
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: error.status },
      );
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (["23505", "23514", "23503"].includes(code))
      return NextResponse.json(
        {
          code: "CONFLICT",
          error:
            "Los datos cambiaron o incumplen una restricción. Revisá la propuesta.",
        },
        { status: 409 },
      );
    if (
      error instanceof Error &&
      !code &&
      [
        "Usá ",
        "Hay películas",
        "Revisá ",
        "La cobertura",
        "Versión de plataforma",
      ].some((prefix) => error.message.startsWith(prefix))
    )
      return NextResponse.json(
        { code: "INVALID", error: error.message },
        { status: 400 },
      );
    console.error("availability_failed", { code });
    return NextResponse.json(
      {
        code: "UNAVAILABLE",
        error:
          "No pudimos completar la operación. Conservamos los datos y podés reintentar la misma confirmación.",
      },
      { status: 503 },
    );
  }
}
