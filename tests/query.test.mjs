/* The search language and the list rules (js/query.js). Offline: node --test tests/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFieldFilters, rowMatchesFieldFilters, chipText, chipValue, parseQuery, detectExactPattern, highlightTerms, markRuns,
  outsourceParts, isOutsourced, statusPrioritySort, toPhp, priceText, currencyOf, applyFilters, groupResults, groupKey,
  activeFilterCount, hiddenBy, statsOf, recent, encodeState, decodeState, sortFn,
} from "../js/query.js";

const row = (o) => ({ "Request No.": "", Status: "Approved", "Particulars_Item": "", "Particulars_Price": "", "Particulars_Unit Price": "",
  "Particulars_Unit Price-Currency": "", "Project Code": "", "Project Name": "", "Supplier Details_Supplier Name": "",
  "Supplier Details_Account Name": "", "Business Unit": "", "Submitted at": "", ...o });
const r = (o, score = 0) => ({ item: row(o), score });
const defaults = () => ({ sort: null, statuses: new Set(["Approved"]), outsource: null, currency: null, group: null });

test("field filters: contains with single quotes, exact with double quotes, unknown fields stay text", () => {
  const { fieldFilters, rest } = parseFieldFilters(`project_code:'2026TEG' lighting supplier_account_name:"Crew Hub Services" color:'red'`);
  assert.deepEqual(fieldFilters.map((f) => [f.field, f.column, f.value, f.exact]), [
    ["project_code", "Project Code", "2026TEG", false],
    ["supplier_account_name", "Supplier Details_Account Name", "Crew Hub Services", true],
  ]);
  assert.equal(rest, `lighting   color:'red'`);
  const x = row({ "Project Code": "2026TEG-P0290", "Supplier Details_Account Name": " crew hub services " });
  assert.ok(rowMatchesFieldFilters(x, fieldFilters));
  assert.ok(!rowMatchesFieldFilters(row({ "Project Code": "2026TEG-P0290", "Supplier Details_Account Name": "Crew Hub Services Inc." }), fieldFilters));
  assert.equal(chipText({ field: "project_code", value: "2026TEG", exact: false }), "project_code:'2026TEG'");
  assert.equal(chipText({ field: "project_code", value: "X", exact: true }), `project_code:"X"`);
  assert.deepEqual(chipValue(`"2026TEG-P0290"`), { value: "2026TEG-P0290", exact: true });
  assert.deepEqual(chipValue(` 'abc' `), { value: "abc", exact: false });
  assert.deepEqual(chipValue("abc"), { value: "abc", exact: false });
});

test("phrases and excludes", () => {
  const p = parseQuery(`led "video wall" -rental -"sound system" truss`);
  assert.deepEqual([p.phrases, p.excludes, p.remainder.split(/\s+/)], [["video wall"], ["sound system", "rental"], ["led", "truss"]]);
  assert.deepEqual(highlightTerms(`led "video wall" -rental`), ["video wall", "led"]);
});

test("request numbers and project codes switch exact matching on", () => {
  for (const q of ["202610140082", "123456", "2026TEG-P0290", "2025mskp-12"]) assert.ok(detectExactPattern(q), q);
  for (const q of ["12345", "lighting", "2026TEG", "2026TEG-P0290 rental"]) assert.ok(!detectExactPattern(q), q);
});

test("highlighting marks every term, any case, longest first", () => {
  assert.deepEqual(markRuns("LED wall and led", ["led"]), [{ text: "LED", mark: true }, { text: " wall and ", mark: false }, { text: "led", mark: true }]);
  assert.deepEqual(markRuns("lighting", ["light", "lighting"]), [{ text: "lighting", mark: true }]);
  assert.deepEqual(markRuns("a.b", ["."]), [{ text: "a", mark: false }, { text: ".", mark: true }, { text: "b", mark: false }]);
  assert.deepEqual(markRuns("x", []), [{ text: "x", mark: false }]);
});

test("outsourced items: the word becomes a badge, the filter looks for 'outsource'", () => {
  assert.deepEqual(outsourceParts("Outsourced crew - stagehands"), [{ badge: true }, { text: " crew - stagehands" }]);
  assert.deepEqual(outsourceParts("Outsourcing of ushers"), [{ badge: true }, { text: " of ushers" }]);
  assert.deepEqual(outsourceParts("Camera"), [{ text: "Camera" }]);
  assert.ok(isOutsourced(row({ "Particulars_Item": "Outsource video editing" })));
  assert.ok(!isOutsourced(row({ "Particulars_Item": "Video editing" })));
});

test("status priority orders results of about the same score", () => {
  const list = [r({ Status: "Recalled" }), r({ Status: "Rejected" }), r({ Status: "Under Review" }), r({ Status: "Approved" }), r({ Status: "Odd" })];
  assert.deepEqual(list.sort(statusPrioritySort).map((x) => x.item.Status), ["Approved", "Under Review", "Rejected", "Recalled", "Odd"]);
  const scored = [r({ Status: "Approved" }, 0.5), r({ Status: "Recalled" }, 0.1)];
  assert.deepEqual(scored.sort(statusPrioritySort).map((x) => x.item.Status), ["Recalled", "Approved"]);
});

test("prices: shown in their own currency, PHP or USD at the rate", () => {
  assert.equal(currencyOf(row({})), "PHP");
  assert.equal(currencyOf(row({ "Particulars_Unit Price-Currency": "usd" })), "USD");
  assert.equal(toPhp(10, "USD", 57), 570);
  assert.equal(toPhp(10, "PHP", 57), 10);
  assert.equal(priceText("1250000", "PHP", "", 57), "PHP 1,250,000.00");
  assert.equal(priceText(100, "USD", "", 57), "USD 100.00");
  assert.equal(priceText(100, "USD", "PHP", 57), "PHP 5,700.00");
  assert.equal(priceText(5700, "PHP", "USD", 57), "USD 100.00");
  assert.equal(priceText(100, "USD", "USD", 57), "USD 100.00");
  assert.equal(priceText("", "PHP", "", 57), "");
  assert.equal(priceText("abc", "PHP", "", 57), "");
});

test("filters: Approved only by default; all four statuses = no status filter; outsourced; currency", () => {
  const list = [r({ Status: "Approved", "Particulars_Item": "Outsourced crew" }), r({ Status: "Rejected" }),
                r({ Status: "Approved", "Particulars_Unit Price-Currency": "USD" }), r({ Status: "Under Review" })];
  assert.equal(applyFilters(list, defaults(), 57).length, 2);
  assert.equal(applyFilters(list, { ...defaults(), statuses: new Set(["Approved", "Under Review", "Recalled", "Rejected"]) }, 57).length, 4);
  assert.equal(applyFilters(list, { ...defaults(), outsource: "hide" }, 57).length, 1);
  assert.equal(applyFilters(list, { ...defaults(), outsource: "only" }, 57).length, 1);
  assert.equal(applyFilters(list, { ...defaults(), currency: "USD" }, 57).length, 1);
  assert.equal(applyFilters(list, { ...defaults(), currency: "PHP" }, 57).length, 1);   // a blank currency counts as PHP
  assert.deepEqual(hiddenBy(list, { ...defaults(), currency: "PHP" }), { status: 2, outsource: 0, currency: 1 });
  assert.equal(activeFilterCount(defaults()), 0);
  assert.equal(activeFilterCount({ ...defaults(), sort: "date-desc", group: "Project Name", statuses: new Set(["Rejected"]) }), 3);
});

test("sorts convert to PHP; dates and project codes sort as before", () => {
  const list = [r({ "Particulars_Price": "100", "Particulars_Unit Price-Currency": "USD", "Submitted at": "2026-01-02 00:00:00", "Project Code": "B" }),
                r({ "Particulars_Price": "1000", "Submitted at": "2026-03-01 00:00:00", "Project Code": "A" }),
                r({ "Particulars_Price": "", "Submitted at": "", "Project Code": "C" })];
  const order = (key) => list.slice().sort(sortFn(key, 57)).map((x) => x.item["Project Code"]).join("");
  assert.equal(order("price-desc"), "BAC");   // USD 100 = PHP 5,700
  assert.equal(order("price-asc"), "CAB");
  assert.equal(order("date-desc"), "ABC");
  assert.equal(order("date-asc"), "CBA");
  assert.equal(order("project-asc"), "ABC");
  assert.equal(order("project-desc"), "CBA");
});

test("groups: first-seen order, PHP totals, by total under a price sort; blank supplier falls back to the account", () => {
  const list = [r({ "Business Unit": "Events", "Particulars_Price": "100" }), r({ "Business Unit": "Studio", "Particulars_Price": "10", "Particulars_Unit Price-Currency": "USD" }),
                r({ "Business Unit": "", "Particulars_Price": "5" }), r({ "Business Unit": "Events", "Particulars_Price": "50" })];
  const g = groupResults(list, "Business Unit", null, 57);
  assert.deepEqual(g.map((x) => [x.name, x.items.length, x.sumPhp]), [["Events", 2, 150], ["Studio", 1, 570], ["Unspecified", 1, 5]]);
  assert.deepEqual(groupResults(list, "Business Unit", "price-desc", 57).map((x) => x.name), ["Studio", "Events", "Unspecified"]);
  assert.deepEqual(groupResults(list, "Business Unit", "price-asc", 57).map((x) => x.name), ["Unspecified", "Events", "Studio"]);
  assert.equal(groupKey(row({ "Supplier Details_Account Name": "Crew Hub" }), "Supplier Details_Supplier Name"), "Crew Hub");
});

test("the landing screen: records, suppliers, newest date and the recent strip", () => {
  const rows = [row({ "Supplier Details_Supplier Name": "A", "Submitted at": "2026-01-01 10:00:00" }),
                row({ "Supplier Details_Account Name": "B", "Submitted at": "2026-03-01 10:00:00", "Completed at": "2026-03-05 10:00:00" }),
                row({ "Supplier Details_Supplier Name": "A", "Submitted at": "2026-02-01 10:00:00" })];
  assert.deepEqual(statsOf(rows), { records: 3, suppliers: 2, newest: "2026-03-05 10:00:00" });
  assert.deepEqual(recent(rows, 2).map((x) => x["Submitted at"].slice(0, 7)), ["2026-03", "2026-02"]);
});

test("the address bar: the old page's format, both ways", () => {
  const s = { chips: [{ field: "project_code", value: "2026TEG", exact: false, off: false }, { field: "business_unit", value: "Studio", exact: true, off: true }],
              text: "lighting rental", exact: true, tab: "suppliers", sort: "price-desc", statuses: new Set(["Approved", "Under Review"]),
              outsource: "hide", currency: "USD", group: "Supplier Details_Supplier Name", all: false, theme: "dark", rate: 58, show: "PHP" };
  const qs = encodeState(s);
  assert.equal(decodeURIComponent(qs.replace(/\+/g, " ")),
    `q=project_code:'2026TEG' lighting rental&qoff=business_unit:"Studio"&exact=true&tab=suppliers&sort=pricedesc&status=approved,under review&outsource=hide&currency=usd&group=supplier&theme=dark&exchangerate=58&showprice=php`);
  const d = decodeState(`?${qs}`);
  assert.deepEqual(d.chips, s.chips);
  assert.equal(d.text, "lighting rental");
  assert.equal(d.exact, true);
  assert.equal(d.tab, "suppliers");
  assert.equal(d.sort, "price-desc");
  assert.deepEqual([...d.statuses], ["Approved", "Under Review"]);
  assert.equal(d.outsource, "hide");
  assert.equal(d.currency, "USD");
  assert.equal(d.group, "Supplier Details_Supplier Name");
  // defaults are left out; an old link's ?debugkey= and other unknown values are ignored
  assert.equal(encodeState({ chips: [], text: "", exact: false, tab: "all", ...defaults(), all: false, theme: "system", rate: 57, show: "" }), "");
  assert.deepEqual(decodeState("?debugkey=abc&tab=nope&sort=nope&status=nope&currency=eur"), {});
  assert.deepEqual(decodeState("?outsource=show&group=none&all=true"), { outsource: "only", group: null, all: true });
  assert.equal(encodeState({ chips: [], text: "", exact: false, tab: "all", ...defaults(), all: true, theme: "system", rate: 57, show: "" }), "all=true");
});
