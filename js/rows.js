/*
 * Lark records -> the rows Suppliers searches and shows. Pure functions: no DOM, no network.
 *
 * A row is a plain object keyed exactly by the Lark column names (schema.js COLUMNS), every
 * value a string, as the old spreadsheet gave them, so search and display don't care where the
 * data came from:
 *   - link columns ({link, text}) give their text, plus a "<name>_URL" column with the link
 *   - date columns (milliseconds) give "YYYY-MM-DD HH:MM:SS" at the Base's zone (UTC+8),
 *     whatever the viewer's own time zone
 *   - everything else is flattened to text (cellText)
 * The Lark record id rides along as row.$id, which is not enumerable, so it never takes part
 * in a search (search looks at Object.values(row)).
 */
import { COLUMNS, LINK_COLUMNS, DATE_COLUMNS } from "./schema.js";

const pad = (n) => (n < 10 ? "0" + n : String(n));

/** Lark cell -> plain text. Shapes seen in this table: string, number, rich-text segments
 *  [{type:"text", text}], ["plain"], people [{name, en_name, email}], {link, text}, and
 *  lookups / formulas {type, value: [...]}. Rich-text segments join seamlessly; lists join
 *  with ", ". */
export function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const segments = v.length > 0 && v.every((x) => x && typeof x === "object" && typeof x.type === "string" && typeof x.text === "string");
    return v.map((e) => {
      if (e === null || e === undefined) return "";
      if (typeof e === "string" || typeof e === "number") return String(e);
      if (typeof e !== "object") return "";
      if ("value" in e && !("text" in e)) return cellText(e.value);
      return e.text || e.name || e.en_name || e.email || "";
    }).filter(Boolean).join(segments ? "" : ", ");
  }
  if (typeof v === "object") {
    if ("value" in v) return cellText(v.value);   // lookup / formula
    return v.text || v.name || "";
  }
  return "";
}

/** A date cell -> milliseconds, or null. Accepts a number, digits, or a lookup/formula holding one. */
export function dateMs(v) {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === "string" && /^\d{9,}$/.test(v.trim())) return Number(v.trim());
  if (Array.isArray(v)) return v.length ? dateMs(v[0]) : null;
  if (v && typeof v === "object" && "value" in v) return dateMs(v.value);
  return null;
}

/** Milliseconds -> "YYYY-MM-DD HH:MM:SS" at the Base's zone ("" when it isn't a date).
 *  Built from UTC getters on a shifted timestamp, so the viewer's own zone doesn't matter. */
export function formatDate(ms, offsetMinutes = 480) {
  const n = dateMs(ms);
  if (n === null) return "";
  const d = new Date(n + offsetMinutes * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** One Lark record's fields -> one row keyed exactly like the columns. */
export function recordToRow(fields, offsetMinutes = 480) {
  const row = {};
  fields = fields || {};
  for (const { name } of COLUMNS) {
    const raw = fields[name];
    if (LINK_COLUMNS.has(name)) {
      const isObj = raw && typeof raw === "object" && !Array.isArray(raw) && ("link" in raw || "text" in raw);
      row[name] = isObj ? String(raw.text || "") : cellText(raw);
      row[`${name}_URL`] = isObj ? String(raw.link || "") : "";
    } else if (DATE_COLUMNS.has(name)) {
      row[name] = formatDate(raw, offsetMinutes);
    } else {
      row[name] = cellText(raw);
    }
  }
  return row;
}

/** A row with nothing in it (Lark keeps empty records around). */
export const isBlankRow = (row) => !Object.values(row).some((v) => typeof v === "string" && v.trim() !== "");

/** Lark items ({record_id, fields}) -> rows, blank ones dropped, each carrying its record id. */
export function toRows(items, offsetMinutes = 480) {
  const out = [];
  for (const it of items || []) {
    const row = recordToRow(it && it.fields, offsetMinutes);
    if (isBlankRow(row)) continue;
    Object.defineProperty(row, "$id", { value: String((it && it.record_id) || ""), enumerable: false });
    out.push(row);
  }
  return out;
}

/** The row's column list with the "_URL" companions after their parent (the old spreadsheet's order). */
export function headers() {
  const out = [];
  for (const { name } of COLUMNS) {
    out.push(name);
    if (LINK_COLUMNS.has(name)) out.push(`${name}_URL`);
  }
  return out;
}

// ---- dates as people read them ----------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = (s) => /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/.exec(String(s || ""));

/** "2026-10-14 09:30:00" -> "Oct 14, 2026" ("" when it isn't a date). */
export function dayLabel(s) {
  const m = parts(s);
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : "";
}

/** "2026-10-14 09:30:00" -> "Oct 14, 2026 · 9:30 AM"; a midnight value is shown as the day only. */
export function dateTimeLabel(s) {
  const m = parts(s);
  if (!m) return "";
  const day = dayLabel(s);
  if (!m[4] || (m[4] === "00" && m[5] === "00")) return day;
  const h = +m[4];
  return `${day} · ${h % 12 || 12}:${m[5]} ${h < 12 ? "AM" : "PM"}`;
}

/** A row's time as a number for sorting ("" -> 0). The strings are already UTC+8 wall time,
 *  so comparing them as UTC keeps their order exact. */
export function sortTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?/.exec(String(s || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : 0;
}
