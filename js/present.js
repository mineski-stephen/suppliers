/*
 * How a record's parts look, shared by the result list, the recent strip and the detail panel.
 * DOM built with h() only: text from Lark is always set as text, never as HTML.
 */
import { h } from "./ui.js";
import { markRuns, outsourceParts, priceText, currencyOf } from "./query.js";
import { lineQty } from "./lines.js";
export { lineQty };

/** Lark's status -> the family's badge colours (tokens-and-color.md, status mapping). */
const STATUS_TONE = { "approved": "badge-ok", "under review": "badge-info", "rejected": "badge-err", "recalled": "badge-muted" };
export const statusBadge = (status) => {
  const s = String(status || "").trim();
  return s ? h("span", { class: `badge ${STATUS_TONE[s.toLowerCase()] || "badge-muted"}` }, s) : null;
};

/** Text with the search terms marked. */
export const marked = (text, terms) =>
  markRuns(text, terms).map((r) => (r.mark ? h("mark", null, r.text) : r.text));

/** An item name: marked, with "outsourced" shown as a badge. */
export const itemNodes = (text, terms) =>
  outsourceParts(text).map((p) => (p.badge ? h("span", { class: "badge badge-violet out-badge" }, "Outsourced") : marked(p.text, terms)));

/** The price lines of a row: { unit: "PHP 1,500.00" | "", total: "…" | "", qty: "2" }. */
export function pricesOf(row, show, rate) {
  const cur = currencyOf(row);
  return {
    qty: String(row["Particulars_Quantity"] || "").trim(),
    unit: priceText(row["Particulars_Unit Price"], cur, show, rate),
    total: priceText(row["Particulars_Price"], cur, show, rate),
  };
}

/** A CE line item's badge: in the project's final CE, or only in another version. */
export const lineBadge = (row) => (row.in_final
  ? h("span", { class: "badge badge-ok", title: "This line is in the project's final CE" }, "Final CE")
  : h("span", { class: "badge badge-muted", title: `Only in other versions of the CE${row.version_role ? ` (${row.version_role})` : ""}` }, "Other version"));

/** The supplier's name as people know it (the account name when the name is blank). */
export const supplierOf = (row) => row["Supplier Details_Supplier Name"] || row["Supplier Details_Account Name"] || "";
