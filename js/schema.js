/*
 * The procurement table: the columns Suppliers reads, and the check that the live table
 * still has them. Pure functions: no DOM, no network.
 *
 * COLUMNS is the one list of columns (names exactly as in Lark, letter for letter). The row
 * mapping (rows.js), the load-time check and tests/check-live.mjs all read it.
 *   required  the page can't work without it: loading stops and says which are missing
 *   kind      "date": Lark gives milliseconds (shown at UTC+8); "link": Lark gives {link, text}
 *             and the row gets a "<name>_URL" companion; otherwise plain text
 * Every other column is optional: if Lark doesn't have it, it's left out and Settings says so.
 */

/** Lark field type ids, and their names for messages. */
export const T = { text: 1, number: 2, select: 3, multi: 4, date: 5, checkbox: 7, user: 11, url: 15, attachment: 17,
                   link: 18, lookup: 19, formula: 20, created: 1001, modified: 1002 };
export const TYPE_NAMES = { 1: "Text", 2: "Number", 3: "Single select", 4: "Multi select", 5: "Date", 7: "Checkbox",
                            11: "Person", 13: "Phone", 15: "URL", 17: "Attachment", 18: "Link", 19: "Lookup", 20: "Formula",
                            1001: "Created time", 1002: "Last modified time" };
/** Column types that hold a date Suppliers can read (a lookup or formula may give one too). */
const DATE_TYPES = [T.date, T.created, T.modified, T.lookup, T.formula];

// The order is the old spreadsheet's, which the detail view and exact search follow.
export const COLUMNS = [
  { name: "Request No.", kind: "link", required: true },
  { name: "Status", required: true },
  { name: "Approval process" },
  { name: "Submitted at", kind: "date" },
  { name: "Completed at", kind: "date" },
  { name: "Requester" },
  { name: "Initiator department" },
  { name: "Current assignee" },
  { name: "Approval steps" },
  { name: "Cost Type" },
  { name: "Business Unit" },
  { name: "Project Name", required: true },
  { name: "Project Code" },
  { name: "Project Manager" },
  { name: "Associated Procurement Request" },
  { name: "Talents required" },
  { name: "Charged to" },
  { name: "Are Particulars overbudget?" },
  { name: "Particulars_Item", required: true },
  { name: "Particulars_Quantity" },
  { name: "Particulars_Unit Price" },
  { name: "Particulars_Unit Price-Currency" },
  { name: "Particulars_Price" },
  { name: "Particulars_Attachment", kind: "link" },
  { name: "Supplier Details_Form of Payment" },
  { name: "Supplier Details_Account Name" },
  { name: "Supplier Details_Account Number" },
  { name: "Supplier Details_Bank Name" },
  { name: "Supplier Details_Business/Home Address" },
  { name: "Supplier Details_Payment Date", kind: "date" },
  { name: "Supplier Details_Terms" },
  { name: "Supplier Details_Attachment", kind: "link" },
  { name: "SourceID" },
  { name: "Supplier Details_Supplier Name", required: true },
  { name: "Budget/Terms" },
  { name: "Requester1" },
];

export const TABLE_TITLE = "Procurement";
export const COLUMN_NAMES = COLUMNS.map((c) => c.name);
export const LINK_COLUMNS = new Set(COLUMNS.filter((c) => c.kind === "link").map((c) => c.name));
export const DATE_COLUMNS = new Set(COLUMNS.filter((c) => c.kind === "date").map((c) => c.name));

const quote = (names) => names.map((n) => `“${n}”`).join(", ");

/** Check the live fields. Returns
 *    problems  sentences that stop the page (a required column is missing)
 *    notes     sentences that don't (an optional column is missing, or a date column isn't a date)
 *    missing   the names of every column the table doesn't have
 *    present   the column names to request (Lark rejects unknown names) */
export function checkSchema(fields) {
  const byName = new Map((fields || []).map((f) => [f.field_name, f]));
  const missing = COLUMNS.filter((c) => !byName.has(c.name));
  const required = missing.filter((c) => c.required).map((c) => c.name);
  const optional = missing.filter((c) => !c.required).map((c) => c.name);
  const problems = required.length
    ? [`${TABLE_TITLE}: ${required.length === 1 ? "column" : "columns"} ${quote(required)} ${required.length === 1 ? "is" : "are"} missing.`]
    : [];
  const notes = [];
  if (optional.length) {
    notes.push(`${TABLE_TITLE}: ${optional.length === 1 ? "column" : "columns"} ${quote(optional)} ${optional.length === 1 ? "isn't" : "aren't"} in the table, so ${optional.length === 1 ? "it's" : "they're"} left out.`);
  }
  for (const c of COLUMNS) {
    const f = byName.get(c.name);
    if (f && c.kind === "date" && !DATE_TYPES.includes(f.type)) {
      notes.push(`${TABLE_TITLE}: column “${c.name}” is ${TYPE_NAMES[f.type] || `type ${f.type}`}, not a date, so its dates are left out.`);
    }
  }
  return { problems, notes, missing: missing.map((c) => c.name), present: COLUMNS.filter((c) => byName.has(c.name)).map((c) => c.name) };
}
