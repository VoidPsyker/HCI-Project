import { useEffect, useRef } from "react";

export function useDialogFocus(open: boolean, onEscape?: () => void, identity?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]'));
    (controls()[0] ?? dialog).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && escapeRef.current) {
        event.preventDefault();
        escapeRef.current();
      }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement && previous.isConnected && !previous.closest("[inert]")) previous.focus();
    };
  }, [open, identity]);
  return ref;
}
