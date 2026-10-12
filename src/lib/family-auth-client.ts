"use client";
import { createAuthClient as createClient } from "better-auth/react";
import { clearLibraryDrafts } from "./library/drafts";
export function createAuthClient() {
  const client = createClient();
  return new Proxy(client, { get(target, key) {
    if (key === "signOut") return (...args: Parameters<typeof client.signOut>) => { clearLibraryDrafts(); return target.signOut(...args); };
    return Reflect.get(target, key);
  } });
}
