import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * "invalid" popup centered on its input box.
 *
 * Rendered into `document.body` with fixed positioning (from the anchor's
 * bounding rect), so table `overflow-hidden` cards can never clip it.
 * Horizontally centered on the field, just below it. Auto-dismisses after a
 * few seconds, on scroll/resize, on Escape, or via the close button. Remount
 * it with a fresh `key` to re-trigger for repeated invalid keystrokes.
 */
export function InvalidPopup({
  anchorRef,
  message,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  message: string;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; center: number } | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Half of max-w-52 (13rem = 208px) keeps the bubble on screen.
    const center = Math.max(112, Math.min(r.left + r.width / 2, window.innerWidth - 112));
    setPos({ top: r.bottom + 6, center });
  }, [anchorRef]);

  useEffect(() => {
    const timer = setTimeout(onClose, 3500);
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!pos) return null;
  return createPortal(
    <div
      role="alert"
      style={{ position: "fixed", top: pos.top, left: pos.center, transform: "translateX(-50%)" }}
      className="z-50 flex max-w-52 items-start gap-2 rounded-md border border-reject/50 bg-reject-wash px-3 py-2 text-xs font-semibold text-reject shadow-lg"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="Dismiss invalid warning"
        onClick={onClose}
        className="leading-none opacity-70 hover:opacity-100"
      >
        ✕
      </button>
    </div>,
    document.body,
  );
}
