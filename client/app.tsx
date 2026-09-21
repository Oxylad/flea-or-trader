import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_MODES, type GameMode, type MarketData, type MarketItem, type Trader } from "../lib/market";
import { decide, DEFAULT_SELL_SETTINGS, type SellSettings } from "../lib/pricing";
import {
  defaultWindows,
  displayCells,
  gridWindows,
  initialAssignments,
  parentKey,
  splitCellKey,
  splitCellRects,
  type CellAssignments,
  type CellKey,
  type SplitDirection,
} from "../lib/scan/cells";
import { prepareScreenshot, ScreenshotTooLargeError } from "../lib/scan/prepare-screenshot";
import {
  SCAN_LIMITS,
  type ScanCell,
  type ScanErrorResponse,
  type ScanImageResult,
  type ScanResponse,
} from "../lib/scan/types";
import { DropTarget } from "./components/drop-target";
import { FullscreenShot } from "./components/fullscreen-shot";
import { Inspector } from "./components/inspector";
import { Legend } from "./components/legend";
import { Screenshot, type CellState } from "./components/screenshot";
import { SellSheet, type SheetRow } from "./components/sell-sheet";
import { Settings } from "./components/settings";
import { useStoredState } from "./util";

interface Session {
  url: string;
  /** What was sent to the scanner; re-used when a cell is split. Fetched lazily for the example. */
  upload: Blob | null;
  result: ScanImageResult;
}

const NO_GRID_ERROR =
  "No inventory slots were found in this screenshot. Use a full-resolution screenshot with the case window open.";

const MODE_LABEL: Record<GameMode, string> = { pve: "PvE", regular: "PvP" };

const validMode = (value: unknown): GameMode | null =>
  GAME_MODES.includes(value as GameMode) ? (value as GameMode) : null;

/** Known settings only, so ones saved by older versions (like the removed offer limit) drop out. */
const validSettings = (value: unknown): SellSettings | null => {
  if (!value || typeof value !== "object") return null;
  const saved = value as Partial<SellSettings>;
  const settings = { ...DEFAULT_SELL_SETTINGS };
  for (const key of Object.keys(DEFAULT_SELL_SETTINGS) as Array<keyof SellSettings>) {
    if (typeof saved[key] === typeof DEFAULT_SELL_SETTINGS[key]) (settings as Record<string, unknown>)[key] = saved[key];
  }
  return settings;
};

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ScanErrorResponse | null;
  return body?.error ?? fallback;
}

