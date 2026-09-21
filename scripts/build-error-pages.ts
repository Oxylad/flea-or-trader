// Writes the error pages nginx serves when the server cannot answer
// (public/errors/). Run after changing lib/error-pages.ts: bun run build:errors

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { API_UNAVAILABLE_JSON, renderErrorPage, STATIC_ERROR_STATUSES } from "../lib/error-pages";

const dir = path.join(import.meta.dir, "..", "public", "errors");
await mkdir(dir, { recursive: true });
for (const status of STATIC_ERROR_STATUSES) {
  await writeFile(path.join(dir, `${status}.html`), renderErrorPage(status));
}
await writeFile(path.join(dir, "api-unavailable.json"), API_UNAVAILABLE_JSON);
console.log(`wrote ${STATIC_ERROR_STATUSES.length} pages and api-unavailable.json to ${dir}`);
