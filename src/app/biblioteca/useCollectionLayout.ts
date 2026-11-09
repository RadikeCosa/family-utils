"use client";
import { useSyncExternalStore } from "react";

type CollectionLayout = "cards" | "list";
const storageKey = "cinemateca:collection-layout";
const changeEvent = "cinemateca:collection-layout-change";
let fallback: CollectionLayout | undefined;

function getSnapshot(): CollectionLayout {
  if (fallback) return fallback;
  try {
    const saved = localStorage.getItem(storageKey);
    return saved === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}
function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) { fallback = undefined; notify(); }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, notify);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changeEvent, notify);
  };
}
function getServerSnapshot(): CollectionLayout { return "cards"; }

export function useCollectionLayout() {
  const layout = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  function setLayout(next: CollectionLayout) {
    try { localStorage.setItem(storageKey, next); fallback = undefined; } catch { fallback = next; }
    window.dispatchEvent(new Event(changeEvent));
  }
  return { layout, setLayout };
}