async function postScan(upload: Blob, rects?: object[]): Promise<ScanImageResult> {
  const form = new FormData();
  form.append("image", upload, "screenshot");
  if (rects) form.append("rects", JSON.stringify(rects));
  const response = await fetch("/api/scan", { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(
      await readError(
        response,
        response.status === 413 ? "The screenshot is too large to upload." : "The scan failed. Try again.",
      ),
    );
  }
  const { images } = (await response.json()) as ScanResponse;
  if (!images[0]) throw new Error("The scan failed. Try again.");
  return images[0];
}

/** `?demo` in the address opens the example; /demo redirects there. */
const DEMO_PARAM = "demo";

function setDemoInAddress(on: boolean) {
  const url = new URL(window.location.href);
  if (url.searchParams.has(DEMO_PARAM) === on) return;
  if (on) url.searchParams.set(DEMO_PARAM, "");
  else url.searchParams.delete(DEMO_PARAM);
  // `?demo=` reads worse than `?demo`.
  window.history.replaceState(null, "", url.toString().replace(`${DEMO_PARAM}=`, DEMO_PARAM));
}

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export function App() {
  const [mode, setMode] = useStoredState<GameMode>("mode", "pve", validMode);
  const [settings, setSettings] = useStoredState<SellSettings>("sell-settings", DEFAULT_SELL_SETTINGS, validSettings);

  // Market prices for the chosen mode.
  const [market, setMarket] = useState<MarketData | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setMarketError(null);
    const load = async () => {
      try {
        const response = await fetch(`/api/market/${mode}`);
        if (!response.ok) throw new Error(await readError(response, "Prices could not be loaded."));
        const data = (await response.json()) as MarketData;
        if (!cancelled) setMarket(data);
      } catch (error) {
        if (!cancelled) {
          setMarketError(
            error instanceof TypeError
              ? "Could not reach the server. Check your connection."
              : error instanceof Error
                ? error.message
                : "Prices could not be loaded.",
          );
        }
      }
    };
    void load();
    const timer = setInterval(load, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [mode]);
  const activeMarket = market?.mode === mode ? market : null;

  const itemsById = useMemo(
    () => new Map<string, MarketItem>((activeMarket?.items ?? []).map((item) => [item.id, item])),
    [activeMarket],
  );
  const tradersById = useMemo(
    () => new Map<string, Trader>((activeMarket?.traders ?? []).map((trader) => [trader.id, trader])),
    [activeMarket],
  );

  // Scan session.
  const [session, setSession] = useState<Session | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splits, setSplits] = useState<Record<CellKey, ScanCell[]>>({});
  const [splitting, setSplitting] = useState(false);
  const [assignments, setAssignments] = useState<CellAssignments>({});
  const [dismissed, setDismissed] = useState<Record<CellKey, true>>({});
  const [counted, setCounted] = useState<Set<number>>(new Set());
  const [activeCell, setActiveCell] = useState<CellKey | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const objectUrl = useRef<string | null>(null);
  const startSession = useCallback((next: Session) => {
    if (objectUrl.current && objectUrl.current !== next.url) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = next.url.startsWith("blob:") ? next.url : null;
    const windows = gridWindows(next.result.cells, next.result.pitch);
    setSession(next);
    setSplits({});
    setDismissed({});
    setAssignments(initialAssignments(displayCells(next.result, {})));
    setCounted(defaultWindows(windows, next.result.pitch));
    setActiveCell(null);
    setFullscreen(false);
    setError(null);
  }, []);

  const scanFile = useCallback(
    async (file: File) => {
      if (scanning) return;
      if (file.size > SCAN_LIMITS.maxSourceBytes) {
        setError(`Screenshots must be under ${Math.round(SCAN_LIMITS.maxSourceBytes / 1024 / 1024)} MB.`);
        return;
      }
      setScanning(true);
      setError(null);
      try {
        const upload = await prepareScreenshot(file);
        const result = await postScan(upload);
        if (!result.cells.length) throw new Error(NO_GRID_ERROR);
        startSession({ url: URL.createObjectURL(file), upload, result });
        setDemoInAddress(false);
      } catch (caught) {
        setError(
          caught instanceof ScreenshotTooLargeError
            ? "The screenshot is too large to upload."
            : caught instanceof TypeError
              ? "Could not reach the scanner. Check your connection and try again."
              : caught instanceof Error
                ? caught.message
                : "The screenshot could not be read.",
        );
      } finally {
        setScanning(false);
      }
    },
    [scanning, startSession],
  );

  const loadDemo = async () => {
    setScanning(true);
    setError(null);
    try {
      const response = await fetch("/api/demo");
      if (!response.ok) throw new Error(await readError(response, "The example could not be loaded."));
      const body = (await response.json()) as { imageUrl: string; image: ScanImageResult };
      startSession({ url: body.imageUrl, upload: null, result: body.image });
      setDemoInAddress(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The example could not be loaded.");
    } finally {
      setScanning(false);
    }
  };

  // Opened as /demo (redirected to /?demo): show the example straight away.
  const demoRequested = useRef(false);
  useEffect(() => {
    if (demoRequested.current) return;
    demoRequested.current = true;
    if (new URLSearchParams(window.location.search).has(DEMO_PARAM)) void loadDemo();
  }, []);

  // Derived scan state.
  const windows = useMemo(
    () => (session ? gridWindows(session.result.cells, session.result.pitch) : []),
    [session],
  );
  const windowOfParent = useMemo(() => {
    const map = new Map<CellKey, number>();
    windows.forEach((window, index) => window.cells.forEach((cell) => map.set(String(cell), index)));
    return map;
  }, [windows]);
  const windowOf = useCallback((key: CellKey) => windowOfParent.get(parentKey(key)) ?? -1, [windowOfParent]);

  const cells = useMemo(() => (session ? displayCells(session.result, splits) : []), [session, splits]);
  const countedCells = useMemo(
    () => cells.filter((cell) => !cell.empty && counted.has(windowOf(cell.key))),
    [cells, counted, windowOf],
  );

  const groups = useMemo(() => {
    const byItem = new Map<string, { itemId: string; count: number; unsure: boolean; keys: CellKey[] }>();
    for (const cell of countedCells) {
      const itemId = assignments[cell.key];
      if (!itemId) continue;
      const group = byItem.get(itemId) ?? { itemId, count: 0, unsure: false, keys: [] };
      group.count++;
      group.keys.push(cell.key);
      // A cell the user re-assigned counts as checked.
      if (cell.matches[0]?.itemId === itemId && cell.confidence !== "high") group.unsure = true;
      byItem.set(itemId, group);
    }
    return byItem;
  }, [countedCells, assignments]);

  const unrecognisedKeys = useMemo(
    () => countedCells.filter((cell) => !assignments[cell.key] && !dismissed[cell.key]).map((cell) => cell.key),
    [countedCells, assignments, dismissed],
  );

  const rows: SheetRow[] = useMemo(() => {
    if (!activeMarket) return [];
    return decide([...groups.values()], itemsById, activeMarket.flea, settings).map((verdict) => ({
      ...verdict,
      item: itemsById.get(verdict.itemId)!,
      unsure: groups.get(verdict.itemId)?.unsure ?? false,
    }));
  }, [activeMarket, groups, itemsById, settings]);
  const destinationByItem = useMemo(() => new Map(rows.map((row) => [row.itemId, row.destination])), [rows]);

  const stateOf = (key: CellKey): CellState | null => {
    const cell = cells.find((c) => c.key === key);
    if (!cell || cell.empty) return null;
    if (dismissed[key]) return "dismissed";
    const itemId = assignments[key];
    if (!itemId) return "unrecognised";
    return destinationByItem.get(itemId) ?? "none";
  };

  const itemLink = useCallback(
    (key: CellKey) => {
      const item = itemsById.get(assignments[key] ?? "");
      return item?.link ? { href: item.link, name: item.name } : null;
    },
    [assignments, itemsById],
  );

  const highlighted = useMemo(() => {
    const itemId = hoveredItem ?? (activeCell ? assignments[activeCell] : null);
    return new Set(itemId ? (groups.get(itemId)?.keys ?? []) : []);
  }, [hoveredItem, activeCell, assignments, groups]);

  // Opening a cell from the list scrolls its inspector into view.
  const scrollToInspector = useRef(false);
  useEffect(() => {
    if (!activeCell || !scrollToInspector.current) return;
    scrollToInspector.current = false;
    document.getElementById("inspector")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeCell]);
  const openCell = (key: CellKey | undefined) => {
    if (!key) return;
    scrollToInspector.current = true;
    setActiveCell(key);
  };

  const active = activeCell ? cells.find((cell) => cell.key === activeCell) : undefined;

  const assign = (key: CellKey, itemId: string | null) => {
    setAssignments((current) => ({ ...current, [key]: itemId }));
    setDismissed((current) => {
      const next = { ...current };
      if (itemId) delete next[key];
      else next[key] = true;
      return next;
    });
    setActiveCell(null);
  };

  const split = async (key: CellKey, direction: SplitDirection, count: number) => {
    if (!session) return;
    const cell = cells.find((c) => c.key === key);
    if (!cell) return;
    setSplitting(true);
    try {
      const upload = session.upload ?? (await (await fetch(session.url)).blob());
      if (!session.upload) setSession({ ...session, upload });
      const result = await postScan(upload, splitCellRects(cell, direction, count));
      const parts = result.cells;
      setSplits((current) => ({ ...current, [key]: parts }));
      setAssignments((current) => {
        const next = { ...current };
        delete next[key];
        return {
          ...next,
          ...initialAssignments(parts.map((part, slot) => ({ ...part, key: splitCellKey(key, slot) }))),
        };
      });
      setActiveCell(splitCellKey(key, 0));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The split failed. Try again.");
    } finally {
      setSplitting(false);
    }
  };

  const undoSplit = (key: CellKey) => {
    if (!session) return;
    const parent = parentKey(key);
    setSplits((current) => {
      const next = { ...current };
      delete next[parent];
      return next;
    });
    setAssignments((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([k]) => parentKey(k) !== parent));
      const cell = session.result.cells[Number(parent)];
      return { ...next, ...initialAssignments([{ ...cell, key: parent }]) };
    });
    setActiveCell(parent);
  };

  const toggleWindow = (index: number) =>
    setCounted((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // The screenshot is drawn twice: in the column, and again inside the fullscreen dialog.
  const shotProps = session && {
    url: session.url,
    result: session.result,
    cells,
    windows,
    windowOf,
    counted,
    stateOf,
    activeCell,
    highlighted,
    itemLink,
    onSelectCell: (key: CellKey) => setActiveCell(key === activeCell ? null : key),
    onToggleWindow: toggleWindow,
  };

  const screenshot = shotProps && <Screenshot {...shotProps} />;

  const inspector = session && active && (
    <Inspector
      key={active.key}
      compact={fullscreen}
      url={session.url}
      imageWidth={session.result.width}
      imageHeight={session.result.height}
      cell={active}
      assignedItemId={assignments[active.key] ?? null}
      dismissed={!!dismissed[active.key]}
      itemsById={itemsById}
      items={activeMarket?.items ?? []}
      verdict={rows.find((row) => row.itemId === assignments[active.key])}
      traders={tradersById}
      splitting={splitting}
      onSplit={
        !active.key.includes("#") && active.slotsWide * active.slotsHigh > 1
          ? (direction, count) => split(active.key, direction, count)
          : undefined
      }
      onUndoSplit={active.key.includes("#") ? () => undoSplit(active.key) : undefined}
      onAssign={(itemId) => assign(active.key, itemId)}
      onClose={() => setActiveCell(null)}
    />
  );

  // Checking an item happens beside the screenshot, so the dialog stays open.
  const fullscreenShot = fullscreen && shotProps && (
    <FullscreenShot inspector={inspector || undefined} onClose={() => setFullscreen(false)}>
      <Screenshot {...shotProps} full />
    </FullscreenShot>
  );

  const modeSwitch = (
    <div className="mode" role="radiogroup" aria-label="Game mode">
      {GAME_MODES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          className="mode__option"
          onClick={() => setMode(value)}
        >
          {MODE_LABEL[value]}
        </button>
      ))}
    </div>
  );

  const status = scanning ? (
    <p className="status" role="status">
      Scanning the screenshot…
    </p>
  ) : error ? (
    <p className="status status--error" role="alert">
      {error}
    </p>
  ) : null;

  return (
    <div className="page">
      <header className="masthead">
        <a className="brand" href="/">
          <span className="brand__flea">Flea</span>
          <span className="brand__or">or</span>
          <span className="brand__trader">Trader</span>
        </a>
        {modeSwitch}
      </header>

      <main>
        {!session ? (
          <div className="intro">
            <DropTarget onFile={scanFile} onDemo={loadDemo} busy={scanning} />
            {status}
            <div className="intro__settings">
              <Settings settings={settings} flea={activeMarket?.flea ?? null} onChange={setSettings} />
            </div>
          </div>
        ) : (
          <div className="workspace">
            <div className="workspace__shot">
              <div className="shot-bar">
                {windows.length > 1 && (
                  <div className="windows">
                    <span className="windows__label">Counting</span>
                    {windows.map((window, index) => (
                      <button
                        key={index}
                        type="button"
                        className="chip"
                        aria-pressed={counted.has(index)}
                        onClick={() => toggleWindow(index)}
                      >
                        {window.slotsWide}×{window.slotsHigh} grid
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="button button--small shot-bar__full"
                  onClick={() => setFullscreen(true)}
                >
                  <svg viewBox="0 0 16 16" className="shot-bar__icon" aria-hidden focusable="false">
                    <path d="M6 1H1v5M10 1h5v5M6 15H1v-5M10 15h5v-5" />
                  </svg>
                  Fullscreen
                </button>
              </div>
              {screenshot}
              <Legend />
              {fullscreenShot}

              {!fullscreen && inspector}

              {status}
              <DropTarget onFile={scanFile} busy={scanning} compact />
            </div>

            <div className="workspace__sheet">
              {marketError && !activeMarket && (
                <p className="status status--error" role="alert">
                  {marketError}
                </p>
              )}
              {!activeMarket && !marketError && (
                <p className="status" role="status">
                  Loading {MODE_LABEL[mode]} prices…
                </p>
              )}
              {activeMarket && (
                <SellSheet
                  rows={rows}
                  traders={tradersById}
                  unrecognised={unrecognisedKeys.length}
                  onReviewUnrecognised={() => openCell(unrecognisedKeys[0])}
                  onOpenItem={(itemId) => openCell(groups.get(itemId)?.keys[0])}
                  onHoverItem={setHoveredItem}
                />
              )}
              <Settings settings={settings} flea={activeMarket?.flea ?? null} onChange={setSettings} />
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        <p>
          {activeMarket ? `${MODE_LABEL[mode]} prices from ` : "Prices from "}
          <a href="https://tarkov.dev" rel="noopener">
            Tarkov.dev
          </a>
          {activeMarket && `, updated ${ago(activeMarket.fetchedAt, now)}`}. Screenshots are scanned in memory
          and never stored.
        </p>
        <p>
          Made by <a href="https://oxylad.me">Oxylad</a>. Not affiliated with Battlestate Games.
        </p>
      </footer>
    </div>
  );
}
