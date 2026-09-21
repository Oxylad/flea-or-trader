// HTTP server: the page, the screenshot scan API and market prices.

import path from "node:path";
import homepage from "../client/index.html";
import { renderErrorPage } from "../lib/error-pages";
import { GAME_MODES, type GameMode } from "../lib/market";
import { decodeRgb } from "../lib/scan/index-builder";
import { getIconIndex, getIndexStatus, warmIconIndex } from "../lib/scan/index-store";
import { scanImage, scanRects } from "../lib/scan/scan";
import {
  SCAN_LIMITS,
  type ScanErrorResponse,
  type ScanImageResult,
  type ScanRect,
  type ScanResponse,
} from "../lib/scan/types";
import { getMarket, warmMarket } from "./market";
import packageJson from "../package.json";

const PORT = Number(process.env.PORT ?? 3007);
const HOST = process.env.HOST ?? "127.0.0.1";
const PRODUCTION = process.env.NODE_ENV === "production";
const PUBLIC_DIR = path.join(import.meta.dir, "..", "public");

/** How long a scan waits for the icon index on a cold start. */
const INDEX_WAIT_MS = 20000;
/** Scans run one at a time; this many more may wait in line. */
const MAX_QUEUED_SCANS = 8;
const RATE_LIMIT_IMAGES = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, { ...init, headers: { ...SECURITY_HEADERS, ...init.headers } });

function errorResponse(body: ScanErrorResponse, status: number) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (body.retryAfterSeconds) headers["Retry-After"] = String(body.retryAfterSeconds);
  return json(body, { status, headers });
}

// ---------------------------------------------------------------------------
// Scan queue and rate limit

const imagesByClient = new Map<string, number[]>();
let queue: Promise<void> = Promise.resolve();
let queued = 0;

/** Records one image for the client; returns seconds to wait if over the limit. */
function consumeRateLimit(key: string): number {
  const now = Date.now();
  const recent = (imagesByClient.get(key) ?? []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_IMAGES) {
    imagesByClient.set(key, recent);
    return Math.max(1, Math.ceil((recent[0] + RATE_LIMIT_WINDOW_MS - now) / 1000));
  }
  recent.push(now);
  imagesByClient.set(key, recent);
  if (imagesByClient.size > 5000) {
    for (const [client, times] of imagesByClient) {
      if (times.every((time) => now - time >= RATE_LIMIT_WINDOW_MS)) imagesByClient.delete(client);
    }
  }
  return 0;
}

/** Runs scans strictly one after another so they never compete for CPU. */
function enqueue<T>(task: () => Promise<T>): Promise<T> | null {
  if (queued >= MAX_QUEUED_SCANS) return null;
  queued++;
  const run = queue.then(task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run.finally(() => {
    queued--;
  });
}

/**
 * Parses the optional `rects` field: cell rectangles to match instead of
 * detecting the grid, used when one detected cell holds several items.
 */
function parseRects(value: FormDataEntryValue | null): ScanRect[] | null | "invalid" {
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return "invalid";
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > SCAN_LIMITS.maxRects) {
    return "invalid";
  }
  const rects: ScanRect[] = [];
  for (const entry of parsed) {
    const rect = entry as Partial<ScanRect>;
    const numbers = [rect.x, rect.y, rect.width, rect.height, rect.slotsWide, rect.slotsHigh];
    if (numbers.some((n) => typeof n !== "number" || !Number.isFinite(n))) return "invalid";
    if (rect.width! < 8 || rect.height! < 8 || rect.x! < 0 || rect.y! < 0) return "invalid";
    if (rect.slotsWide! < 1 || rect.slotsHigh! < 1 || rect.slotsWide! > 10 || rect.slotsHigh! > 10) {
      return "invalid";
    }
    rects.push({
      x: Math.round(rect.x!),
      y: Math.round(rect.y!),
      width: Math.round(rect.width!),
      height: Math.round(rect.height!),
      slotsWide: Math.round(rect.slotsWide!),
      slotsHigh: Math.round(rect.slotsHigh!),
    });
  }
  return rects;
}

/** Keeps rectangles inside the image. */
function clampRects(rects: ScanRect[], width: number, height: number): ScanRect[] {
  return rects.map((rect) => ({
    ...rect,
    x: Math.min(rect.x, Math.max(0, width - 2)),
    y: Math.min(rect.y, Math.max(0, height - 2)),
    width: Math.min(rect.width, width - Math.min(rect.x, width - 2)),
    height: Math.min(rect.height, height - Math.min(rect.y, height - 2)),
  }));
}

