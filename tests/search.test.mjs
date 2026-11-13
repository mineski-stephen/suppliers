/* Search (js/search.js) on the made-up sample (tests/fixture.json). Offline: node --test tests/ */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toRows } from "../js/rows.js";
import { createIndex, TAB_FIELDS } from "../js/search.js";

const fx = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const rows = toRows(fx.records);
const index = createIndex();
before(async () => { await index.build(rows); });
const items = (list) => list.map((x) => x.item);
const has = (row, text, fields) => (fields ? fields.map((f) => row[f]) : Object.values(row)).some((v) => typeof v === "string" && v.toLowerCase().includes(text.toLowerCase()));

test("the sample is made up and complete", () => {
  assert.match(fx.note, /Made-up sample data/);
  assert.equal(rows.length, fx.records.length - 1);   // one blank record is dropped
  assert.ok(rows.every((r) => /^Sample |^$/.test(r["Supplier Details_Supplier Name"]) || r["Supplier Details_Supplier Name"].startsWith("Sample")));
});

test("words: best matches first, rows with the words literally before the rest, small typos match", async () => {
  const res = await index.search("lighting");
  assert.ok(res.length > 0);
  assert.ok(items(res).every((r) => has(r, "lighting")));
  const typo = await index.search("camra");
  assert.ok(typo.length > 0 && items(typo).some((r) => /Camera/.test(r["Particulars_Item"])));
  const two = await index.search("lighting rental");
  const firstOther = items(two).findIndex((r) => !has(r, "lighting rental"));
  if (firstOther >= 0) assert.ok(items(two).slice(firstOther).every((r) => !has(r, "lighting rental")), "literal matches come first");
});

test("within the same score, Approved comes before the other statuses", async () => {
  const res = await index.search(`particular_item:"Lighting rental (3 days)"`);
  const order = ["Approved", "Under Review", "Rejected", "Recalled"];
  const seen = items(res).map((r) => order.indexOf(r.Status));
  assert.deepEqual(seen, seen.slice().sort((a, b) => a - b));
});

test("tabs search only their columns", async () => {
  const res = await index.search("Sample Feast", { tab: "particulars" });
  assert.equal(res.length, 0, "no item is called Sample Feast");
  const sup = await index.search("Feast", { tab: "suppliers" });
  assert.ok(sup.length > 0);
  const exact = await index.search("feast catering", { tab: "suppliers", exact: true });
  assert.ok(items(exact).every((r) => has(r, "feast catering", TAB_FIELDS.suppliers)));
});

test("exact: a substring anywhere, any case", async () => {
  const no = rows[5]["Request No."];
  const res = await index.search(no, { exact: true });
  assert.ok(items(res).some((r) => r["Request No."] === no));
  assert.ok(items(res).every((r) => has(r, no)));
});

test("field filters alone, and with words", async () => {
  const only = await index.search(`project_code:"2026TEG-P0290"`);
  assert.ok(only.length > 0 && items(only).every((r) => r["Project Code"] === "2026TEG-P0290"));
  const contains = await index.search(`project_code:'2026TEG'`);
  assert.ok(items(contains).every((r) => r["Project Code"].includes("2026TEG")));
  assert.ok(contains.length > only.length);
  const both = await index.search(`project_code:'2026TEG' catering`);
  assert.ok(both.length > 0 && items(both).every((r) => r["Project Code"].includes("2026TEG")));
});

test("phrases and excludes", async () => {
  const phrase = await index.search(`"LED wall"`);
  assert.ok(phrase.length > 0 && items(phrase).every((r) => has(r, "LED wall")));
  const minus = await index.search("-catering");
  assert.ok(minus.length > 0 && items(minus).every((r) => !has(r, "catering")));
  const mixed = await index.search(`rental -lighting`);
  assert.ok(mixed.length > 0 && items(mixed).every((r) => !has(r, "lighting")));
});

test("at most 500 results; value suggestions are distinct", async () => {
  const all = await index.search("Sample");
  assert.ok(all.length <= 500);
  const vals = index.fieldValues("project_code", "2026teg", 8);
  assert.ok(vals.length > 0 && vals.length <= 8 && new Set(vals).size === vals.length && vals.every((v) => v.includes("2026TEG")));
  assert.deepEqual(index.fieldValues("nope", "x"), []);
  assert.deepEqual(await index.search("   "), []);
});

test("a purchase-order search returns every match, not just 500", async () => {
  // The sample (about 420 records) twice over, each copy with its own record id.
  const twice = [...rows, ...rows.map((r) => Object.defineProperty({ ...r }, "$id", { value: `${r.$id}-2`, enumerable: false }))];
  const big = createIndex();
  await big.build(twice);
  const all = (await big.search("a", { exact: true })).length;
  assert.ok(all > 500, `Exact found ${all}`);
  const once = (await index.search("rental")).length;
  assert.equal((await big.search("rental")).length, once * 2, "a word search keeps every copy");
  assert.equal((await big.search("a", { exact: true, limit: 10 })).length, 10, "a limit still works when asked for");
});
