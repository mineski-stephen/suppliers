/*
 * The search language and the list rules. Pure functions: no DOM, no network, no Orama.
 * Kept exactly as the old page behaved (js/search.js and js/app.js of the encrypted-file
 * version), so links people shared still mean the same thing.
 *
 *   lighting rental        either word, best matches first (search.js does the ranking)
 *   "exact phrase"         the whole phrase must appear
 *   -word  -"a phrase"     leave out records that contain it
 *   field:'text'           that column contains the text
 *   field:"text"           that column is exactly the text (case doesn't matter)
 */
import { RULES } from "./config.js";
import { sortTime } from "./rows.js";

// ---- field filters -----------------------------------------------------------------
/** Field name in a query -> its Lark column, with a short description for the field list. */
export const FILTER_FIELDS = {
  particular_item: { column: "Particulars_Item", label: "Item", desc: "Item name on the request" },
  business_unit: { column: "Business Unit", label: "Business unit", desc: "Owning business unit" },
  project_name: { column: "Project Name", label: "Project name", desc: "Project name" },
  project_code: { column: "Project Code", label: "Project code", desc: "Project code" },
  project_manager: { column: "Project Manager", label: "Project manager", desc: "Project manager" },
  supplier_account_name: { column: "Supplier Details_Account Name", label: "Supplier account", desc: "Supplier account name" },
};

