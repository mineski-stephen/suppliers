/* Table links and full-table reads (js/tables.js) against a fake Lark. Offline: node --test tests/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBaseLink, tableUrl, loadFields, loadRecords, MAX_PAGES } from "../js/tables.js";
import { TABLES } from "../js/config.js";

test("table links parse; anything else gets a plain sentence", () => {
  const t = parseBaseLink(TABLES.live.procurement);
  assert.equal(t.table, "tbl3ki9aAQsWCJuR");
  assert.match(t.url, /^https:\/\/mineskiglobal\.larksuite\.com\/base\//);
  assert.match(tableUrl(t), /\/bitable\/v1\/apps\/[A-Za-z0-9]+\/tables\/tbl3ki9aAQsWCJuR$/);
  assert.deepEqual(parseBaseLink("https://x.larksuite.com/base/abc123?table=tblX1&view=vewY").view, "vewY");
  assert.throws(() => parseBaseLink("not a link"), /That isn't a link\./);
  assert.throws(() => parseBaseLink("http://x.larksuite.com/base/abc?table=tblX"), /starts with https/);
  assert.throws(() => parseBaseLink("https://x.larksuite.com/wiki/abc?table=tblX"), /wiki page/);
  assert.throws(() => parseBaseLink("https://x.larksuite.com/base/abc"), /isn't a Lark table link/);
  assert.equal(TABLES.test.procurement, "", "the test copy isn't set up: the page must refuse rather than fall back to live");
});

/** A fake Lark: `pages` pages of records; `broken` drops the page token on that page. */
function fakeLark({ records = 1234, pageSize = 500, broken = -1, endless = false } = {}) {
  const calls = [];
  const call = async (method, url, body, opts) => {
    calls.push({ method, url, body, opts });
    if (/\/fields/.test(url)) return { code: 0, data: { items: [{ field_name: "Status", type: 3 }], has_more: false } };
    const start = Number((url.match(/page_token=(\d+)/) || [])[1] || 0);
    const items = Array.from({ length: Math.max(0, Math.min(pageSize, records - start)) }, (_, i) => ({ record_id: `rec${start + i}`, fields: {} }));
    const more = endless || start + pageSize < records;
    const page = calls.filter((c) => /records/.test(c.url)).length - 1;
    return { code: 0, data: { items, has_more: more, page_token: more && page !== broken ? String(start + pageSize) : "", total: records } };
  };
  return { call, calls };
}

test("every page is read, as reads, with only the columns asked for, and no view", async () => {
  const { call, calls } = fakeLark({ records: 1234 });
  const seen = [];
  const items = await loadRecords(call, parseBaseLink(TABLES.live.procurement), ["Status"], (n, total) => seen.push([n, total]));
  assert.equal(items.length, 1234);
  assert.deepEqual(seen, [[500, 1234], [1000, 1234], [1234, 1234]]);
  for (const c of calls) {
    assert.equal(c.method, "POST");
    assert.equal(c.opts.read, true);
    assert.deepEqual(c.body, { automatic_fields: false, field_names: ["Status"] });
    assert.match(c.url, /records\/search\?page_size=500/);
    assert.doesNotMatch(c.url, /view_id/);
  }
});

test("a missing page token throws instead of returning a partial list", async () => {
  const { call } = fakeLark({ records: 1234, broken: 1 });
  await assert.rejects(loadRecords(call, parseBaseLink(TABLES.live.procurement)), /gave no page token, so the list would be incomplete/);
});

test("a table that never ends stops at the page guard and says so", { timeout: 60000 }, async () => {
  const { call, calls } = fakeLark({ records: 10, pageSize: 1, endless: true });
  await assert.rejects(loadRecords(call, parseBaseLink(TABLES.live.procurement)), /Stopped after 200 pages/);
  assert.equal(calls.length, MAX_PAGES);
});

test("columns are read in full too", async () => {
  let n = 0;
  const call = async (method, url) => {
    n++;
    if (n === 1) return { code: 0, data: { items: [{ field_name: "A" }], has_more: true, page_token: "p2" } };
    assert.match(url, /page_token=p2/);
    return { code: 0, data: { items: [{ field_name: "B" }], has_more: false } };
  };
  assert.deepEqual((await loadFields(call, parseBaseLink(TABLES.live.procurement))).map((f) => f.field_name), ["A", "B"]);
  const broken = async () => ({ code: 0, data: { items: [], has_more: true } });
  await assert.rejects(loadFields(broken, parseBaseLink(TABLES.live.procurement)), /no page token/);
});
