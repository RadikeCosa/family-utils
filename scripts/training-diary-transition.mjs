// Run only after deploying the compatible reader/API to every serving instance.
import pg from "pg";
const required = ["--activate", "--confirm-compatible-deploy", "--confirm-backup", "--confirm-observability", "--confirm-performance"];
if (!required.every(flag => process.argv.includes(flag)) || process.env.TRAINING_DIARY_ENABLED !== "true") throw new Error(`Requires TRAINING_DIARY_ENABLED=true and ${required.join(" ")}. Enabling the flag alone never activates the diary.`);
const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error("Provide the explicit direct migrator connection in DATABASE_URL_UNPOOLED. This script does not load .env files.");
const pool = new pg.Pool({ connectionString });
try { await pool.query("SELECT public.training_diary_transition()"); console.log("Diary transition verified and committed. Keep the compatible reader available for rollback."); }
finally { await pool.end(); }
