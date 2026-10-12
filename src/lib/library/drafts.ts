const PREFIX = "family-library-draft:v1:";
export function clearLibraryDrafts(identity?: string) {
  if (typeof window === "undefined") return;
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX) && (!identity || !key.startsWith(`${PREFIX}${identity}:`))) sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}
export function libraryDraftKey(scope: string) { return `${PREFIX}${scope}`; }
