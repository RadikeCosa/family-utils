"use client";
import { useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("family-navigation", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("family-navigation", callback);
  };
}
/** Recipe URL state also works before the platform-wide navigation is enabled. */
export function useRecipeQuery() {
  useSearchParams();
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  return new URLSearchParams(search);
}
