"use client";

import { clearNavigation } from "./storage";

let activeScope: string | null = null;
let registration = 0;

export function registerNavigationScope(scope: string | null) {
  const token = ++registration;
  activeScope = scope;
  return () => {
    if (registration === token) activeScope = null;
  };
}

// Capture before the auth request: a caller's success callback can navigate away
// and unmount the current frame before the sign-out promise resolves.
export function captureNavigationCleanup() {
  const scope = activeScope;
  return () => {
    if (!scope || typeof window === "undefined") return;
    try {
      clearNavigation(window.localStorage, window.sessionStorage, scope);
    } catch {
      // Navigation storage is optional, including when the browser blocks it.
    }
  };
}
