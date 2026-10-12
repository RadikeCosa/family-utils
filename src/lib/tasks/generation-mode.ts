export function taskGenerationMode(): "explicit_sync" | "legacy_today" {
  return process.env.TASK_GENERATION_MODE === "legacy_today" ? "legacy_today" : "explicit_sync";
}
