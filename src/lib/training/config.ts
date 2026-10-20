// Server entrypoints only. Disabled until migration, backup and release checks pass.
export function trainingEnabled() { return process.env.TRAINING_ENABLED === "true"; }
