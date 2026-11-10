import { getPool } from "@/db";
export async function diaryTransitioned(): Promise<boolean> {
  try {
    const { rows } = await getPool().query("SELECT transitioned_at IS NOT NULL AS active FROM training_diary_state WHERE singleton=true");
    return rows[0]?.active === true;
  } catch (error) {
    // The compatibility release can be deployed before the additive migration.
    if ((error as { code?: string }).code === "42P01") return false;
    throw error;
  }
}
