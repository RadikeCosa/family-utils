export function unifiedUIEnabled(
  memberId?: string | null,
  env: Record<string, string | undefined> = process.env,
) {
  return (
    env.UNIFIED_UI_ENABLED === "true" ||
    (!!memberId &&
      (env.UNIFIED_UI_PREVIEW_MEMBER_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .includes(memberId))
  );
}
