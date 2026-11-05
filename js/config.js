/*
 * Suppliers: everything a maintainer may change. No secrets: the site is public.
 *
 * Suppliers only reads. Every Lark call runs as the person who logged in (their own
 * user token, about 2 hours), so they see exactly the procurement rows Lark lets them see.
 *
 * For local testing you can point the page at another connection service, per tab:
 *   http://127.0.0.1:9125/?lark=http://127.0.0.1:8001     (?reset clears it)
 * or under Settings > Advanced. Both work only on a local page and show a red badge.
 * Preview mode (?preview, local page only) runs on tests/fixture.json, a made-up sample.
 */

/* version: bump it with every release and add an entry to CHANGELOG.md (newest first, same number).
   The top bar shows it beside the name. */
export const APP = { name: "Suppliers", key: "suppliers", version: "1.0.0", env: "live" };   // env: "live" | "test"
export const ENV_LABEL = APP.env === "test" ? "Test copy" : "";   // display only, never a gate

export const SERVICES = {   // hosted defaults; `min` and `headers` are checked on every wake
  // The shared Lark proxy reports no version yet, so only its name is checked (min: "").
  lark: { url: "https://lark-proxy-dwiw.onrender.com", service: "lark-cors-proxy", min: "", headers: ["Authorization"] },
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
  live: { procurement: "https://mineskiglobal.larksuite.com/base/NP7TbjwHNaTyLOsWafelN9wNgEd?table=tbl3ki9aAQsWCJuR" },
  // A copy for trying things out. An empty link stops the page at start-up: it never falls back to live.
  test: { procurement: "" },
};

export const RULES = {
  exchangeRate: 57,            // PHP per 1 USD until someone sets their own in Settings
  currencies: ["PHP", "USD"],  // a blank currency counts as the first
  // Status filter choices, in the order the filter shows them. Spelled exactly as in Lark.
  statuses: ["Approved", "Under Review", "Recalled", "Rejected"],
  defaultStatuses: ["Approved"],
  // Results with about the same relevance are ordered by status, in this order.
  statusPriority: ["Approved", "Under Review", "Rejected", "Recalled"],
  searchLimit: 500,            // the most matches one search returns per tab
  recentCount: 20,             // cards in "Recent orders" (then a card that opens Browse all)
  chunk: 100,                  // results drawn at a time ("Show more")
  staleAfterMs: 30 * 60000,    // coming back to the tab after this long refreshes quietly
};

/** The table links in force for this environment ("" for a test copy that isn't set up yet). */
export const tableLinks = (env = APP.env) => ({ ...(TABLES[env] || {}) });
