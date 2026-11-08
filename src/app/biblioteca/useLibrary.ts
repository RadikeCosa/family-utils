"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { libraryIssueMessage, type OperationIssue } from "@/lib/library/form-errors";
import type { LibraryCollection, LibraryDetail } from "@/lib/library/types";
import { clearLibraryDrafts } from "@/lib/library/drafts";
export type LibraryData = LibraryCollection | LibraryDetail;
export function useLibrary(workId: string | undefined, filters: string, onMemberUnavailable?: () => void) {
  const router = useRouter();
  const [data, setData] = useState<LibraryData | null>(null);
  const [error, setError] = useState("");
  const [readErrorCode, setReadErrorCode] = useState("");
  const [duplicates, setDuplicates] = useState<{ id: string; title: string; archivedAt: string | null }[]>([]);
  const [operationIssue, setOperationIssue] = useState<OperationIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);
  const current = useRef<LibraryData | null>(null);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const etag = useRef("");
  const endpoint = `/api/library${workId ? `/${workId}` : ""}`;
  const read = useCallback(async function readLibraryData(mode: "replace" | "more" | "probe" = "replace"): Promise<void> {
    if (pending.current && mode !== "replace") return;
    if (mode === "replace") pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const serial = ++generation.current;
    const params = new URLSearchParams(filters);
    const cursor = current.current?.nextCursor;
    if (mode === "more" && cursor) params.set("cursor", cursor);
    if (mode === "probe" && current.current) params.set("revisionOnly", "true");
    if (mode !== "probe") setLoading(true);
    let readIssueCode: unknown;
    try {
      const response = await fetch(`${endpoint}?${params}`, { signal: controller.signal, headers: mode === "probe" && etag.current ? { "If-None-Match": etag.current } : {} });
      if (serial !== generation.current) return;
      if (response.status === 304) return;
      const body = await response.json();
      if (!response.ok) {
        readIssueCode = body.code;
        if (body.code === "MEMBER_UNAVAILABLE" && onMemberUnavailable && mode !== "probe") {
          onMemberUnavailable(); return;
        }
        if (body.code === "NOT_FOUND" && workId) {
          setOperationIssue({ code: "NOT_FOUND", status: 404, path: `/${workId}` });
          throw new Error("Este contenido ya no está disponible. Conservamos tu borrador.");
        }
        if (response.status === 403) { clearLibraryDrafts(); current.current = null; setData(null); router.replace("/acceso"); }
        throw new Error(libraryIssueMessage(body.code));
      }
      clearLibraryDrafts(`${body.familyId}:${body.currentMemberId}`);
      if (current.current && (body.familyId !== current.current.familyId || body.currentMemberId !== current.current.currentMemberId)) {
        clearLibraryDrafts(); current.current = null; setData(null); router.replace("/acceso"); router.refresh(); return;
      }
      if (mode === "probe" && current.current) { if (body.availabilityDay !== current.current.availabilityDay || body.availabilityEnabled !== current.current.availabilityEnabled) { void readLibraryData("replace"); return; } if (body.revision !== current.current.revision || body.accessRevision !== current.current.accessRevision ) setHasChanges(true); return; }
      const incoming = body as LibraryData;
      if (mode === "more" && current.current) {
        if (incoming.revision !== current.current.revision || incoming.accessRevision !== current.current.accessRevision || incoming.availabilityDay !== current.current.availabilityDay) setHasChanges(true);
        if ("works" in incoming && "works" in current.current) {
          incoming.works = [...new Map([...current.current.works, ...incoming.works].map((value) => [value.id, value])).values()];
          incoming.commonPendingCounts = current.current.commonPendingCounts;
          incoming.members = current.current.members;
        }
        if ("contributions" in incoming && "contributions" in current.current) incoming.contributions = [...new Map([...current.current.contributions, ...incoming.contributions].map((value) => [value.id, value])).values()];
        incoming.revision = current.current.revision;
        incoming.accessRevision = current.current.accessRevision;
      } else { etag.current = response.headers.get("etag") ?? ""; setHasChanges(false); }
      current.current = incoming; setData(incoming); setError(""); setReadErrorCode(""); setOperationIssue(null);
    } catch { if (!controller.signal.aborted && serial === generation.current) {
      setReadErrorCode(typeof readIssueCode === "string" ? readIssueCode : "UNAVAILABLE");
      setError(readIssueCode === "INVALID" ? "No pudimos aplicar estos filtros. Revisá la selección e intentá de nuevo." : libraryIssueMessage(readIssueCode));
    } }
    finally { if (serial === generation.current) setLoading(false); if (pending.current === controller) pending.current = null; }
  }, [endpoint, filters, router, workId, onMemberUnavailable]);
  useEffect(() => {
    current.current = null; etag.current = "";
    const start = setTimeout(() => void read(), 0);
    let lastActivity = Date.now();
    const active = () => { lastActivity = Date.now(); };
    const resume = () => { if (document.visibilityState === "visible") { lastActivity = Date.now(); void read(current.current ? "probe" : "replace"); } };
    const timer = setInterval(() => { if (document.visibilityState === "visible" && Date.now() - lastActivity < 120_000) void read(current.current ? "probe" : "replace"); }, 30_000);
    window.addEventListener("pointerdown", active, { passive: true }); window.addEventListener("keydown", active);
    window.addEventListener("focus", resume); window.addEventListener("online", resume); document.addEventListener("visibilitychange", resume);
    const serial = generation;
    return () => { clearTimeout(start); clearInterval(timer); pending.current?.abort(); serial.current++; window.removeEventListener("pointerdown", active); window.removeEventListener("keydown", active); window.removeEventListener("focus", resume); window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume); };
  }, [read]);
  const writing = useRef(false);
  async function mutate(path: string, method: string, body: unknown): Promise<{ id: string } | null> {
    if (writing.current) return null;
    const inline = !(body && typeof body === "object" && "action" in body && ["archive", "restore"].includes(String(body.action)));
    writing.current = true;
    setBusy(true); setError(""); setDuplicates([]); setOperationIssue(null);
    try {
      const response = await fetch(`/api/library${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        const code = typeof result.code === "string" ? result.code : "UNAVAILABLE";
        if (code === "DUPLICATE") setDuplicates(result.duplicates);
        else if (response.status === 409 || code === "ARCHIVED" || code === "NOT_FOUND") await read();
        setOperationIssue({ code, status: response.status, path });
        if (!inline) setError(libraryIssueMessage(code));
        if (response.status === 403) void read("probe");
        return null;
      }
      await read(); return result;
    } catch {
      setOperationIssue({ code: "UNAVAILABLE", status: 0, path });
      if (!inline) setError(libraryIssueMessage("UNAVAILABLE"));
      return null;
    } finally { writing.current = false; setBusy(false); }
  }

  return { data, error, readErrorCode, setError, duplicates, operationIssue, clearDuplicates: () => setDuplicates([]), busy, loading, hasChanges, refresh: () => read(), more: () => read("more"), mutate };
}
