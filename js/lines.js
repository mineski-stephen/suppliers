/*
 * CE line items: the Line Items tab's data and search. Pure: no DOM, no network (the Node tests run it).
 *
 * The lines come from the anthropic-ce service (GET /lines, Cloudflare D1), one row per distinct
 * line of a cost estimate (CE) per workbook: what the CE budgeted (unit cost, markup, client price),
 * where it came from (project, CE file, tab, row) and what was actually paid (matched purchase
 * orders). They hold internal costs and markups. js/app.js keeps a saved copy (js/cache.js) for the
 * next visit, owner-tagged and dropped on Log out, Clear local data or a refusal.
 *
 * A line row is a plain object keyed by the service's column names (line_key, particular, …);
 * text stays text and numbers stay numbers. Its id rides along as row.$id ("line:<line_key>"),
 * not enumerable, so it never takes part in a search, and row.$line marks it as a line.
 *
 * Search uses the same language as the procurement records (query.js): words with typo
 * tolerance (Orama, BM25), "phrases", -excludes, Exact, and field:'value' filters for the fields
 * a line has (project_code, project_name, business_unit, particular_item).
 */
import { create, insert, search as oramaSearch } from "./vendor/orama.js";
import { parseFieldFilters, parseQuery, rowContainsPhrases, rowContainsExcludes } from "./query.js";

export const LINE_PREFIX = "line:";
export const isLineId = (id) => String(id || "").startsWith(LINE_PREFIX);

// Orama property -> line column. These are what a word search looks at.
const PROPS = {
  particular: "particular", item: "item", remarks: "remarks", section: "section", category: "category",
  packageContents: "package_contents", projectCode: "project_code", projectName: "project_name", client: "client",
  sourceTab: "source_tab", poNumbers: "po_numbers",
};
const SCHEMA = { ...Object.fromEntries(Object.keys(PROPS).map((k) => [k, "string"])), rowIdx: "number" };
// Field filters (query.js FILTER_FIELDS names) -> the line column they mean. Fields a line doesn't
// have (project_manager, supplier_account_name) match no line.
export const LINE_FIELDS = { particular_item: "particular", project_code: "project_code", project_name: "project_name", business_unit: "business_unit" };
const BOOLS = new Set(["in_final", "inactive", "waived", "free", "contingency", "is_package"]);
const NUMS = new Set(["qty", "frq", "unit_price_php", "base_price_php", "markup", "gross_profit_php", "client_price_php",
  "actual_php", "po_count", "savings_php", "source_row", "n_versions"]);

/** The service's { columns, rows } pages -> line rows. Blank text becomes "", 0/1 flags become booleans. */
export function toLineRows(columns, rows) {
  const out = [];
  for (const r of rows || []) {
    const row = {};
    columns.forEach((c, i) => {
      const v = r[i];
      if (BOOLS.has(c)) row[c] = v === 1 || v === true || v === "1";
      else if (NUMS.has(c)) row[c] = v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
      else row[c] = v === null || v === undefined ? "" : String(v);
    });
    Object.defineProperty(row, "$id", { value: LINE_PREFIX + String(row.line_key || out.length), enumerable: false });
    Object.defineProperty(row, "$line", { value: true, enumerable: false });
    out.push(row);
  }
  return out;
}

