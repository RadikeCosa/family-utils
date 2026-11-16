// Server entrypoints only. Disabled until migration, backup and release checks pass.
export function trainingEnabled() { return process.env.TRAINING_ENABLED === "true"; }
export function optionalTrainingMetricsEnabled() { return process.env.TRAINING_OPTIONAL_METRICS_ENABLED === "true"; }
export function optionalTrainingMetricsFormEnabled() { return process.env.TRAINING_OPTIONAL_METRICS_FORM_ENABLED === "true"; }
export function trainingDiaryEnabled() { return process.env.TRAINING_DIARY_ENABLED === "true"; }

export function trainingActivityFormEnabled() { return trainingDiaryEnabled() && process.env.TRAINING_ACTIVITY_FORM_ENABLED === "true"; }
// The timer may run read-only after the diary transition; writes remain guarded by trainingDiaryEnabled().
export function trainingHiitEnabled() { return process.env.TRAINING_HIIT_ENABLED === "true"; }
