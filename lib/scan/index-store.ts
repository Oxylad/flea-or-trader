// Runtime icon index for a long-running server: loaded from disk on start,
// rebuilt when the Tarkov.dev catalog changes, checked again once a day.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildIndex, catalogHash, fetchCatalog } from "./index-builder";
import { decodeIndex, encodeIndex, indexFileName, type IndexMetadata } from "./index-file";
import type { IconIndex } from "./matcher";

const CACHE_DIR = process.env.SCAN_CACHE_DIR ?? path.join(process.cwd(), ".cache", "scan");

/** How often the catalog is checked for new or changed items. */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface IndexStatus {
  ready: boolean;
  building: boolean;
  templates: number;
  items: number;
  builtAt: string | null;
  lastError: string | null;
}

const state: {
  current: { index: IconIndex; metadata: IndexMetadata } | null;
  loading: Promise<void> | null;
  building: Promise<void> | null;
  lastError: string | null;
  refreshTimer: ReturnType<typeof setInterval> | null;
} = { current: null, loading: null, building: null, lastError: null, refreshTimer: null };

const log = (message: string) => console.log(`[scan] ${message}`);

// A function, not `state.current` inline: TypeScript keeps a property's
// narrowing across awaits, but the state changes while callers wait.
const currentIndex = (): IconIndex | null => state.current?.index ?? null;

function load(): Promise<void> {
  state.loading ??= (async () => {
    try {
      const loaded = decodeIndex(await readFile(path.join(CACHE_DIR, indexFileName())));
      if (!loaded) throw new Error("unreadable index");
      if (!state.current) {
        state.current = loaded;
        log(`loaded ${loaded.index.size} templates built ${loaded.metadata.builtAt}`);
      }
    } catch {
      state.lastError = "No item index on disk yet.";
    }
  })();
  return state.loading;
}

async function rebuild(): Promise<void> {
  await load();
  const catalog = await fetchCatalog();
  const hash = catalogHash(catalog);
  if (state.current?.metadata.catalogHash === hash) return;
  log(state.current ? "catalog changed; rebuilding the index" : "building the index");

  const started = Date.now();
  const built = await buildIndex(catalog, path.join(CACHE_DIR, "grid"), log);
  await mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, indexFileName());
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, encodeIndex(built.index, built.metadata));
  await rename(temporary, file);
  state.current = built;
  state.lastError = null;
  log(`built ${built.index.size} templates for ${built.metadata.items} items in ${Date.now() - started}ms`);
}

function startRebuild(): void {
  if (state.building) return;
  state.building = rebuild()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      // A failed refresh keeps serving the index already loaded.
      if (!state.current) state.lastError = message;
      log(`index refresh failed: ${message}`);
    })
    .finally(() => {
      state.building = null;
    });
}

/** Loads the index and checks the catalog in the background. */
export function warmIconIndex(): void {
  if (!state.refreshTimer) {
    state.refreshTimer = setInterval(startRebuild, REFRESH_INTERVAL_MS);
    state.refreshTimer.unref?.();
  }
  load().then(startRebuild, () => undefined);
}

/**
 * Resolves with the current index. When none is on disk yet, waits up to
 * `timeoutMs` for the first build; resolves with null otherwise.
 */
export async function getIconIndex(timeoutMs: number): Promise<IconIndex | null> {
  if (currentIndex()) return currentIndex();
  await load();
  if (currentIndex()) return currentIndex();

  startRebuild();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && state.building) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return currentIndex();
}

export function getIndexStatus(): IndexStatus {
  return {
    ready: state.current !== null,
    building: state.building !== null,
    templates: state.current?.index.size ?? 0,
    items: state.current?.metadata.items ?? 0,
    builtAt: state.current?.metadata.builtAt ?? null,
    lastError: state.lastError,
  };
}