/** A CE line's quantity as people write it: "2 × 3" (quantity × frequency), or "1". */
export function lineQty(row) {
  const n = (v) => (v === null || v === undefined || v === "" ? null : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
  const q = n(row.qty), f = n(row.frq);
  if (q && f && f !== "1") return `${q} × ${f}`;
  return q || f || "1";
}

/** A line's field-filter check, with query.js's rules (exact = whole value, any case; else contains). */
function lineMatchesFieldFilters(row, filters) {
  return filters.every((f) => {
    const col = LINE_FIELDS[f.field];
    const cell = col ? row[col] : undefined;
    if (typeof cell !== "string") return false;
    if (f.exact) return cell.trim().toLowerCase() === String(f.value).trim().toLowerCase();
    return cell.toLowerCase().includes(String(f.value).toLowerCase());
  });
}

/** Lines with about the same score: lines in a final CE first, then the most recent price. */
export function lineSort(a, b) {
  const d = (a.score || 0) - (b.score || 0);
  if (Math.abs(d) > 0.05) return d;
  if (!!a.item.in_final !== !!b.item.in_final) return a.item.in_final ? -1 : 1;
  return String(b.item.price_date || "").localeCompare(String(a.item.price_date || ""));
}

const yieldToPage = () => new Promise((r) => setTimeout(r, 0));

/** A search index over the line rows. */
export function createLineIndex() {
  let db = null, rows = [], ready = false;

  async function build(data, onProgress) {
    ready = false;
    rows = data;
    db = await create({ schema: SCHEMA });
    for (let i = 0; i < data.length; i++) {
      const doc = { rowIdx: i };
      for (const [k, col] of Object.entries(PROPS)) doc[k] = String(data[i][col] ?? "");
      await insert(db, doc);
      if (i % 500 === 499) { if (onProgress) onProgress(i + 1, data.length); await yieldToPage(); }
    }
    if (onProgress) onProgress(data.length, data.length);
    ready = true;
  }

  const scan = (keep, limit) => {
    const out = [];
    for (let i = 0; i < rows.length && out.length < limit; i++) if (keep(rows[i])) out.push({ item: rows[i], score: 0 });
    return out.sort(lineSort);
  };
  const texts = (row) => Object.values(row).filter((v) => typeof v === "string");

  /** Every line, final CEs first, newest price first (Browse all). */
  const all = () => rows.map((item) => ({ item, score: 0 })).sort(lineSort);

  /** Search: [{ item: row, score }] best first. opts = { exact, limit }. Every match by default (no 500 cap
   *  as on the purchase orders): the list draws 100 at a time, and the filters, counts and group totals
   *  must see every match. */
  async function search(query, { exact = false, limit = 0 } = {}) {
    if (!String(query || "").trim() || !ready) return [];
    limit = limit > 0 ? limit : Math.max(rows.length, 1);
    const { fieldFilters, rest } = parseFieldFilters(query);
    const has = fieldFilters.length > 0;
    const fits = (row) => !has || lineMatchesFieldFilters(row, fieldFilters);
    if (has && !rest) return scan(fits, limit);
    const text = has ? rest : query;
    if (exact) {
      const q = text.toLowerCase();
      return scan((row) => texts(row).some((v) => v.toLowerCase().includes(q)) && fits(row), limit);
    }
    const { phrases, excludes, remainder } = parseQuery(text);
    if (!remainder && !phrases.length && excludes.length) return scan((row) => !rowContainsExcludes(row, excludes) && fits(row), limit);
    if (phrases.length && !remainder) {
      return scan((row) => rowContainsPhrases(row, phrases) && (!excludes.length || !rowContainsExcludes(row, excludes)) && fits(row), limit);
    }
    const res = await oramaSearch(db, { term: remainder, limit, tolerance: 1 });
    const best = res.hits.reduce((m, hit) => Math.max(m, hit.score || 0), 1);
    let out = res.hits.map((hit) => ({ item: rows[hit.document.rowIdx], score: 1 - ((hit.score || 0) / best) }));
    if (phrases.length) out = out.filter((r) => rowContainsPhrases(r.item, phrases));
    if (excludes.length) out = out.filter((r) => !rowContainsExcludes(r.item, excludes));
    if (has) out = out.filter((r) => fits(r.item));
    const q = remainder.toLowerCase();
    const literal = [], others = [];
    for (const r of out) (texts(r.item).some((v) => v.toLowerCase().includes(q)) ? literal : others).push(r);
    return [...literal.sort(lineSort), ...others.sort(lineSort)];
  }

  return { build, search, all, rows: () => rows, isReady: () => ready };
}

// ---- filters, sort and groups for the Line Items tab ------------------------------------------
// The purchase-order filters (status, outsourced, currency, supplier) don't fit CE lines, so lines
// have their own, kept apart in S.lineFilters:
//   f = { sort: key|null, final: null|"only"|"other", outcomes: Set, categories: Set (empty = all),
//         po: null|"yes"|"no", group: key|null }
export const defaultLineFilters = () => ({ sort: null, final: null, outcomes: new Set(), categories: new Set(), po: null, group: null });

export const LINE_SORTS = {   // key -> [label, url value]
  "date-desc": ["Newest price first", "datedesc"],
  "date-asc": ["Oldest price first", "dateasc"],
  "unit-desc": ["Unit cost, high to low", "unitdesc"],
  "unit-asc": ["Unit cost, low to high", "unitasc"],
  "cost-desc": ["Line cost, high to low", "costdesc"],
  "cost-asc": ["Line cost, low to high", "costasc"],
  "markup-desc": ["Markup, high to low", "markupdesc"],
  "markup-asc": ["Markup, low to high", "markupasc"],
  "project-asc": ["Project code, A to Z", "projaz"],
  "project-desc": ["Project code, Z to A", "projza"],
};
export const LINE_GROUPS = {   // key -> [label, url value]
  project: ["Project", "project"],
  category: ["Category", "category"],
  business_unit: ["Business unit", "bu"],
};

const numOr = (v, d) => (v === null || v === undefined || Number.isNaN(Number(v)) ? d : Number(v));
/** Sort by a number; lines without one go last either way. */
const byNum = (col, dir) => (a, b) => {
  const x = numOr(a.item[col], null), y = numOr(b.item[col], null);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return dir * (x - y);
};
const byText = (col, dir) => (a, b) => dir * String(a.item[col] || "").localeCompare(String(b.item[col] || ""));
const byDate = (dir) => (a, b) => {
  const x = String(a.item.price_date || ""), y = String(b.item.price_date || "");
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return dir * x.localeCompare(y);
};
export function lineSortFn(key) {
  switch (key) {
    case "date-desc": return byDate(-1);
    case "date-asc": return byDate(1);
    case "unit-desc": return byNum("unit_price_php", -1);
    case "unit-asc": return byNum("unit_price_php", 1);
    case "cost-desc": return byNum("base_price_php", -1);
    case "cost-asc": return byNum("base_price_php", 1);
    case "markup-desc": return byNum("markup", -1);
    case "markup-asc": return byNum("markup", 1);
    case "project-asc": return byText("project_code", 1);
    case "project-desc": return byText("project_code", -1);
    default: return () => 0;
  }
}

const hasPo = (row) => !!String(row.po_numbers || "").trim() || numOr(row.actual_php, 0) > 0;
/** Why a line is left out by the filters ("" when it isn't), checked in the panel's order. */
function hiddenReason(row, f) {
  if (f.final === "only" && !row.in_final) return "final";
  if (f.final === "other" && row.in_final) return "final";
  if (f.outcomes.size && !f.outcomes.has(row.outcome || "Unknown")) return "outcome";
  if (f.categories.size && !f.categories.has(row.category || "Uncategorised")) return "category";
  if (f.po === "yes" && !hasPo(row)) return "po";
  if (f.po === "no" && hasPo(row)) return "po";
  return "";
}

/** The Line Items list rules: final CE, outcome, category, purchase orders, then the sort. A new array. */
export function applyLineFilters(results, f) {
  let out = (results || []).filter((r) => !hiddenReason(r.item, f));
  if (f.sort && LINE_SORTS[f.sort]) out = out.slice().sort(lineSortFn(f.sort));
  return out;
}

/** What the line filters leave out, by reason: { final, outcome, category, po }. */
export function lineHiddenBy(results, f) {
  const out = { final: 0, outcome: 0, category: 0, po: 0 };
  for (const r of results || []) { const why = hiddenReason(r.item, f); if (why) out[why]++; }
  return out;
}

/** The group a line belongs to. */
export function lineGroupKey(row, by) {
  if (by === "project") return [row.project_code, row.project_name].filter(Boolean).join(" · ") || "No project";
  if (by === "category") return row.category || "Uncategorised";
  if (by === "business_unit") return row.business_unit || "No business unit";
  return "";
}

/** Lines -> [{ name, items, sumPhp }] (sumPhp: the line costs), in order of first appearance;
 *  by total when a line cost sort is on. */
export function groupLines(results, by, sort) {
  const groups = new Map();
  for (const r of results) {
    const k = lineGroupKey(r.item, by);
    if (!groups.has(k)) groups.set(k, { name: k, items: [], sumPhp: 0 });
    const g = groups.get(k);
    g.items.push(r);
    g.sumPhp += numOr(r.item.base_price_php, 0);
  }
  const list = [...groups.values()];
  if (sort === "cost-desc") list.sort((a, b) => b.sumPhp - a.sumPhp);
  else if (sort === "cost-asc") list.sort((a, b) => a.sumPhp - b.sumPhp);
  return list;
}

/** How many line settings differ from the defaults (the filter button's badge on Line Items). */
export const lineFilterCount = (f) => (f.sort ? 1 : 0) + (f.final ? 1 : 0) + (f.outcomes.size ? 1 : 0)
  + (f.categories.size ? 1 : 0) + (f.po ? 1 : 0) + (f.group ? 1 : 0);

/** The values a filter can offer, most common first: [[value, count], …]. */
export function lineChoices(rows, col, blank) {
  const n = new Map();
  for (const r of rows || []) { const v = r[col] || blank; n.set(v, (n.get(v) || 0) + 1); }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

/** Line filters -> query-string pairs (l-prefixed, defaults left out), for shareable links. */
export function encodeLineFilters(f) {
  const p = new URLSearchParams();
  if (f.sort && LINE_SORTS[f.sort]) p.set("lsort", LINE_SORTS[f.sort][1]);
  if (f.final) p.set("lfinal", f.final);
  if (f.outcomes.size) p.set("loutcome", [...f.outcomes].join("|"));
  if (f.categories.size) p.set("lcat", [...f.categories].join("|"));
  if (f.po) p.set("lpo", f.po);
  if (f.group && LINE_GROUPS[f.group]) p.set("lgroup", LINE_GROUPS[f.group][1]);
  return p;
}

/** Query string -> the line filters it sets (anything missing or unknown is left out). */
export function decodeLineFilters(search) {
  const p = new URLSearchParams(search);
  const out = {};
  const sort = Object.keys(LINE_SORTS).find((k) => LINE_SORTS[k][1] === String(p.get("lsort") || "").toLowerCase());
  if (sort) out.sort = sort;
  const fin = String(p.get("lfinal") || "").toLowerCase();
  if (fin === "only" || fin === "other") out.final = fin;
  if (p.get("loutcome")) out.outcomes = new Set(p.get("loutcome").split("|").map((x) => x.trim()).filter(Boolean));
  if (p.get("lcat")) out.categories = new Set(p.get("lcat").split("|").map((x) => x.trim()).filter(Boolean));
  const po = String(p.get("lpo") || "").toLowerCase();
  if (po === "yes" || po === "no") out.po = po;
  const g = String(p.get("lgroup") || "").toLowerCase();
  const key = Object.keys(LINE_GROUPS).find((k) => LINE_GROUPS[k][1] === g);
  if (key) out.group = key;
  return out;
}

// ---- the CE in Google Sheets, from the Universe ---------------------------------------------------
const cellText = (v) => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(cellText).join("");
  if (typeof v === "object") return String(v.link || v.text || "");
  return String(v);
};
/** A project code as compared: trimmed, any case. */
export const projectKey = (code) => String(code || "").trim().toUpperCase();
/** Universe records ({ fields }) -> Map(project code -> its "Internal CE (Sheet)" link). Only https links;
 *  a project listed twice keeps its first link. */
export function ceSheetLinks(items, { code = "Project Code", ceSheet = "Internal CE (Sheet)" } = {}) {
  const out = new Map();
  for (const it of items || []) {
    const f = (it && it.fields) || {};
    const k = projectKey(cellText(f[code]));
    const v = f[ceSheet];
    const link = (v && typeof v === "object" && !Array.isArray(v) ? String(v.link || v.text || "") : cellText(v)).trim();
    if (!k || !link || out.has(k)) continue;
    try { if (new URL(link).protocol === "https:") out.set(k, link); } catch (_) { /* not a link */ }
  }
  return out;
}
