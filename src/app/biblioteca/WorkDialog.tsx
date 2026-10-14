"use client";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./library.module.css";

export default function WorkDialog({ busy, shouldRestoreFocus = () => true, onRequestClose, children }: { busy: boolean; shouldRestoreFocus?: () => boolean; onRequestClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyOverflow = document.body.style.overflow;
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    element.showModal();
    const viewport = window.visualViewport;
    let restored = false;
    const syncViewport = () => {
      if (!viewport || viewport.width <= 0 || viewport.height <= 0) return;
      const availableHeight = Math.min(viewport.height, window.innerHeight);
      if (!Number.isFinite(availableHeight) || availableHeight < 180) return;
      element.style.setProperty("--dialog-available-height", `${availableHeight}px`);
      if (window.innerWidth <= 600 && viewport.height < window.innerHeight - 80) {
        element.style.top = `${Math.max(8, viewport.offsetTop + (availableHeight - element.offsetHeight) / 2)}px`;
        element.style.bottom = "auto";
        element.style.left = "50%";
        element.style.width = "calc(100vw - 16px)";
        element.style.transform = "translateX(-50%)";
      } else {
        element.style.removeProperty("top");
        element.style.removeProperty("bottom");
        element.style.removeProperty("left");
        element.style.removeProperty("width");
        element.style.removeProperty("transform");
      }
    };
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    syncViewport();
    const restore = () => {
      if (restored) return;
      restored = true;
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      element.style.removeProperty("--dialog-available-height");
      element.style.removeProperty("top");
      element.style.removeProperty("bottom");
      element.style.removeProperty("left");
      element.style.removeProperty("width");
      element.style.removeProperty("transform");
      document.body.style.overflow = bodyOverflow;
      window.scrollTo(0, scrollY);
      if (shouldRestoreFocus() && opener?.isConnected) opener.focus();
    };
    element.addEventListener("close", restore, { once: true });
    return () => {
      if (element.open) element.close();
      restore();
    };
  }, [shouldRestoreFocus]);
  return <dialog ref={dialog} className={styles.workDialog} aria-labelledby="work-dialog-title" onCancel={(event) => {
    event.preventDefault();
    if (!busy) dialog.current?.close();
  }} onClose={onRequestClose}>
    {children}
  </dialog>;
}
