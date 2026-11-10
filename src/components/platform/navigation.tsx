"use client";
import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useSyncExternalStore,
} from "react";
export type PlatformContextValue = {
  enabled: boolean;
  setDetailTitle: (title: string) => void;
  recordOrigin: (destination: string) => void;
};
export const PlatformContext = createContext<PlatformContextValue>({
  enabled: false,
  setDetailTitle: () => {},
  recordOrigin: () => {},
});
export function useUnifiedUI() {
  return useContext(PlatformContext).enabled;
}
function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("family-navigation", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("family-navigation", callback);
  };
}
export function useNavigationQuery() {
  const query = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
  return useMemo(() => new URLSearchParams(query), [query]);
}
// Keep the query subscription inside its own tiny Suspense boundary so it never
// postpones the first paint of the frame or the authenticated launcher.
export function NavigationObserver() {
  const path = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    window.dispatchEvent(new Event("family-navigation"));
  }, [path, search]);
  return null;
}
export function updateNavigation(
  values: Record<string, string | null>,
  mode: "push" | "replace" = "replace",
) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  const href = `${url.pathname}${url.search}${url.hash}`;
  if (
    href ===
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  )
    return;
  window.history[mode === "push" ? "pushState" : "replaceState"](
    window.history.state,
    "",
    href,
  );
  window.dispatchEvent(new Event("family-navigation"));
}
export function useDetailTitle(title: string | null | undefined) {
  const { setDetailTitle } = useContext(PlatformContext);
  useEffect(() => {
    setDetailTitle(title ?? "");
    return () => setDetailTitle("");
  }, [title, setDetailTitle]);
}
type URLValue<T> = T extends boolean ? boolean : string;
export function useURLState<T extends string | boolean>(
  key: string,
  fallback: T,
  mode: "push" | "replace" = "replace",
  allowed?: readonly string[],
): [URLValue<T>, (value: URLValue<T>) => void] {
  const { enabled, recordOrigin } = useContext(PlatformContext);
  const query = useNavigationQuery();
  const [legacy, setLegacy] = useState<string | boolean>(fallback);
  const raw = query.get(key);
  const value =
    typeof fallback === "boolean"
      ? raw === "true"
      : raw !== null && (!allowed || allowed.includes(raw))
        ? raw
        : fallback;
  return [
    (enabled ? value : legacy) as URLValue<T>,
    (next) => {
      if (!enabled) {
        setLegacy(next);
        return;
      }
      if (key === "detalle" && next) {
        const target = new URL(window.location.href);
        target.searchParams.set(key, String(next));
        recordOrigin(`${target.pathname}${target.search}`);
      }
      updateNavigation(
        { [key]: next === fallback ? null : String(next) },
        mode,
      );
    },
  ];
}
