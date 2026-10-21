// Server entrypoints only. Disabled until migration, backup and release checks pass.
export function trainingEnabled() { return process.env.TRAINING_ENABLED === "true"; }
export function optionalTrainingMetricsEnabled() { return process.env.TRAINING_OPTIONAL_METRICS_ENABLED === "true"; }
export function optionalTrainingMetricsFormEnabled() { return process.env.TRAINING_OPTIONAL_METRICS_FORM_ENABLED === "true"; }
