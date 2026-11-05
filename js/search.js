/*
 * Full-text search over the procurement rows: Orama (BM25, typo tolerance 1) plus the exact,
 * phrase, exclude and field-filter rules of query.js. No DOM and no network, so the Node tests
 * run it on the sample data. The ranking is the old page's, unchanged:
 *   1. BM25 hits (limit 500), scored 0 (best) to 1 against the best hit
 *   2. phrases, excludes and field filters narrow them
 *   3. hits whose row contains the search text literally come first; within each part,
 *      results within 0.05 of each other are ordered by status (Approved first)
 * Orama is vendored at an exact version (js/vendor/orama.js, see its README) so the ranking
 * can't change under the page and the CSP needs no CDN.
 */
import { create, insert, search as oramaSearch } from "./vendor/orama.js";
import { RULES } from "./config.js";
import {
  FILTER_FIELDS, parseFieldFilters, rowMatchesFieldFilters, parseQuery,
  rowContainsPhrases, rowContainsExcludes, statusPrioritySort,
} from "./query.js";

// Orama property -> Lark column.
const PROPS = {
  requestNo: "Request No.", status: "Status", requester: "Requester", project: "Project Name",
  projectCode: "Project Code", particular: "Particulars_Item", supplier: "Supplier Details_Supplier Name",
  accountName: "Supplier Details_Account Name", costType: "Cost Type", chargedTo: "Charged to",
};
const SCHEMA = { ...Object.fromEntries(Object.keys(PROPS).map((k) => [k, "string"])), rowIdx: "number" };

/** What each tab searches: Orama properties, and the columns for exact / phrase matching. */
export const TAB_PROPERTIES = {
  all: undefined,
  particulars: ["particular"],
  suppliers: ["supplier", "accountName"],
  projects: ["project", "projectCode"],
};
export const TAB_FIELDS = {
  all: null,
  particulars: ["Particulars_Item"],
  suppliers: ["Supplier Details_Supplier Name", "Supplier Details_Account Name"],
  projects: ["Project Name", "Project Code"],
};

const yieldToPage = () => new Promise((r) => setTimeout(r, 0));

/** A search index over one set of rows. */
export function createIndex() {
  let db = null, rows = [], ready = false;

  /** Index the rows; onProgress(done, total) while it works (it yields to the page every 250). */
  async function build(data, onProgress) {
    ready = false;
    rows = data;
    db = await create({ schema: SCHEMA });
    for (let i = 0; i < data.length; i++) {
      const doc = { rowIdx: i };
      for (const [k, col] of Object.entries(PROPS)) doc[k] = String(data[i][col] || "");
      await insert(db, doc);
      if (i % 250 === 249) { if (onProgress) onProgress(i + 1, data.length); await yieldToPage(); }
    }
    if (onProgress) onProgress(data.length, data.length);
    ready = true;
  }

  const scan = (keep, limit) => {
    const out = [];
    for (let i = 0; i < rows.length && out.length < limit; i++) if (keep(rows[i])) out.push({ item: rows[i], score: 0 });
    return out.sort(statusPrioritySort);
  };

  /** Case-insensitive substring over every value (or the tab's columns). */
  function exactSubstring(text, tab, limit) {
    const q = text.toLowerCase();
    const fields = TAB_FIELDS[tab];
    return scan((row) => (fields ? fields.map((f) => row[f]) : Object.values(row))
      .some((v) => typeof v === "string" && v.toLowerCase().includes(q)), limit);
  }

  /** Search: [{ item: row, score }] best first. opts = { tab, exact, limit }. */
  async function search(query, { tab = "all", exact = false, limit = RULES.searchLimit } = {}) {
    if (!String(query || "").trim() || !ready) return [];
    const { fieldFilters, rest } = parseFieldFilters(query);
    const has = fieldFilters.length > 0;
    if (has && !rest) return scan((row) => rowMatchesFieldFilters(row, fieldFilters), limit);

    const text = has ? rest : query;
    const narrow = (list) => (has ? list.filter((r) => rowMatchesFieldFilters(r.item, fieldFilters)) : list);
    if (exact) return narrow(exactSubstring(text, tab, limit));

    const { phrases, excludes, remainder } = parseQuery(text);
    const fields = TAB_FIELDS[tab];
    const fits = (row) => !has || rowMatchesFieldFilters(row, fieldFilters);
    if (!remainder && !phrases.length && excludes.length) {
      return scan((row) => !rowContainsExcludes(row, excludes, fields) && fits(row), limit);
    }
    if (phrases.length && !remainder) {
      return scan((row) => rowContainsPhrases(row, phrases, fields)
        && (!excludes.length || !rowContainsExcludes(row, excludes, fields)) && fits(row), limit);
    }

    const opts = { term: remainder, limit, tolerance: 1 };
    if (TAB_PROPERTIES[tab]) opts.properties = TAB_PROPERTIES[tab];
    const res = await oramaSearch(db, opts);
    const best = res.hits.reduce((m, hit) => Math.max(m, hit.score || 0), 1);
    let out = res.hits.map((hit) => ({ item: rows[hit.document.rowIdx], score: 1 - ((hit.score || 0) / best) }));
    if (phrases.length) out = out.filter((r) => rowContainsPhrases(r.item, phrases, fields));
    if (excludes.length) out = out.filter((r) => !rowContainsExcludes(r.item, excludes, fields));
    out = narrow(out);

    const q = remainder.toLowerCase();
    const literal = [], others = [];
    for (const r of out) (Object.values(r.item).some((v) => typeof v === "string" && v.toLowerCase().includes(q)) ? literal : others).push(r);
    return [...literal.sort(statusPrioritySort), ...others.sort(statusPrioritySort)];
  }

  /** Distinct values of a filter field that contain `prefix` (for the value suggestions). */
  function fieldValues(field, prefix = "", limit = 8) {
    const f = FILTER_FIELDS[field];
    if (!f) return [];
    const p = String(prefix).toLowerCase();
    const seen = new Set();
    for (const row of rows) {
      const t = typeof row[f.column] === "string" ? row[f.column].trim() : "";
      if (!t || (p && !t.toLowerCase().includes(p))) continue;
      seen.add(t);
      if (seen.size >= limit) break;
    }
    return [...seen];
  }

  return { build, search, fieldValues, rows: () => rows, isReady: () => ready };
}
