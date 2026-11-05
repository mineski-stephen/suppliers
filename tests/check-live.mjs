/* Checks the live procurement table, read-only: npm run check:live
     1. the table link in js/config.js parses
     2. every column Suppliers reads is there (required ones must be), date columns are dates
     3. every record can be read in full (paging that never stops early) and mapped to rows
   It reads with the Lark app's own tenant token (from a git-ignored .env, see tests/lark-node.mjs),
   straight from Lark, never through the connection service. It writes nothing. It prints counts
   only: no record's contents (the table holds suppliers' bank details).
   If the Lark app can't open the Base (only people can), it says so: then check in the browser. */

import { pathToFileURL } from "node:url";
import { APP, LARK, tableLinks } from "../js/config.js";
import { parseBaseLink, loadFields, loadRecords } from "../js/tables.js";
import { checkSchema } from "../js/schema.js";
import { toRows } from "../js/rows.js";
import { statsOf } from "../js/query.js";
import { tenantToken, makeCall } from "./lark-node.mjs";

export async function checkLive(call, link, say = console.log) {
  let failures = 0;
  const t = parseBaseLink(link);
  say(`Procurement table: ${t.url}`);
  const fields = await loadFields(call, t);
  const schema = checkSchema(fields);
  say(`  ${schema.problems.length ? "✗" : "✓"} ${fields.length} columns; ${schema.present.length} of the ones Suppliers reads are there`);
  for (const p of schema.problems) { say(`  ✗ ${p}`); failures++; }
  for (const n of schema.notes) say(`  · ${n}`);
  if (schema.problems.length) return failures;
  let total = null;
  const items = await loadRecords(call, t, schema.present, (n, of) => { total = of; });
  const rows = toRows(items, LARK.tzOffsetMinutes);
  const s = statsOf(rows);
  say(`  ✓ read ${items.length.toLocaleString()} records (${rows.length.toLocaleString()} not blank), ${s.suppliers.toLocaleString()} suppliers, newest ${s.newest || "none"}`);
  if (total !== null && total !== items.length) { say(`  ✗ Lark counted ${total}, but ${items.length} came back`); failures++; }
  const noId = rows.filter((r) => !r.$id).length;
  if (noId) { say(`  ✗ ${noId} rows have no record id`); failures++; }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const link = tableLinks().procurement;
    if (!link) throw new Error(`There's no procurement link for APP.env "${APP.env}" in js/config.js.`);
    const failures = await checkLive(makeCall(await tenantToken()), link);
    console.log(failures ? `\n${failures} problem(s).` : "\nThe live table checks out ✓");
    process.exitCode = failures ? 1 : 0;
  } catch (e) {
    const code = e.json && Number(e.json.code);
    console.log(`✗ ${e.message}`);
    if ([91403, 1254302].includes(code)) console.log("  The Lark app itself can't open this Base (only people can). Check it in the browser instead: log in and open Settings > Connections.");
    process.exitCode = 1;
  }
}
