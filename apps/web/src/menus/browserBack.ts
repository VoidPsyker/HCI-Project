import { useEffect, useRef } from "react";

const HISTORY_KEY = "meridianMenu";

export type BackSource = "control" | "browser";

/**
 * Keeps browser Back inside the menu: each Back moves one semantic level up
 * and is logged by the menu's own handler. A fresh entry is pushed so a
 * second Back is still caught rather than leaving the trial page.
 */
export function useBrowserBack(onBack: (source: BackSource) => void): void {
  const handlerRef = useRef(onBack);
  handlerRef.current = onBack;
  const markerRef = useRef<string | null>(null);
  if (!markerRef.current) {
    markerRef.current = `menu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  useEffect(() => {
    const marker = markerRef.current ?? "menu";
    const pathname = window.location.pathname;
    const state = window.history.state as Record<string, unknown> | null;
    // Reuse the sentinel left by an earlier menu on this page instead of growing history on every mount.
    if (!state?.[HISTORY_KEY]) {
      window.history.pushState({ ...(state ?? {}), [HISTORY_KEY]: marker }, "");
    }
    const onPop = () => {
      if (window.location.pathname !== pathname) return;
      handlerRef.current("browser");
      const current = window.history.state as Record<string, unknown> | null;
      window.history.pushState({ ...(current ?? {}), [HISTORY_KEY]: marker }, "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
