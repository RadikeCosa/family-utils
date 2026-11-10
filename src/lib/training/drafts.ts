import type { DiaryInput } from "./diary";
const PREFIX = "family-training-handoff:v1:", CHANNEL = "family-training-identity:v1";
export const HANDOFF_TTL = 30 * 60_000;
export interface TrainingHandoff { scope: string; expiresAt: number; input: DiaryInput; entryId?: string }
export function clearTrainingHandoffs() {
  if (typeof window === "undefined") return;
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) sessionStorage.removeItem(key); } catch { /* Optional storage. */ }
}
export function notifyTrainingIdentity(scope: string | null) {
  clearTrainingHandoffs();
  try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage({ scope }); channel.close(); } catch { /* Optional browser capability. */ }
}
export function announceTrainingIdentity(scope: string | null) {
  if (typeof window === "undefined") return;
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX) && JSON.parse(sessionStorage.getItem(key)!).scope !== scope) sessionStorage.removeItem(key); } catch { clearTrainingHandoffs(); }
  try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage({ scope }); channel.close(); } catch { /* Optional browser capability. */ }
}
export function watchTrainingIdentity(scope: string): () => void {
  let channel: BroadcastChannel | undefined;
  const cleanup = () => { try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) { const saved = JSON.parse(sessionStorage.getItem(key)!); if (saved.scope !== scope || saved.expiresAt <= Date.now()) sessionStorage.removeItem(key); } } catch { clearTrainingHandoffs(); } };
  cleanup(); const timer = setInterval(cleanup, 15_000);
  try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = e => { if (e.data?.scope !== scope) clearTrainingHandoffs(); }; channel.postMessage({ scope }); } catch { /* Storage still works within this tab. */ }
  return () => { clearInterval(timer); channel?.close(); };
}
export function saveTrainingHandoff(scope: string, input: DiaryInput, entryId?: string): boolean {
  try { clearTrainingHandoffs(); sessionStorage.setItem(`${PREFIX}${scope}:session`, JSON.stringify({ scope, input, entryId, expiresAt: Date.now() + HANDOFF_TTL })); return true; } catch { return false; }
}
export function readTrainingHandoff(scope: string): TrainingHandoff | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`${PREFIX}${scope}:session`) ?? "null");
    if (!saved || saved.scope !== scope || typeof saved.expiresAt !== "number" || saved.expiresAt <= Date.now() || !saved.input) { clearTrainingHandoffs(); return null; }
    return saved;
  } catch { clearTrainingHandoffs(); return null; }
}
