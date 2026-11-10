import { findApp, type AppDefinition } from "./catalog.ts";
export type Recent = { appId: string; href: string };
export function navigationKey(familyId: string, memberId: string) {
  return `family-navigation:v1:${familyId}:${memberId}`;
}
export function validDestination(
  value: string,
  apps: AppDefinition[],
): string | null {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\s\u0000-\u001f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value, "https://family.invalid");
    if (url.origin !== "https://family.invalid" || !findApp(url.pathname, apps))
      return null;
    if (
      !/^\/(?:tareas|menus|recetas(?:\/[a-zA-Z0-9-]+)?|compras(?:\/[a-zA-Z0-9-]+)?|cinemateca(?:\/[a-zA-Z0-9-]+)?|deportes(?:\/river\/campeonato|\/ufc-dashboard|\/champions\/tabla)?|entrenamiento|cocina|familia|acceso)?$/.test(
        url.pathname,
      )
    )
      return null;
    if (url.search.length > 2000) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
export function readRecents(
  storage: Pick<Storage, "getItem">,
  key: string,
  apps: AppDefinition[],
): Recent[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
      .filter((item): item is Recent => {
        if (
          !item ||
          typeof item.appId !== "string" ||
          typeof item.href !== "string" ||
          seen.has(item.appId)
        )
          return false;
        const href = validDestination(item.href, apps);
        const app =
          href &&
          findApp(new URL(href, "https://family.invalid").pathname, apps);
        if (
          !app ||
          app.id !== item.appId ||
          app.id === "home" ||
          app.id === "family"
        )
          return false;
        seen.add(item.appId);
        return true;
      })
      .slice(0, 4);
  } catch {
    return [];
  }
}
export function rememberRecent(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  apps: AppDefinition[],
  next: Recent,
) {
  try {
    storage.setItem(
      key,
      JSON.stringify(
        [
          next,
          ...readRecents(storage, key, apps).filter(
            (item) => item.appId !== next.appId,
          ),
        ].slice(0, 4),
      ),
    );
  } catch {
    /* Storage is optional. */
  }
}
export function originKey(key: string, destination: string) {
  return `${key}:origin:${destination}`;
}
export function rememberOrigin(
  storage: Pick<Storage, "setItem">,
  key: string,
  apps: AppDefinition[],
  destination: string,
  source: string,
) {
  const target = validDestination(destination, apps),
    origin = validDestination(source, apps);
  if (!target || !origin || target === origin) return;
  try {
    storage.setItem(originKey(key, target), origin);
  } catch {
    /* Storage is optional. */
  }
}
export function clearNavigation(
  local: Pick<Storage, "removeItem">,
  session: Storage,
  key: string,
) {
  try {
    local.removeItem(key);
  } catch {
    /* Storage is optional. */
  }
  try {
    for (let i = session.length - 1; i >= 0; i--) {
      const item = session.key(i);
      if (item?.startsWith(`${key}:origin:`)) session.removeItem(item);
    }
  } catch {
    /* Storage is optional. */
  }
}
