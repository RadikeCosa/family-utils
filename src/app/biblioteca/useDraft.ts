"use client";
import { useState } from "react";
import { libraryDraftKey } from "@/lib/library/drafts";
export function useDraft<T extends Record<string, unknown>>(scope: string, initial: T) {
  const key = libraryDraftKey(scope);
  const [storageError, setStorageError] = useState(() => { try { sessionStorage.getItem(key); return false; } catch { return true; } });
  const [draft, update] = useState<T>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (value && Object.keys(initial).every((field) => typeof value[field] === typeof initial[field] && Array.isArray(value[field]) === Array.isArray(initial[field]))) return value;
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
