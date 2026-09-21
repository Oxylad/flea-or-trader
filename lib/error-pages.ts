// Error pages. The server renders them for errors it produces itself; the same
// HTML is written to public/errors/ (scripts/build-error-pages.ts) so nginx can
// show it when the server cannot answer at all (stopped, restarting, too slow).

export interface ErrorPage {
  title: string;
  message: string;
  /** Offer reloading: the same request may work in a moment. */
  retry: boolean;
}

export const ERROR_PAGES: Record<number, ErrorPage> = {
  400: {
    title: "That request didn't make sense",
    message: "The server couldn't read what your browser sent. Go back and try again.",
    retry: false,
  },
  403: {
    title: "You can't open this page",
    message: "This address isn't open to visitors. Start from the scanner instead.",
    retry: false,
  },
  404: {
    title: "Nothing in this slot",
    message: "This page doesn't exist. Check the address, or start from the scanner.",
    retry: false,
  },
  405: {
    title: "That action isn't allowed here",
    message: "This address doesn't accept that kind of request. Start from the scanner instead.",
    retry: false,
  },
  413: {
    title: "That upload is too large",
    message: "Screenshots must be under 8 MB. Use a PNG or JPEG straight from the game.",
    retry: false,
  },
  429: {
    title: "Too many requests",
    message: "You've sent a lot of requests in a short time. Wait a minute, then reload.",
    retry: true,
  },
  500: {
    title: "Something broke on the server",
    message: "The server hit an error while loading this page. Reload to try again.",
    retry: true,
  },
  502: {
    title: "Flea or Trader is restarting",
    message: "The server isn't answering right now. This usually lasts a few seconds during an update, so reload in a moment.",
    retry: true,
  },
  503: {
    title: "Flea or Trader is unavailable",
    message: "The server can't take requests right now. Reload in a minute or two.",
    retry: true,
  },
  504: {
    title: "The server took too long",
    message: "It didn't answer in time. Reload to try again.",
    retry: true,
  },
};

/** Statuses nginx shows from disk when the server itself cannot answer. */
export const STATIC_ERROR_STATUSES = [404, 413, 502, 503, 504] as const;

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1c1f1a"/><rect x="5" y="5" width="10" height="22" rx="1.5" fill="#e8a33d"/><rect x="17" y="5" width="10" height="10" rx="1.5" fill="#7eb6cf"/><rect x="17" y="17" width="10" height="10" rx="1.5" fill="#7eb6cf" opacity=".55"/></svg>',
  );

/** A complete, self-contained HTML page: it must work while the app is down. */
export function renderErrorPage(status: number): string {
  const page = ERROR_PAGES[status] ?? (status >= 500 ? ERROR_PAGES[500] : ERROR_PAGES[400]);
  const kind = status >= 500 ? "server" : "client";
  const digits = String(status)
    .split("")
    .map((digit) => `<span class="slot">${digit}</span>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#1c1f1a">
<meta name="robots" content="noindex">
<title>${escape(page.title)} (error ${status}) - Flea or Trader</title>
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Saira+Extra+Condensed:wght@600;700&family=Saira+Semi+Condensed:wght@400;500;600&display=swap">
<style>
:root {
  color-scheme: dark;
  --ground: #1c1f1a;
  --panel: #252922;
  --panel-raised: #2e332a;
  --line: #3b4136;
  --text: #e6e1d0;
  --muted: #a3a291;
  --faint: #767768;
  --flea: #e8a33d;
  --trader: #7eb6cf;
  --alert: #e0705f;
  --display: "Saira Extra Condensed", "Arial Narrow", "Roboto Condensed", sans-serif;
  --body: "Saira Semi Condensed", "Segoe UI", system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--ground); color: var(--text); }
body {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 0 clamp(1rem, 3vw, 2rem);
  font: 400 1rem/1.5 var(--body);
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; }
:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
header { padding-block: 1.1rem; }
.brand {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3em;
  font: 700 1.9rem/1 var(--display);
  text-decoration: none;
}
.brand .flea { color: var(--flea); }
.brand .or { color: var(--faint); font-size: 0.7em; font-weight: 600; }
.brand .trader { color: var(--trader); }
main {
  flex: 1;
  display: grid;
  align-content: center;
  justify-items: start;
  gap: 1.5rem;
  max-width: 44rem;
  padding-block: 2rem 4rem;
}
.code { display: flex; gap: clamp(0.4rem, 1.5vw, 0.75rem); margin: 0; }
.slot {
  display: grid;
  place-items: center;
  width: clamp(4.5rem, 17vw, 7.5rem);
  aspect-ratio: 1;
  border: 2px solid var(--accent);
  border-radius: 4px;
  background: linear-gradient(var(--wash), var(--wash)), var(--panel);
  color: var(--accent);
  font: 700 clamp(3.4rem, 13vw, 5.8rem)/1 var(--display);
}
.client { --accent: var(--flea); --wash: rgba(232, 163, 61, 0.1); }
.server { --accent: var(--alert); --wash: rgba(224, 112, 95, 0.12); }
h1 { margin: 0; font: 700 clamp(2.2rem, 6vw, 3.4rem)/1 var(--display); }
p.message { margin: 0; max-width: 52ch; color: var(--muted); font-size: 1.1rem; }
.actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.button {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 1rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel-raised);
  font: 500 0.95rem var(--body);
  text-decoration: none;
}
.button:hover { border-color: var(--muted); }
.button.primary { border-color: var(--flea); background: var(--flea); color: #1c1f1a; font-weight: 600; }
.button.primary:hover { border-color: #f3bb63; background: #f3bb63; }
footer {
  padding-block: 1.25rem 2rem;
  border-top: 1px solid var(--line);
  color: var(--faint);
  font-size: 0.85rem;
}
footer p { margin: 0; }
</style>
</head>
<body class="${kind}">
<header><a class="brand" href="/"><span class="flea">Flea</span><span class="or">or</span><span class="trader">Trader</span></a></header>
<main>
<p class="code" aria-label="Error ${status}">${digits}</p>
<h1>${escape(page.title)}</h1>
<p class="message">${escape(page.message)}</p>
<div class="actions">
${page.retry ? '<a class="button primary" href="">Reload</a>\n<a class="button" href="/">Back to the scanner</a>' : '<a class="button primary" href="/">Back to the scanner</a>'}
</div>
</main>
<footer><p>Error ${status}. Made by <a href="https://oxylad.me">Oxylad</a>.</p></footer>
</body>
</html>
`;
}

/** JSON body nginx returns for API requests while the server cannot answer. */
export const API_UNAVAILABLE_JSON = `${JSON.stringify({
  error: "The server is restarting or unavailable. Try again in a moment.",
  code: "unavailable",
})}\n`;
