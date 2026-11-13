/*
 * The saved copy of the records, so the next visit shows them at once while the table is read
 * again behind them. No DOM; Node tests run it too.
 *
 *   localStorage "suppliers.cache.<app>:<table>" = { v, at, owner, n, cols, z }
 *     z      the rows, gzipped and base64 (about a tenth of the plain size: localStorage holds ~5 MB)
 *     owner  who logged in when it was saved (their Lark e-mail, else name). Another person's login
 *            never sees it: it's dropped instead.
 *
 * What is NOT saved: the supplier's account number, bank name and address. They come back with the
 * live read a few seconds later; until then the detail panel says so.
 *
 * It is dropped on Log out, by Clear local data, when someone else logs in, and when its format
 * changes (v). It is kept when a login simply runs out, so the next login starts from it (the person
 * asked for that; the standard would drop it at every session end, see the README).
 */
import { headers } from "./rows.js";

export const CACHE_VERSION = 1;
export const cacheKey = (t) => `suppliers.cache.${t.app}:${t.table}`;
/** Left out of the saved copy. */
export const NOT_SAVED = ["Supplier Details_Account Number", "Supplier Details_Bank Name", "Supplier Details_Business/Home Address"];

const b64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** Rows -> the object to store. Each row becomes [record id, ...values] in `cols` order. */
export async function pack(rows, { owner, at = Date.now() }) {
  const cols = headers().filter((c) => !NOT_SAVED.includes(c));
  const data = rows.map((r) => [r.$id, ...cols.map((c) => r[c] || "")]);
  return { v: CACHE_VERSION, at, owner, n: rows.length, cols, z: b64(await gzip(JSON.stringify(data))) };
}

/** The stored object -> { rows, at }, or null when it can't be used (another person's, an old format,
 *  damaged). Rows have every column (the ones not saved are ""), and their record id as row.$id. */
export async function unpack(saved, owner) {
  if (!saved || saved.v !== CACHE_VERSION || !owner || saved.owner !== owner || typeof saved.z !== "string") return null;
  try {
    const data = JSON.parse(await gunzip(unb64(saved.z)));
    const all = headers();
    const rows = data.map((d) => {
      const row = Object.fromEntries(all.map((c) => [c, ""]));
      saved.cols.forEach((c, i) => { if (c in row) row[c] = String(d[i + 1] || ""); });
      Object.defineProperty(row, "$id", { value: String(d[0] || ""), enumerable: false });
      return row;
    });
    return rows.length === saved.n ? { rows, at: Number(saved.at) || 0 } : null;
  } catch (_) { return null; }
}

/** Who a saved copy belongs to. */
export const ownerOf = (user) => (user && (user.email || user.name)) || "";

/* ---- the saved copy of the CE line items (the Line Items tab) ----------------------------------
 *   localStorage "suppliers.lines" = { v, at, owner, built, n, columns, z }
 *     z        the service's rows (arrays, in `columns` order), gzipped and base64
 *     built    when the line item service last rebuilt its lines: while it's the same, the lines
 *              aren't downloaded again (one small read still checks this person may see them)
 * They hold internal costs and markups. Dropped like the records' copy (Log out, Clear local data,
 * someone else's login, a new format), and also when the service refuses this person (403).
 */
export const LINES_CACHE_VERSION = 1;
export const LINES_KEY = "suppliers.lines";

/** The service's columns and rows -> the object to store. */
export async function packLines(columns, rows, { owner, built = null, at = Date.now() }) {
  return { v: LINES_CACHE_VERSION, at, owner, built, n: rows.length, columns: [...columns], z: b64(await gzip(JSON.stringify(rows))) };
}

/** The stored object -> { columns, rows, at, built }, or null when it can't be used. */
export async function unpackLines(saved, owner) {
  if (!saved || saved.v !== LINES_CACHE_VERSION || !owner || saved.owner !== owner || typeof saved.z !== "string" || !Array.isArray(saved.columns)) return null;
  try {
    const rows = JSON.parse(await gunzip(unb64(saved.z)));
    return Array.isArray(rows) && rows.length === saved.n ? { columns: saved.columns, rows, at: Number(saved.at) || 0, built: saved.built || null } : null;
  } catch (_) { return null; }
}
