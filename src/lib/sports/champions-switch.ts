import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { championsEnabled } from "./config";

// Must run inside the transaction that performs the read or write. The database
// function takes a per-family shared advisory lock until that transaction ends.
export async function familyChampionsEnabled(tx: PoolClient, familyId: string) {
  try {
    const { rows: [row] } = await tx.query<{ enabled: boolean }>(
      "SELECT public.sports_champions_enabled($1,true) AS enabled",
      [familyId],
    );
    return championsEnabled() && row?.enabled === true;
  } catch (error) {
    // A serializable snapshot that raced with the switch update is denied too.
    if (error && typeof error === "object" && "code" in error && error.code === "40001") return false;
    throw error;
  }
}

export async function storedChampionsEnabled(familyId: string) {
  const { rows: [row] } = await getPool().query<{ enabled: boolean }>(
    "SELECT public.sports_champions_enabled($1,true) AS enabled",
    [familyId],
  );
  return row?.enabled === true;
}

export function championsUnavailable() {
  return Response.json({ error: "No encontrado." }, {
    status: 404,
    headers: { "Cache-Control": "no-store", Vary: "Cookie" },
  });
}
