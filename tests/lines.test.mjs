/* CE line items (js/lines.js) on the made-up sample (tests/lines-fixture.json). Offline: node --test tests/ */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toLineRows, createLineIndex, isLineId, lineSort, LINE_FIELDS, lineQty } from "../js/lines.js";
import { decodeState } from "../js/query.js";

const fx = JSON.parse(readFileSync(new URL("./lines-fixture.json", import.meta.url), "utf8"));
const rows = toLineRows(fx.columns, fx.rows);
const index = createLineIndex();
before(async () => { await index.build(rows); });
const items = (list) => list.map((x) => x.item);

test("the sample is made up, and rows keep their types", () => {
  assert.match(fx.note, /Made-up sample data/);
  assert.equal(rows.length, fx.rows.length);
  const r = rows[0];
  assert.ok(isLineId(r.$id) && r.$id === `line:${r.line_key}`);
  assert.equal(r.$line, true);
  assert.ok(!Object.keys(r).includes("$id"), "the id never takes part in a search");
  assert.equal(typeof r.unit_price_php, "number");
  assert.equal(typeof r.in_final, "boolean");
  assert.equal(typeof r.particular, "string");
  const blank = toLineRows(["line_key", "remarks", "actual_php", "inactive"], [["k1", null, null, 0]])[0];
  assert.deepEqual({ ...blank }, { line_key: "k1", remarks: "", actual_php: null, inactive: false });
});

test("words find lines; small typos still match; literal matches come first", async () => {
  const word = rows[3].particular.split(/\s+/).find((w) => w.length > 4) || rows[3].particular;
  const res = await index.search(word);
  assert.ok(res.length > 0);
  assert.ok(items(res).some((r) => r.particular.toLowerCase().includes(word.toLowerCase())));
  const firstOther = items(res).findIndex((r) => !Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(word.toLowerCase())));
  if (firstOther >= 0) assert.ok(items(res).slice(firstOther).every((r) => !Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(word.toLowerCase()))));
});

test("Exact, phrases, excludes and project filters work as on the purchase orders", async () => {
  const code = rows[0].project_code;
  const exact = await index.search(code, { exact: true });
  assert.ok(exact.length > 0 && items(exact).every((r) => Object.values(r).some((v) => typeof v === "string" && v.includes(code))));
  const byCode = await index.search(`project_code:"${code}"`);
  assert.ok(byCode.length > 0 && items(byCode).every((r) => r.project_code === code));
  const notCode = await index.search(`project_code:"${code}" -"${rows[0].particular}"`);
  assert.ok(items(notCode).every((r) => !r.particular.includes(rows[0].particular)));
  const supplier = await index.search(`supplier_account_name:'Sample'`);
  assert.equal(supplier.length, 0, "a field lines don't have matches no line");
  assert.deepEqual(Object.keys(LINE_FIELDS).sort(), ["business_unit", "particular_item", "project_code", "project_name"]);
});

test("at about the same score, lines in a final CE come first, then the newest price", () => {
  const a = { item: { in_final: false, price_date: "2026-09-01" }, score: 0.01 };
  const b = { item: { in_final: true, price_date: "2026-01-01" }, score: 0.02 };
  const c = { item: { in_final: true, price_date: "2026-05-01" }, score: 0.0 };
  assert.deepEqual([a, b, c].sort(lineSort), [c, b, a]);
  const all = index.all();
  const firstOther = all.findIndex((x) => !x.item.in_final);
  assert.ok(firstOther > 0 && all.slice(firstOther).every((x) => !x.item.in_final), "Browse all: final CE lines first");
});

test("a shared link can open the Line Items tab; quantities read as people write them", () => {
  assert.equal(decodeState("?q=led&tab=lines").tab, "lines");
  assert.equal(decodeState("?tab=nonsense").tab, undefined);
  assert.equal(lineQty({ qty: 2, frq: 3 }), "2 × 3");
  assert.equal(lineQty({ qty: 4, frq: 1 }), "4");
  assert.equal(lineQty({ qty: null, frq: null }), "1");
});

// ---- the Line Items tab's own filters, sort and groups ------------------------------------
import { defaultLineFilters, applyLineFilters, lineHiddenBy, groupLines, lineFilterCount, lineChoices,
  encodeLineFilters, decodeLineFilters, LINE_SORTS } from "../js/lines.js";

const listOf = () => index.all();

