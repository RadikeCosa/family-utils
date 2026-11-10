"use client";
import { createAuthClient as createClient } from "better-auth/react";
import { clearLibraryDrafts } from "./library/drafts";
import { captureNavigationCleanup } from "./navigation/client";
export function createAuthClient() {
  const client = createClient();
  return new Proxy(client, {
    get(target, key) {
      if (key === "signOut")
        return (...args: Parameters<typeof client.signOut>) => {
          clearLibraryDrafts();
          const cleanupNavigation = captureNavigationCleanup();
          return target.signOut(...args).then((result) => {
            if (!result.error) cleanupNavigation();
            return result;
          });
        };
      return Reflect.get(target, key);
    },
  });
}
