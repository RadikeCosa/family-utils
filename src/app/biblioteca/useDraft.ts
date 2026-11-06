"use client";
import { useState } from "react";
import { libraryDraftKey, restoreLibraryDraft } from "@/lib/library/drafts";
export function useDraft<T extends Record<string, unknown>>(scope: string, initial: T) {
  const key = libraryDraftKey(scope);
  const [storageError, setStorageError] = useState(() => { try { sessionStorage.getItem(key); return false; } catch { return true; } });
  const [draft, update] = useState<T>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
      return restoreLibraryDraft(initial, value);
    } catch { /* Keep an in-memory draft. */ }
    return initial;
  });
  function setDraft(value: T) {
    update(value);
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { setStorageError(true); }
  }
  function clearDraft() { try { sessionStorage.removeItem(key); } catch { /* Nothing persisted. */ } }
  return { draft, setDraft, clearDraft, storageError };
}
