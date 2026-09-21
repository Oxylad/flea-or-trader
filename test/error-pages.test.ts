import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { API_UNAVAILABLE_JSON, renderErrorPage, STATIC_ERROR_STATUSES } from "../lib/error-pages";

const dir = path.join(import.meta.dir, "..", "public", "errors");

describe("error pages", () => {
  test("nginx's copies match the template (run bun run build:errors after editing it)", async () => {
    for (const status of STATIC_ERROR_STATUSES) {
      expect(await readFile(path.join(dir, `${status}.html`), "utf8")).toBe(renderErrorPage(status));
    }
    expect(await readFile(path.join(dir, "api-unavailable.json"), "utf8")).toBe(API_UNAVAILABLE_JSON);
  });

  test("pages are self-contained and escape their text", () => {
    const html = renderErrorPage(404);
    expect(html).toContain("Nothing in this slot");
    expect(html).not.toMatch(/<script|src="\/|href="\/[a-z]/);
    expect(renderErrorPage(502)).toContain(">Reload<");
    expect(renderErrorPage(404)).not.toContain(">Reload<");
  });

  test("unknown statuses fall back by class", () => {
    expect(renderErrorPage(418)).toContain("That request didn't make sense");
    expect(renderErrorPage(599)).toContain("Something broke on the server");
  });
});
