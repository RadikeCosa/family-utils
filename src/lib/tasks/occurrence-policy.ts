export type OccurrencePolicy = "expires_daily" | "carry_forward";

export function occurrencePolicyValues(policy: OccurrencePolicy) {
  return { carryPolicySnapshot: policy, carryForward: policy === "carry_forward" };
}