async function handleScan(request: Request, clientIp: string): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse({ error: "Expected a multipart form with a screenshot.", code: "no-images" }, 400);
  }

  const rects = parseRects(form.get("rects"));
  if (rects === "invalid") {
    return errorResponse({ error: "The cell rectangles were not understood.", code: "no-images" }, 400);
  }
  const files = form.getAll("image").filter((value): value is File => value instanceof File);
  if (files.length === 0) {
    return errorResponse({ error: "No screenshot was uploaded.", code: "no-images" }, 400);
  }
  if (files.length > 1) {
    return errorResponse({ error: "Upload one screenshot at a time.", code: "too-many-images" }, 400);
  }
  const [file] = files;
  if (!(SCAN_LIMITS.acceptedTypes as readonly string[]).includes(file.type)) {
    return errorResponse(
      { error: "Only PNG, JPEG and WebP screenshots are supported.", code: "unsupported-type" },
      415,
    );
  }
  if (file.size > SCAN_LIMITS.maxBytesPerImage) {
    return errorResponse(
      {
        error: `Screenshots must be under ${Math.round(SCAN_LIMITS.maxBytesPerImage / 1024 / 1024)} MB.`,
        code: "image-too-large",
      },
      413,
    );
  }

  const retryAfter = consumeRateLimit(clientIp);
  if (retryAfter) {
    return errorResponse(
      {
        error: "Too many screenshots scanned recently. Try again in a few minutes.",
        code: "rate-limited",
        retryAfterSeconds: retryAfter,
      },
      429,
    );
  }

  const index = await getIconIndex(INDEX_WAIT_MS);
  if (!index) {
    return errorResponse(
      {
        error: "The item recognition data is still loading. Try again shortly.",
        code: "warming-up",
        retryAfterSeconds: 30,
      },
      503,
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const scan = enqueue(async () => {
    const decoded = await decodeRgb(bytes, SCAN_LIMITS.maxPixels);
    return rects
      ? scanRects(decoded, clampRects(rects, decoded.width, decoded.height), index)
      : scanImage(decoded, index);
  });
  if (!scan) {
    return errorResponse(
      { error: "The scanner is busy. Try again in a moment.", code: "busy", retryAfterSeconds: 10 },
      503,
    );
  }

  try {
    const image = await scan;
    return json({ images: [image] } satisfies ScanResponse, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[scan] scan failed:", error);
    return errorResponse({ error: "The screenshot could not be read.", code: "unreadable-image" }, 422);
  }
}

// ---------------------------------------------------------------------------
// Demo: the bundled example screenshot, scanned once

let demoScan: Promise<ScanImageResult | null> | null = null;

function scanDemo(): Promise<ScanImageResult | null> {
  demoScan ??= (async () => {
    const index = await getIconIndex(INDEX_WAIT_MS);
    if (!index) return null;
    const bytes = Buffer.from(await Bun.file(path.join(PUBLIC_DIR, "demo.jpg")).arrayBuffer());
    const result = await enqueue(async () => scanImage(await decodeRgb(bytes), index));
    return result ?? null;
  })().then((result) => {
    if (!result) demoScan = null;
    return result;
  });
  return demoScan;
}

// ---------------------------------------------------------------------------
// Static text files

const LLMS_TXT = `# Flea or Trader

> Paste a screenshot of an opened Escape from Tarkov item case, junk box or any container. Flea or Trader recognises every item in it and says whether each one earns more on the flea market (after the listing fee) or sold to a trader, and which trader pays most.

- Prices come from Tarkov.dev and refresh every 10 minutes, for PvE and PvP separately.
- The flea market fee uses the game's formula, including Intel Center level 3 and the Hideout Management skill.
- Settings: flea price basis (lowest offer or 24 hour average), undercut, and minimum extra profit per item before the flea market is worth it.
- Screenshots are scanned in memory and not stored.
- [Example](https://flea.oxylad.me/demo): a scanned junk box with every item sorted, no upload needed.

## Other projects by Oxylad

- [oxylad.me](https://oxylad.me/llms.txt): index of all projects
`;

const ROBOTS_TXT = `User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: *
Allow: /
Disallow: /api/
`;

const text = (body: string, type = "text/plain; charset=utf-8") =>
  new Response(body, {
    headers: { ...SECURITY_HEADERS, "Content-Type": type, "Cache-Control": "public, max-age=3600" },
  });

/** A styled error page for browsers; API routes answer with JSON instead. */
const htmlError = (status: number) =>
  new Response(renderErrorPage(status), {
    status,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });

const isApi = (request: Request) => new URL(request.url).pathname.startsWith("/api/");

type Handler<R extends Request> = (request: R, server: Bun.Server<undefined>) => Response | Promise<Response>;

/** Keeps an API route's unexpected failures in JSON, which the page knows how to show. */
const api =
  <R extends Request>(handler: Handler<R>): Handler<R> =>
  async (request, server) => {
    try {
      return await handler(request, server);
    } catch (error) {
      console.error(`[server] ${request.method} ${new URL(request.url).pathname} failed:`, error);
      return json({ error: "Something broke on the server. Try again." }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  };

const staticFile = (name: string, type: string) => {
  const file = Bun.file(path.join(PUBLIC_DIR, name));
  return () =>
    new Response(file, {
      headers: { ...SECURITY_HEADERS, "Content-Type": type, "Cache-Control": "public, max-age=86400" },
    });
};

// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  development: !PRODUCTION,
  maxRequestBodySize: SCAN_LIMITS.maxBytesPerImage + 256 * 1024,
  routes: {
    "/": homepage,
    "/demo": () =>
      new Response(null, {
        status: 302,
        headers: { ...SECURITY_HEADERS, Location: "/?demo", "Cache-Control": "no-store" },
      }),
    "/demo.jpg": staticFile("demo.jpg", "image/jpeg"),
    "/favicon.svg": staticFile("favicon.svg", "image/svg+xml"),
    "/llms.txt": () => text(LLMS_TXT),
    "/robots.txt": () => text(ROBOTS_TXT),

    "/api/health": api(() => json({ version: packageJson.version, index: getIndexStatus() })),

    "/api/scan": {
      // Behind Cloudflare and nginx; nginx has no real_ip config, so X-Real-IP is a Cloudflare edge.
      POST: api((request, server) =>
        handleScan(
          request,
          request.headers.get("cf-connecting-ip") ??
            request.headers.get("x-real-ip") ??
            server.requestIP(request)?.address ??
            "unknown",
        ),
      ),
    },

    "/api/demo": api(async () => {
      const result = await scanDemo();
      if (!result) {
        return errorResponse(
          { error: "The example is still loading. Try again shortly.", code: "warming-up", retryAfterSeconds: 30 },
          503,
        );
      }
      return json({ imageUrl: "/demo.jpg", image: result }, { headers: { "Cache-Control": "no-cache" } });
    }),

    "/api/market/:mode": api(async (request) => {
      const mode = request.params.mode as GameMode;
      if (!GAME_MODES.includes(mode)) return json({ error: "Unknown game mode." }, { status: 404 });
      const payload = await getMarket(mode);
      if (!payload) {
        return json(
          { error: "Prices could not be loaded from Tarkov.dev. Try again shortly." },
          { status: 503, headers: { "Retry-After": "30" } },
        );
      }
      const headers: Record<string, string> = {
        ...SECURITY_HEADERS,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        ETag: payload.etag,
        Vary: "Accept-Encoding",
      };
      if (request.headers.get("if-none-match") === payload.etag) {
        return new Response(null, { status: 304, headers });
      }
      if (/\bgzip\b/.test(request.headers.get("accept-encoding") ?? "")) {
        return new Response(payload.gzip, { headers: { ...headers, "Content-Encoding": "gzip" } });
      }
      return new Response(payload.json, { headers });
    }),
  },
  // Anything no route matched, including a known path with the wrong method.
  fetch: (request) => (isApi(request) ? json({ error: "Not found." }, { status: 404 }) : htmlError(404)),
  // Failures outside the API routes (which answer in JSON themselves).
  error: (error) => {
    console.error("[server] request failed:", error);
    return htmlError(500);
  },
});

console.log(`[server] flea-or-trader ${packageJson.version} listening on http://${server.hostname}:${server.port}`);
warmIconIndex();
warmMarket(GAME_MODES);
