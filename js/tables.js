/*
 * Lark Base table access: links, fields, records (adapted from Fetch's js/tables.js).
 *
 * Every function takes `call(method, url, body, opts)`, which sends one Lark Open API
 * request and resolves with its JSON body (or throws). The page passes one that goes
 * through the Lark proxy with the signed-in person's token; the Node checks in tests/
 * pass one that calls Lark directly (or a fake). Both therefore run exactly the same logic.
 * Suppliers only reads, so every call passes { read: true } and may be retried.
 */
import { LARK } from "./config.js";

export const PAGE_SIZE = 500;   // Lark's max for records/search
export const MAX_PAGES = 200;   // runaway guard: 100,000 records
const PAGE_DELAY_MS = 120;      // pause between pages to stay clear of rate limits
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** "https://<tenant>.larksuite.com/base/<app>?table=<tbl>&view=<vew>" -> {app, table, view, url}.
 *  Throws a plain sentence for anything else (a wiki link, no table, not a link). */
export function parseBaseLink(link) {
  let u;
  try { u = new URL(String(link || "").trim()); } catch (_) { throw new Error("That isn't a link."); }
  if (u.protocol !== "https:") throw new Error("A Lark link starts with https://");
  if (/\/wiki\//.test(u.pathname)) throw new Error("That's a wiki page. Open the Base itself and copy its link.");
  const app = (u.pathname.match(/\/base\/([A-Za-z0-9]+)/) || [])[1];
  const table = u.searchParams.get("table") || "";
  if (!app || !/^tbl[A-Za-z0-9]+$/.test(table)) {
    throw new Error("That isn't a Lark table link. Copy it from the table's address bar (…/base/…?table=…).");
  }
  return { app, table, view: u.searchParams.get("view") || "", url: u.toString() };
}

export const tableUrl = (t) =>
  `${LARK.api}/bitable/v1/apps/${encodeURIComponent(t.app)}/tables/${encodeURIComponent(t.table)}`;

/** Every column of the table. Never a partial list: a missing page token throws. */
export async function loadFields(call, t) {
  const out = [];
  let pageToken = "";
  for (let i = 0; i < MAX_PAGES; i++) {
    const j = await call("GET", `${tableUrl(t)}/fields?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
      undefined, { read: true });
    const d = j.data || {};
    out.push(...(d.items || []));
    if (!d.has_more) return out;
    if (!d.page_token) throw new Error("Lark said there are more columns but gave no page token, so the column list would be incomplete.");
    pageToken = d.page_token;
  }
  throw new Error(`Stopped after ${MAX_PAGES} pages of columns.`);
}

/** All records of a table. Never through a view (views filter rows) and never a partial list:
 *  a truncated list would look like missing records, so it throws instead.
 *  onPage(read, total) runs after each page (total: Lark's count, or null). */
export async function loadRecords(call, t, fieldNames, onPage) {
  const items = [];
  let pageToken = "";
  for (let pages = 1; pages <= MAX_PAGES; pages++) {
    const body = { automatic_fields: false };
    if (fieldNames) body.field_names = fieldNames;
    const j = await call("POST", `${tableUrl(t)}/records/search?page_size=${PAGE_SIZE}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
      body, { read: true });
    const d = j.data || {};
    items.push(...(d.items || []));
    if (onPage) onPage(items.length, typeof d.total === "number" ? d.total : null);
    if (!d.has_more) return items;
    if (!d.page_token) throw new Error("Lark said there are more records but gave no page token, so the list would be incomplete.");
    pageToken = d.page_token;
    await sleep(PAGE_DELAY_MS);
  }
  throw new Error(`Stopped after ${MAX_PAGES} pages; the table is larger than Suppliers supports.`);
}
