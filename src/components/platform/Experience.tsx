import { Suspense, cache, type ReactNode } from "react";
import { headers } from "next/headers";
import { getMemberContext } from "@/lib/auth/context";
import { recipesEnabled } from "@/lib/recipes/config";
import { libraryEnabled } from "@/lib/library/config";
import { trainingEnabled } from "@/lib/training/config";
import { sportsEnabled, championsEnabled } from "@/lib/sports/config";
import { unifiedUIEnabled } from "@/lib/navigation/config";
import { navigationKey } from "@/lib/navigation/storage";
import { appCatalog } from "@/lib/navigation/catalog";
import { NavigationObserver } from "./navigation";
import PublicFrame from "./PublicFrame";
import PlatformShell from "./PlatformShell";
import styles from "./platform.module.css";
export const getExperience = cache(async () => {
  const actor = await getMemberContext(await headers());
  return { actor, enabled: unifiedUIEnabled(actor?.memberId) };
});
export default async function Experience({
  children,
  home = false,
  publicOnly = false,
}: {
  children: ReactNode;
  home?: boolean;
  publicOnly?: boolean;
}) {
  const { actor, enabled } = await getExperience();
  if (!enabled)
    return (
      <>
        <Suspense fallback={null}>
          <NavigationObserver />
        </Suspense>
        <Suspense>{children}</Suspense>
      </>
    );
  const apps = appCatalog({
    recipes: recipesEnabled(),
    library: libraryEnabled(),
    sports: sportsEnabled(),
    champions: championsEnabled(),
    training: trainingEnabled(),
  });
  if (!actor || publicOnly)
    return (
      <PublicFrame
        navigationScope={
          actor ? navigationKey(actor.familyId, actor.memberId) : null
        }
      >
        <Suspense>{children}</Suspense>
      </PublicFrame>
    );
  return (
    <PlatformShell
      key={`${actor.familyId}:${actor.memberId}`}
      apps={apps}
      member={{
        familyId: actor.familyId,
        memberId: actor.memberId,
        name: actor.name,
        familyName: actor.familyName,
      }}
      home={home}
    >
      {home ? null : (
        <Suspense
          fallback={
            <div className={styles.fallback} aria-label="Cargando contenido" />
          }
        >
          {children}
        </Suspense>
      )}
    </PlatformShell>
  );
}
