"use client";
import { Suspense, useEffect, type ReactNode } from "react";
import { registerNavigationScope } from "@/lib/navigation/client";
import { PlatformContext, NavigationObserver } from "./navigation";
import styles from "./platform.module.css";
const context = {
  enabled: true,
  setDetailTitle: () => {},
  recordOrigin: () => {},
};
export default function PublicFrame({
  children,
  navigationScope = null,
}: {
  children: ReactNode;
  navigationScope?: string | null;
}) {
  useEffect(() => registerNavigationScope(navigationScope), [navigationScope]);
  return (
    <PlatformContext.Provider value={context}>
      <Suspense fallback={null}>
        <NavigationObserver />
      </Suspense>
      <div className={styles.public} data-unified-public="true">
        {children}
      </div>
    </PlatformContext.Provider>
  );
}
