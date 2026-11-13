/* The saved copy of the records (js/cache.js), on the made-up sample. Offline: node --test tests/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toRows } from "../js/rows.js";
import { pack, unpack, cacheKey, NOT_SAVED, ownerOf, CACHE_VERSION } from "../js/cache.js";

const fx = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const rows = toRows(fx.records);

test("a saved copy comes back as the same rows, ids included, without the bank details", async () => {
  const saved = await pack(rows, { owner: "ana@example.com", at: 1234 });
  assert.equal(saved.v, CACHE_VERSION);
  assert.equal(saved.n, rows.length);
  assert.ok(JSON.stringify(saved).length < JSON.stringify(rows).length / 3, "compressed well below the plain size");
  const back = await unpack(saved, "ana@example.com");
  assert.equal(back.at, 1234);
  assert.equal(back.rows.length, rows.length);
  back.rows.forEach((r, i) => {
    assert.equal(r.$id, rows[i].$id);
    assert.deepEqual(Object.keys(r), Object.keys(rows[i]));
    for (const c of Object.keys(r)) assert.equal(r[c], NOT_SAVED.includes(c) ? "" : rows[i][c], c);
  });
  assert.ok(rows.some((r) => r["Supplier Details_Account Number"]), "the sample has account numbers to leave out");
  assert.ok(!/0000-\d{4}-SAMPLE/.test(Buffer.from(saved.z, "base64").toString("latin1")), "not even compressed");
});

test("someone else's copy, an old format or a damaged one is refused", async () => {
  const saved = await pack(rows.slice(0, 5), { owner: "ana@example.com" });
  assert.equal(await unpack(saved, "ben@example.com"), null);
  assert.equal(await unpack(saved, ""), null);
  assert.equal(await unpack({ ...saved, v: 0 }, "ana@example.com"), null);
  assert.equal(await unpack({ ...saved, z: "not base64!" }, "ana@example.com"), null);
  assert.equal(await unpack({ ...saved, n: 6 }, "ana@example.com"), null);
  assert.equal(await unpack(null, "ana@example.com"), null);
});

test("keys and owners", () => {
  assert.equal(cacheKey({ app: "NP7", table: "tbl3" }), "suppliers.cache.NP7:tbl3");
  assert.equal(ownerOf({ email: "a@x", name: "A" }), "a@x");
  assert.equal(ownerOf({ email: "", name: "A" }), "A");
  assert.equal(ownerOf(null), "");
});

/* ---- the saved copy of the CE line items (made-up sample, tests/lines-fixture.json) ---- */
import { packLines, unpackLines, LINES_KEY, LINES_CACHE_VERSION } from "../js/cache.js";
import { toLineRows } from "../js/lines.js";
const lx = JSON.parse(readFileSync(new URL("./lines-fixture.json", import.meta.url), "utf8"));

test("saved line items come back as the same line rows, with when the service built them", async () => {
  const saved = await packLines(lx.columns, lx.rows, { owner: "ana@example.com", at: 99, built: "2026-11-12T07:41:38Z" });
  assert.equal(saved.v, LINES_CACHE_VERSION);
  assert.equal(LINES_KEY, "suppliers.lines");
  const back = await unpackLines(saved, "ana@example.com");
  assert.equal(back.at, 99);
  assert.equal(back.built, "2026-11-12T07:41:38Z");
  const a = toLineRows(lx.columns, lx.rows), b = toLineRows(back.columns, back.rows);
  assert.deepEqual(b, a);
  assert.deepEqual(b.map((r) => r.$id), a.map((r) => r.$id));
});

test("saved line items: someone else's, an old format or a damaged copy is refused", async () => {
  const saved = await packLines(lx.columns, lx.rows.slice(0, 5), { owner: "ana@example.com" });
  assert.equal(await unpackLines(saved, "ben@example.com"), null);
  assert.equal(await unpackLines(saved, ""), null);
  assert.equal(await unpackLines({ ...saved, v: 0 }, "ana@example.com"), null);
  assert.equal(await unpackLines({ ...saved, z: "not base64!" }, "ana@example.com"), null);
  assert.equal(await unpackLines({ ...saved, n: 6 }, "ana@example.com"), null);
  assert.equal(await unpackLines({ ...saved, columns: null }, "ana@example.com"), null);
});

test("a full table's worth of line items fits browser storage beside the records", async () => {
  // About 12,000 lines, varied like real ones (the sample repeated with its numbers and keys changed).
  const many = [];
  for (let i = 0; many.length < 12200; i++) {
    for (const r of lx.rows) many.push(r.map((v) => (typeof v === "number" ? v * (1 + (i % 97) / 100) + i : typeof v === "string" && v ? `${v} ${i}` : v)));
  }
  const saved = await packLines(lx.columns, many, { owner: "ana@example.com" });
  const size = JSON.stringify(saved).length * 2;   // localStorage counts UTF-16 code units
  assert.ok(size < 3 * 1024 * 1024, `saved copy is ${(size / 1048576).toFixed(2)} MB`);
});