const FIELD_TOKEN_RE = /([a-z_]+):(['"])(.*?)\2/gi;

/** Take field:'value' / field:"value" tokens out of a query. Unknown fields stay as text. */
export function parseFieldFilters(query) {
  const fieldFilters = [];
  const rest = String(query || "").replace(FIELD_TOKEN_RE, (match, name, q, value) => {
    const f = FILTER_FIELDS[name.toLowerCase()];
    if (!f) return match;
    fieldFilters.push({ field: name.toLowerCase(), column: f.column, value, exact: q === '"' });
    return " ";
  });
  return { fieldFilters, rest: rest.trim() };
}

/** Does a row pass every field filter? Exact = whole value, trimmed, any case; else contains. */
export function rowMatchesFieldFilters(row, fieldFilters) {
  return fieldFilters.every((f) => {
    const cell = row[f.column];
    if (typeof cell !== "string") return false;
    if (f.exact) return cell.trim().toLowerCase() === String(f.value).trim().toLowerCase();
    return cell.toLowerCase().includes(String(f.value).toLowerCase());
  });
}

/** A chip as query text: field:'value' (contains) or field:"value" (exact). */
export const chipText = (c) => `${c.field}:${c.exact ? '"' : "'"}${c.value}${c.exact ? '"' : "'"}`;

/** What a typed chip value means: the person may type their own quotes to choose the match. */
export function chipValue(raw) {
  let value = String(raw || "").trim();
  let exact = false;
  const m = value.match(/^(['"])([\s\S]*)\1$/);
  if (m) { exact = m[1] === '"'; value = m[2].trim(); }
  return { value, exact };
}

// ---- free text ------------------------------------------------------------------------
/** "phrases", -excludes and the words left over. */
export function parseQuery(query) {
  const phrases = [], excludes = [];
  let q = String(query || "").replace(/-"([^"]+)"/g, (_, p) => { excludes.push(p); return ""; });
  q = q.replace(/"([^"]+)"/g, (_, p) => { phrases.push(p); return ""; });
  q = q.replace(/(?:^|\s)-(\S+)/g, (_, w) => { excludes.push(w); return ""; });
  return { phrases, excludes, remainder: q.trim() };
}

const targets = (row, fields) => (fields ? fields.map((f) => row[f]) : Object.values(row));
export function rowContainsPhrases(row, phrases, fields) {
  const vals = targets(row, fields);
  return phrases.every((p) => { p = p.toLowerCase(); return vals.some((v) => typeof v === "string" && v.toLowerCase().includes(p)); });
}
export function rowContainsExcludes(row, excludes, fields) {
  const vals = targets(row, fields);
  return excludes.some((e) => { e = e.toLowerCase(); return vals.some((v) => typeof v === "string" && v.toLowerCase().includes(e)); });
}

/** Request numbers (6+ digits) and project codes (2026TEG-P0290) switch to exact matching. */
export function detectExactPattern(text) {
  const q = String(text || "").trim();
  return /^\d{6,}$/.test(q) || /^\d{4}[A-Z]{2,4}-[A-Z]?\d+$/i.test(q);
}

/** The words to highlight: free-text terms and phrases, without the excluded ones. */
export function highlightTerms(text) {
  const terms = [];
  const cleaned = String(text || "").replace(/-"[^"]*"/g, "").replace(/(?:^|\s)-\S+/g, "");
  for (const m of cleaned.matchAll(/"([^"]+)"/g)) terms.push(m[1]);
  const rest = cleaned.replace(/"[^"]*"/g, "").trim();
  if (rest) terms.push(...rest.split(/\s+/).filter(Boolean));
  return terms;
}

/** Split text into [{ text, mark }] runs, marking every term (any case). Terms are applied one
 *  after another, longest first, so a long term isn't broken up by a short one inside it. */
export function markRuns(text, terms) {
  text = String(text || "");
  const list = [...new Set((terms || []).filter(Boolean).map((t) => t.toLowerCase()))].sort((a, b) => b.length - a.length);
  if (!list.length || !text) return [{ text, mark: false }];
  const re = new RegExp(list.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), mark: false });
    out.push({ text: m[0], mark: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mark: false });
  return out;
}

/** "outsource", "outsourced" and "outsourcing" in an item name become an "Outsourced" badge. */
export const OUTSOURCE_WORD = /\boutsourc(?:ed|e|ing)\b/gi;
export const isOutsourced = (row) => String(row["Particulars_Item"] || "").toLowerCase().includes("outsource");
export function outsourceParts(text) {
  const out = [];
  let last = 0;
  text = String(text || "");
  for (const m of text.matchAll(OUTSOURCE_WORD)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ badge: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

// ---- ordering --------------------------------------------------------------------------
const priority = new Map(RULES.statusPriority.map((s, i) => [s.toLowerCase(), i]));
/** Results within 0.05 of each other's score are ordered by status (Approved first). */
export function statusPrioritySort(a, b) {
  const d = (a.score || 0) - (b.score || 0);
  if (Math.abs(d) > 0.05) return d;
  const pa = priority.has(String(a.item.Status || "").toLowerCase()) ? priority.get(String(a.item.Status).toLowerCase()) : 99;
  const pb = priority.has(String(b.item.Status || "").toLowerCase()) ? priority.get(String(b.item.Status).toLowerCase()) : 99;
  return pa - pb;
}

// ---- prices ----------------------------------------------------------------------------
export const currencyOf = (row) => String(row["Particulars_Unit Price-Currency"] || RULES.currencies[0]).trim().toUpperCase() || RULES.currencies[0];
/** An amount in PHP: USD times the exchange rate; anything else as it is. */
export function toPhp(amount, currency, rate) {
  if (!currency || currency === "PHP") return amount;
  if (currency === "USD") return amount * rate;
  return amount;
}
/** "PHP 1,250.00": in its own currency (show ""), or converted to PHP or USD. "" for no amount. */
export function priceText(amount, currency, show, rate) {
  const n = Number(amount);
  if (!n || Number.isNaN(n)) return "";
  const two = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cur = currency || "PHP";
  if (show === "PHP") return `PHP ${two(toPhp(n, cur, rate))}`;
  if (show === "USD") return `USD ${two(cur === "USD" ? n : n / rate)}`;
  return `${cur} ${two(n)}`;
}
const amountPhp = (row, column, rate) => toPhp(parseFloat(row[column]) || 0, currencyOf(row), rate);

// ---- filters, sort, groups ----------------------------------------------------------------
export const SORTS = {   // key -> [label, url value]
  "date-desc": ["Newest first", "datedesc"],
  "date-asc": ["Oldest first", "dateasc"],
  "price-desc": ["Total price, high to low", "pricedesc"],
  "price-asc": ["Total price, low to high", "priceasc"],
  "unitprice-asc": ["Unit price, low to high", "unitpriceasc"],
  "unitprice-desc": ["Unit price, high to low", "unitpricedesc"],
  "project-asc": ["Project code, A to Z", "projaz"],
  "project-desc": ["Project code, Z to A", "projza"],
};
export const GROUPS = {   // key (a column) -> [label, url value]
  "Business Unit": ["Business unit", "business unit"],
  "Project Name": ["Project", "project"],
  "Supplier Details_Supplier Name": ["Supplier", "supplier"],
};

export function sortFn(key, rate) {
  switch (key) {
    case "date-desc": return (a, b) => sortTime(b.item["Submitted at"]) - sortTime(a.item["Submitted at"]);
    case "date-asc": return (a, b) => sortTime(a.item["Submitted at"]) - sortTime(b.item["Submitted at"]);
    case "price-desc": return (a, b) => amountPhp(b.item, "Particulars_Price", rate) - amountPhp(a.item, "Particulars_Price", rate);
    case "price-asc": return (a, b) => amountPhp(a.item, "Particulars_Price", rate) - amountPhp(b.item, "Particulars_Price", rate);
    case "unitprice-asc": return (a, b) => amountPhp(a.item, "Particulars_Unit Price", rate) - amountPhp(b.item, "Particulars_Unit Price", rate);
    case "unitprice-desc": return (a, b) => amountPhp(b.item, "Particulars_Unit Price", rate) - amountPhp(a.item, "Particulars_Unit Price", rate);
    case "project-asc": return (a, b) => String(a.item["Project Code"] || "").localeCompare(String(b.item["Project Code"] || ""));
    case "project-desc": return (a, b) => String(b.item["Project Code"] || "").localeCompare(String(a.item["Project Code"] || ""));
    default: return () => 0;
  }
}

/** The list rules: status, outsourced, currency, then the sort. f = { statuses: Set, outsource:
 *  null|"only"|"hide", currency: null|"PHP"|"USD", sort: key|null }. Returns a new array. */
export function applyFilters(results, f, rate) {
  let out = (results || []).slice();
  const all = RULES.statuses.length;
  if (f.statuses && f.statuses.size > 0 && f.statuses.size < all) {
    out = out.filter((r) => f.statuses.has(String(r.item.Status || "").trim()));
  }
  if (f.outsource === "hide") out = out.filter((r) => !isOutsourced(r.item));
  else if (f.outsource === "only") out = out.filter((r) => isOutsourced(r.item));
  if (f.currency) out = out.filter((r) => currencyOf(r.item) === f.currency);
  if (f.sort && SORTS[f.sort]) out.sort(sortFn(f.sort, rate));
  return out;
}

/** What the filters leave out of one tab's results, by reason (applied in the list's order). */
export function hiddenBy(results, f) {
  const out = { status: 0, outsource: 0, currency: 0 };
  for (const r of results || []) {
    const st = String(r.item.Status || "").trim();
    if (f.statuses.size && f.statuses.size < RULES.statuses.length && !f.statuses.has(st)) { out.status++; continue; }
    if (f.outsource === "hide" && isOutsourced(r.item)) { out.outsource++; continue; }
    if (f.outsource === "only" && !isOutsourced(r.item)) { out.outsource++; continue; }
    if (f.currency && currencyOf(r.item) !== f.currency) { out.currency++; continue; }
  }
  return out;
}

/** The group a row belongs to (a blank supplier name falls back to the account name). */
export function groupKey(row, by) {
  let key = String(row[by] || "");
  if (!key.trim() && by === "Supplier Details_Supplier Name") key = String(row["Supplier Details_Account Name"] || "");
  return key.trim() || "Unspecified";
}

/** Results -> [{ name, items, sumPhp }], in order of first appearance; by total when a price sort is on. */
export function groupResults(results, by, sort, rate) {
  const groups = new Map();
  for (const r of results) {
    const k = groupKey(r.item, by);
    if (!groups.has(k)) groups.set(k, { name: k, items: [], sumPhp: 0 });
    const g = groups.get(k);
    g.items.push(r);
    g.sumPhp += amountPhp(r.item, "Particulars_Price", rate);
  }
  const list = [...groups.values()];
  if (sort && sort.includes("price")) list.sort((a, b) => (sort.includes("desc") ? b.sumPhp - a.sumPhp : a.sumPhp - b.sumPhp));
  return list;
}

/** How many settings differ from the defaults (the filter button's badge). */
export function activeFilterCount(f) {
  const def = new Set(RULES.defaultStatuses);
  const statusesDefault = f.statuses.size === def.size && [...def].every((s) => f.statuses.has(s));
  return (f.sort ? 1 : 0) + (statusesDefault ? 0 : 1) + (f.outsource ? 1 : 0) + (f.currency ? 1 : 0) + (f.group ? 1 : 0);
}

// ---- the landing screen -------------------------------------------------------------------
/** Records, distinct suppliers, and the newest date any record was submitted or completed. */
export function statsOf(rows) {
  const suppliers = new Set();
  let newest = "";
  for (const r of rows) {
    const s = r["Supplier Details_Supplier Name"] || r["Supplier Details_Account Name"];
    if (s) suppliers.add(s);
    for (const c of ["Submitted at", "Completed at"]) if (r[c] && sortTime(r[c]) > sortTime(newest)) newest = r[c];
  }
  return { records: rows.length, suppliers: suppliers.size, newest };
}

/** The n most recently submitted. */
export const recent = (rows, n = RULES.recentCount) =>
  rows.slice().sort((a, b) => sortTime(b["Submitted at"]) - sortTime(a["Submitted at"])).slice(0, n);

// ---- the address bar (shareable links) -------------------------------------------------------
export const TABS = ["all", "particulars", "suppliers", "projects"];   // the purchase-order tabs (one result list each)
export const ALL_TABS = [...TABS, "lines"];                                  // plus Line Items (CE line items, js/lines.js)
const STATUS_CANON = Object.fromEntries(RULES.statuses.map((s) => [s.toLowerCase(), s]));

/** The view -> query string, in the old page's format (so old links still open the same view).
 *  s = { chips: [{field, value, exact, off}], text, exact, tab, sort, statuses, outsource, currency,
 *        group, all, theme, rate, show }. Defaults are left out. */
export function encodeState(s) {
  const p = new URLSearchParams();
  const q = [s.chips.filter((c) => !c.off).map(chipText).join(" "), s.text || ""].filter(Boolean).join(" ");
  if (q) p.set("q", q);
  const off = s.chips.filter((c) => c.off).map(chipText).join(" ");
  if (off) p.set("qoff", off);
  if (s.exact) p.set("exact", "true");
  if (s.tab && s.tab !== "all") p.set("tab", s.tab);
  if (s.sort && SORTS[s.sort]) p.set("sort", SORTS[s.sort][1]);
  const def = new Set(RULES.defaultStatuses);
  const isDefault = s.statuses.size === def.size && [...def].every((x) => s.statuses.has(x));
  if (!isDefault && s.statuses.size) p.set("status", RULES.statuses.filter((x) => s.statuses.has(x)).map((x) => x.toLowerCase()).join(","));
  if (s.outsource === "only") p.set("outsource", "show");
  else if (s.outsource === "hide") p.set("outsource", "hide");
  if (s.currency) p.set("currency", s.currency.toLowerCase());
  if (s.group && GROUPS[s.group]) p.set("group", GROUPS[s.group][1]);
  if (s.all) p.set("all", "true");
  if (s.theme && s.theme !== "system") p.set("theme", s.theme);
  if (s.rate && Number(s.rate) !== RULES.exchangeRate) p.set("exchangerate", String(s.rate));
  if (s.show) p.set("showprice", s.show.toLowerCase());
  // URLSearchParams writes spaces as "+" (as before); keep the status list's commas readable.
  return p.toString().replace(/%2C/g, ",");
}

/** Query string -> the parts of the view it sets (anything missing or unknown is left out). */
export function decodeState(search) {
  const p = new URLSearchParams(search);
  const out = {};
  if (p.has("exact")) out.exact = p.get("exact").toLowerCase() === "true";
  const tab = String(p.get("tab") || "").toLowerCase();
  if (ALL_TABS.includes(tab)) out.tab = tab;
  const sort = Object.keys(SORTS).find((k) => SORTS[k][1] === String(p.get("sort") || "").toLowerCase());
  if (sort) out.sort = sort;
  if (p.has("status")) {
    const list = p.get("status").split(",").map((x) => STATUS_CANON[x.trim().toLowerCase()]).filter(Boolean);
    if (list.length) out.statuses = new Set(list);
  }
  const os = String(p.get("outsource") || "").toLowerCase();
  if (os === "show") out.outsource = "only"; else if (os === "hide") out.outsource = "hide";
  const cur = String(p.get("currency") || "").toUpperCase();
  if (RULES.currencies.includes(cur)) out.currency = cur;
  const g = String(p.get("group") || "").toLowerCase();
  if (g === "none") out.group = null;
  else { const key = Object.keys(GROUPS).find((k) => GROUPS[k][1] === g); if (key) out.group = key; }
  if (String(p.get("all") || "").toLowerCase() === "true") out.all = true;
  if (p.has("q") || p.has("qoff")) {
    const on = parseFieldFilters(p.get("q") || "");
    const off = parseFieldFilters(p.get("qoff") || "");
    out.chips = [...on.fieldFilters.map((f) => ({ field: f.field, value: f.value, exact: f.exact, off: false })),
                 ...off.fieldFilters.map((f) => ({ field: f.field, value: f.value, exact: f.exact, off: true }))];
    out.text = on.rest;
  }
  return out;
}
