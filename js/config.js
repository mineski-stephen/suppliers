/*
 * Suppliers: everything a maintainer may change. No secrets: the site is public.
 *
 * Suppliers only reads. Every Lark call runs as the person who logged in (their own
 * user token, about 2 hours), so they see exactly the procurement rows Lark lets them see.
 *
 * For local testing you can point the page at another connection service, per tab:
 *   http://127.0.0.1:9125/?lark=http://127.0.0.1:8001     (?reset clears it)
 * or under Settings > Advanced. Both work only on a local page and show a red badge.
 *   http://127.0.0.1:9125/?ce=http://127.0.0.1:8002       the line-item service (Line Items tab)
 * Preview mode (?preview, local page only) runs on tests/fixture.json, a made-up sample.
 */

/* version: bump it with every release and add an entry to CHANGELOG.md (newest first, same number).
   The top bar shows it beside the name. */
export const APP = { name: "Suppliers", key: "suppliers", version: "1.5.2", env: "live" };   // env: "live" | "test"
export const ENV_LABEL = APP.env === "test" ? "Test copy" : "";   // display only, never a gate

export const SERVICES = {   // hosted defaults; `min` and `headers` are checked on every wake
  // The shared Lark proxy reports no version yet, so only its name is checked (min: "").
  // The Lark proxy (tech/lark-proxy) runs in two places, tried in this order: Cloudflare Workers
  // (never sleeps), then Render (the backup). Both must be in index.html's connect-src.
  lark: { urls: ["https://lark-proxy.stephen-lin.workers.dev", "https://lark-proxy-dwiw.onrender.com"],
          service: "lark-cors-proxy", min: "2.0.0", headers: ["Authorization"] },
  // The Line Items tab: CE line items from anthropic-ce (tech/anthropic-ce, GET /lines, Cloudflare D1).
  // Cloudflare only, on purpose: there is no Render copy of this, and the tab is hidden whenever the
  // Lark proxy above is on its Render backup. Must be in index.html's connect-src.
  ce: { urls: ["https://anthropic-ce.stephen-lin.workers.dev"],
        service: "anthropic-ce", min: "1.2.0", headers: ["Authorization"] },
};

// The same Lark app as Fetch and Polaris; the Lark proxy holds its secret. Every address
// Suppliers is opened from must be a Redirect URL on this app (http://127.0.0.1:9125/ locally).
export const LARK = {
  appId: "cli_aab0716138b8ded3",
  scopes: "bitable:app",
  api: "https://open.larksuite.com/open-apis",
  authorize: "https://accounts.larksuite.com/open-apis/authen/v1/authorize",
  tzOffsetMinutes: 480,   // dates are shown as Lark's Base shows them: Manila / Singapore time (UTC+8)
};

// One Lark link per table, exactly as copied from the address bar. The table is read in
// full (never through a view). People need access to this Base in Lark to use Suppliers.
export const TABLES = {
  live: {
    procurement: "https://mineskiglobal.larksuite.com/base/NP7TbjwHNaTyLOsWafelN9wNgEd?table=tbl3ki9aAQsWCJuR",
    // The Universe (one row per project): only its CE link is read, for a CE line item's "Where it's from".
    // Optional: without it (or without access to it) a line shows its CE workbook's file name instead.
    universe: "https://mineskiglobal.larksuite.com/base/NP7TbjwHNaTyLOsWafelN9wNgEd?table=tblEmWYOXoAF70uf",
  },
  // A copy for trying things out. An empty link stops the page at start-up: it never falls back to live.
  test: { procurement: "", universe: "" },
};
// The Universe columns read (by name, exactly as in Lark): the project code and its CE in Google Sheets.
export const UNIVERSE = { code: "Project Code", ceSheet: "Internal CE (Sheet)" };

export const RULES = {
  exchangeRate: 57,            // PHP per 1 USD until someone sets their own in Settings
  currencies: ["PHP", "USD"],  // a blank currency counts as the first
  // Status filter choices, in the order the filter shows them. Spelled exactly as in Lark.
  statuses: ["Approved", "Under Review", "Recalled", "Rejected"],
  defaultStatuses: ["Approved"],
  // Results with about the same relevance are ordered by status, in this order.
  statusPriority: ["Approved", "Under Review", "Rejected", "Recalled"],
  recentCount: 20,             // cards in "Recent orders" (then a card that opens Browse all)
  linesPage: 2000,             // CE line items read per request (the service's most)
  chunk: 100,                  // results drawn at a time ("Show more")
  staleAfterMs: 30 * 60000,    // coming back to the tab after this long refreshes quietly
};

/** The table links in force for this environment ("" for a test copy that isn't set up yet). */
export const tableLinks = (env = APP.env) => ({ ...(TABLES[env] || {}) });
