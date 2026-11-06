export function cinematecaUrl(params: Record<string, string | string[] | undefined>, workId?: string) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (["kind", "type", "cursor"].includes(key) || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  return `/cinemateca${workId ? `/${encodeURIComponent(workId)}` : ""}${query.size ? `?${query}` : ""}`;
}
