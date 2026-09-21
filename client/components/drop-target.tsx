import { useEffect, useRef, useState } from "react";
import { SCAN_LIMITS } from "../../lib/scan/types";

interface DropTargetProps {
  onFile: (file: File) => void;
  onDemo?: () => void;
  busy: boolean;
  /** Compact variant shown above an existing result. */
  compact?: boolean;
}

const accepted = (file: File) => (SCAN_LIMITS.acceptedTypes as readonly string[]).includes(file.type);

/** Paste anywhere, drop on the page, or pick a file. */
export function DropTarget({ onFile, onDemo, busy, compact = false }: DropTargetProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea")) return;
      const file = [...(event.clipboardData?.files ?? [])].find(accepted);
      if (!file) return;
      event.preventDefault();
      onFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFile]);

  const pick = (files: FileList | null) => {
    const file = [...(files ?? [])].find(accepted);
    if (file) onFile(file);
  };

  return (
    <div
      className={`drop ${compact ? "drop--compact" : ""} ${dragging ? "drop--over" : ""}`}
      aria-busy={busy}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        pick(event.dataTransfer.files);
      }}
    >
      {compact ? (
        <p className="drop__lead">
          <kbd>Ctrl</kbd> <kbd>V</kbd> another case, or drop a screenshot here
        </p>
      ) : (
        <>
          <CaseArt />
          <h1 className="drop__title">Open a case in game, screenshot it, paste it here</h1>
          <p className="drop__lead">
            <kbd>Ctrl</kbd> <kbd>V</kbd> anywhere on this page. Item cases, junk boxes, scav case
            returns and any other container window work, and the stash behind it is left out.
          </p>
        </>
      )}
      <div className="drop__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose a screenshot
        </button>
        {onDemo && (
          <button type="button" className="button" disabled={busy} onClick={onDemo}>
            Try an example
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={SCAN_LIMITS.acceptedTypes.join(",")}
        hidden
        onChange={(event) => {
          pick(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}

/** A case sorted the way the page sorts one: flea market in amber, traders in blue. */
function CaseArt() {
  const unit = 40;
  // [column, row, width, height, destination]
  const items: Array<[number, number, number, number, "flea" | "trader" | "slot"]> = [
    [0, 0, 2, 1, "flea"],
    [2, 0, 1, 1, "trader"],
    [3, 0, 1, 2, "trader"],
    [4, 0, 1, 1, "slot"],
    [0, 1, 1, 1, "trader"],
    [1, 1, 1, 1, "trader"],
    [2, 1, 1, 1, "flea"],
    [4, 1, 1, 1, "trader"],
    [0, 2, 2, 2, "flea"],
    [2, 2, 1, 1, "trader"],
    [3, 2, 2, 1, "trader"],
    [2, 3, 1, 1, "slot"],
    [3, 3, 1, 1, "flea"],
    [4, 3, 1, 1, "slot"],
    [0, 4, 1, 1, "trader"],
    [1, 4, 3, 1, "trader"],
    [4, 4, 1, 1, "flea"],
  ];
  return (
    <svg className="drop__art" viewBox={`-2 -2 ${unit * 5 + 4} ${unit * 5 + 4}`} aria-hidden>
      {items.map(([x, y, w, h, kind]) => (
        <rect
          key={`${x}-${y}`}
          className={`art-${kind}`}
          x={x * unit + 3}
          y={y * unit + 3}
          width={w * unit - 6}
          height={h * unit - 6}
          rx={2}
        />
      ))}
    </svg>
  );
}
