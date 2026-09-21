# Flea or Trader

Paste a screenshot of an opened Escape from Tarkov item case (or junk box, scav case, any
container) and see which items earn more on the flea market after the listing fee, and which to
sell to which trader.

Live at https://flea.oxylad.me. https://flea.oxylad.me/demo redirects to `/?demo`, which opens the
bundled example scan.

## How it works

- **Recognition** (`lib/scan/`) is the Stash Scan engine written for
  [cultist-circle](https://github.com/Wilsman/cultist-circle): grid lines are found as thin bright
  ridges, cells are matched against Tarkov.dev grid images by art and short-name text. The icon
  index (~23 MB) is built from Tarkov.dev on first start into `.cache/scan/` and refreshed daily.
- **Differences from Tarkov.dev's images** handled in `lib/scan/`: in-game short names sit about a
  pixel higher and further right (`SCREENSHOT_TEXT_OFFSET`); the game truncates names that do not
  fit ("Shestyork" for "Shestyorka") and Tarkov.dev shrinks the font of names that do not fit
  ("Interchange"), so templates whose text reaches the left edge get truncated and enlarged
  variants; a window's last column or row can end on the black window frame (scrollbar gutter)
  instead of a grid line, which the grid detector accepts as a border; the game draws no line
  between an item and an empty slot below it, so a flat, dark (empty-looking) slot next to an
  item slot counts as a border too; some items are drawn differently in-game (keys turned diagonal), so art counts for at
  least `ART_FLOOR` and a clear short name can still win.
- **Accuracy check**: `bun run eval` scans the screenshots in `public/` and compares against the
  labels read by eye in `test/fixtures/recognition-labels.json`. It fails on any wrong answer at
  high confidence, any labelled slot the grid detector misses, and any item cell merged with a
  slot labelled empty. As of 2.0.1: keys screenshots 145/152, 18/20 and 69/71 (the rest at medium
  confidence; the Lighthouse key's Tarkov.dev image is a placeholder), demo 122/122.
- **Case window** (`lib/scan/cells.ts`): touching cells form grid windows; the biggest window and
  anything within a slot of it are counted, so the stash behind an open case is left out. The
  page lets you toggle windows.
- **The page** (`client/`): boxes drawn over the screenshot say where each item goes; the legend
  under it explains them. The Fullscreen button above the screenshot opens it fullscreen, with the
  legend beside it (under it in a narrow window), and clicking a box there opens that item's
  inspector — beside the screenshot while fullscreen (a compact copy, which the screenshot makes
  room for), under it otherwise. Hovering a box, or a row in the sell sheet, shows a small link to
  the item on Tarkov.dev (always shown where there is no hover, like a touchscreen); the inspector
  has the same link as a labelled button.
- **Prices** (`server/market.ts`): Tarkov.dev JSON API per game mode (`pve`, `regular`),
  refreshed every 10 minutes and served gzipped.
- **Decision** (`lib/pricing.ts`): flea fee uses Tarkov.dev's `fleaMarketFee` formula (including
  Intel Center 3 and Hideout Management). The listing price is the market price, or lower when
  the fee outgrows the price. An item goes to the flea market when it beats the best trader by
  at least the chosen minimum. Every item that clears it is listed for the flea market; there is
  no offer-slot limit.

## Run

    bun install
    bun test
    bun run typecheck
    bun run start          # NODE_ENV=production, 127.0.0.1:3007
    bun run pm2:deploy     # build:errors, typecheck, test, then reload PM2 from the ecosystem file

Error pages come from one template, `lib/error-pages.ts`. The server renders them for its own
404/500 (API routes stay JSON); `bun run build:errors` writes copies to `public/errors/` that nginx
shows when the server cannot answer (413, 502, 503, 504, and 404 for its own misses), with a JSON
body for `/api/`. A test fails if the copies drift from the template.

Production runs under PM2 from `ecosystem.config.cjs`. nginx vhost: `deploy/flea.oxylad.me.conf`
(installed in `/etc/nginx/sites-available/`).
