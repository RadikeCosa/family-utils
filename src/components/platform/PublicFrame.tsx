"use client";
import { Suspense, type ReactNode } from "react";
import { PlatformContext, NavigationObserver } from "./navigation";
import styles from "./platform.module.css";
const context = {
  enabled: true,
  setDetailTitle: () => {},
  recordOrigin: () => {},
};
export default function PublicFrame({ children }: { children: ReactNode }) {
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