test("line filters: final CE, outcome, category and purchase orders, with what they leave out", () => {
  const all = listOf();
  const f = { ...defaultLineFilters(), final: "only" };
  const finals = applyLineFilters(all, f);
  assert.ok(finals.length > 0 && finals.every((r) => r.item.in_final));
  assert.equal(lineHiddenBy(all, f).final, all.length - finals.length);
  const won = applyLineFilters(all, { ...defaultLineFilters(), outcomes: new Set(["Won"]) });
  assert.ok(won.length > 0 && won.every((r) => r.item.outcome === "Won"));
  const cat = all[0].item.category;
  assert.ok(applyLineFilters(all, { ...defaultLineFilters(), categories: new Set([cat]) }).every((r) => r.item.category === cat));
  const withPo = applyLineFilters(all, { ...defaultLineFilters(), po: "yes" });
  const without = applyLineFilters(all, { ...defaultLineFilters(), po: "no" });
  assert.equal(withPo.length + without.length, all.length);
  assert.ok(withPo.every((r) => r.item.po_numbers || r.item.actual_php > 0));
  assert.equal(lineFilterCount(defaultLineFilters()), 0);
  assert.equal(lineFilterCount({ ...defaultLineFilters(), final: "only", po: "yes" }), 2);
  const outcomes = lineChoices(rows, "outcome", "Unknown");
  assert.ok(outcomes.length > 0 && outcomes[0][1] >= outcomes[outcomes.length - 1][1], "most common first");
});

test("line sorts put lines without a value last; groups total their line costs", () => {
  const all = listOf();
  const up = applyLineFilters(all, { ...defaultLineFilters(), sort: "unit-asc" }).map((r) => r.item.unit_price_php).filter((v) => v !== null);
  assert.deepEqual(up, up.slice().sort((a, b) => a - b));
  const down = applyLineFilters(all, { ...defaultLineFilters(), sort: "cost-desc" }).map((r) => r.item.base_price_php);
  assert.deepEqual(down, down.slice().sort((a, b) => b - a));
  const groups = groupLines(all, "project", "cost-desc");
  assert.ok(groups.length > 1);
  assert.ok(groups.every((g, i) => i === 0 || groups[i - 1].sumPhp >= g.sumPhp), "biggest total first with a cost sort");
  const g = groups[0];
  assert.equal(Math.round(g.sumPhp), Math.round(g.items.reduce((s, r) => s + (r.item.base_price_php || 0), 0)));
  assert.ok(Object.keys(LINE_SORTS).length >= 8);
});

test("line filters survive a shared link", () => {
  const f = { sort: "markup-desc", final: "other", outcomes: new Set(["Won", "Lost"]), categories: new Set(["Food & Beverage"]), po: "no", group: "category" };
  const back = decodeLineFilters(`?q=x&${encodeLineFilters(f).toString()}`);
  assert.deepEqual({ ...back, outcomes: [...back.outcomes], categories: [...back.categories] },
    { sort: "markup-desc", final: "other", outcomes: ["Won", "Lost"], categories: ["Food & Beverage"], po: "no", group: "category" });
  assert.equal(encodeLineFilters(defaultLineFilters()).toString(), "", "defaults stay out of the link");
  assert.deepEqual(decodeLineFilters("?lsort=nonsense&lfinal=maybe"), {});
});

/* ---- the CE in Google Sheets, from the Universe ---- */
import { ceSheetLinks, projectKey } from "../js/lines.js";
test("Universe records give each project code its CE link (https only, first one wins)", () => {
  const items = [
    { fields: { "Project Code": [{ text: "2025TEG-P0220", type: "text" }], "Internal CE (Sheet)": { link: "https://docs.google.com/spreadsheets/d/A/edit", text: "x" } } },
    { fields: { "Project Code": [{ text: "2025teg-p0220 ", type: "text" }], "Internal CE (Sheet)": { link: "https://docs.google.com/spreadsheets/d/B/edit" } } },
    { fields: { "Project Code": [{ text: "P2", type: "text" }], "Internal CE (Sheet)": { link: "javascript:alert(1)" } } },
    { fields: { "Project Code": [{ text: "P3", type: "text" }] } },
    { fields: { "Internal CE (Sheet)": { link: "https://docs.google.com/x" } } },
  ];
  const m = ceSheetLinks(items);
  assert.equal(m.size, 1);
  assert.equal(m.get(projectKey("2025teg-p0220")), "https://docs.google.com/spreadsheets/d/A/edit");
  assert.equal(m.get("P2"), undefined);
});

test("a line search returns every match, not just 500", async () => {
  // About 1,100 lines: the sample ten times over, each with its own key.
  const many = [];
  for (let i = 0; i < 10; i++) for (const r of fx.rows) many.push(r.map((v, c) => (fx.columns[c] === "line_key" ? `${v}#${i}` : v)));
  const big = createLineIndex();
  await big.build(toLineRows(fx.columns, many));
  const word = (await big.search("a")).length;
  const scan = (await big.search("a", { exact: true })).length;
  const lit = many.length;
  assert.ok(scan > 500, `Exact found ${scan}`);
  assert.ok(word > 500, `a word search found ${word}`);
  assert.ok(scan <= lit && word <= lit);
});
