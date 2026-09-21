import { useEffect, useRef, type ReactNode } from "react";
import { Legend } from "./legend";

interface FullscreenShotProps {
  /** The screenshot, drawn as large as the window allows. */
  children: ReactNode;
  /** The item being checked, shown beside the screenshot instead of the hint. */
  inspector?: ReactNode;
  onClose: () => void;
}

/** The screenshot filling the window, with the legend beside it (under it when the window is narrow). */
export function FullscreenShot({ children, inspector, onClose }: FullscreenShotProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  // A modal dialog brings Escape, the backdrop and a focus trap with it.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={`fullscreen ${inspector ? "fullscreen--checking" : ""}`}
      aria-label="The screenshot, fullscreen"
      onClose={onClose}
      // A click on the backdrop lands on the dialog itself.
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="fullscreen__stage">{children}</div>
      <div className="fullscreen__side">
        <Legend />
        {inspector ?? <p className="fullscreen__hint">Click an item to correct it.</p>}
        <button type="button" className="button fullscreen__close" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </div>
    </dialog>
  );
}
