/* Lark records -> rows (js/rows.js) and the column list (js/schema.js). Offline: node --test tests/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellText, dateMs, formatDate, recordToRow, toRows, isBlankRow, headers, dayLabel, dateTimeLabel, sortTime } from "../js/rows.js";
import { COLUMNS, LINK_COLUMNS, DATE_COLUMNS, checkSchema, T } from "../js/schema.js";

test("cellText flattens every shape the table has", () => {
  assert.equal(cellText(null), "");
  assert.equal(cellText("plain"), "plain");
  assert.equal(cellText(12500.5), "12500.5");
  assert.equal(cellText(true), "true");
  assert.equal(cellText([{ type: "text", text: "Lighting rental" }]), "Lighting rental");
  // rich text with a link in the middle joins without commas (the old page showed "Host, see , the brief")
  assert.equal(cellText([{ type: "text", text: "Host, see " }, { type: "url", text: "the brief", link: "https://x" }]), "Host, see the brief");
  assert.equal(cellText(["Option A", "Option B"]), "Option A, Option B");
  assert.equal(cellText([{ id: "ou_1", name: "Ana Reyes", email: "a@x" }, { id: "ou_2", en_name: "Ben Cruz" }]), "Ana Reyes, Ben Cruz");
  assert.equal(cellText({ link: "https://x", text: "202610140082" }), "202610140082");
  assert.equal(cellText({ type: 1, value: [{ type: "text", text: "from a lookup" }] }), "from a lookup");
  assert.equal(cellText({ type: 2, value: [42] }), "42");
  assert.equal(cellText([]), "");
});

test("dates are read as Manila wall time, whatever the computer's zone", () => {
  const ms = Date.UTC(2026, 9, 14, 1, 30, 5);   // 09:30:05 at UTC+8
  assert.equal(formatDate(ms), "2026-10-14 09:30:05");
  assert.equal(formatDate(String(ms)), "2026-10-14 09:30:05");
  assert.equal(formatDate({ type: 5, value: [ms] }), "2026-10-14 09:30:05");
  assert.equal(formatDate(Date.UTC(2026, 9, 13, 16, 0, 0)), "2026-10-14 00:00:00");   // a date-only cell: midnight at UTC+8
  assert.equal(formatDate(""), "");
  assert.equal(formatDate(0), "");
  assert.equal(formatDate("2026-10-14"), "");   // text isn't a date
  assert.equal(dateMs([ms]), ms);
});

test("people read dates in the family format", () => {
  assert.equal(dayLabel("2026-10-14 09:30:05"), "Oct 14, 2026");
  assert.equal(dateTimeLabel("2026-10-14 09:30:05"), "Oct 14, 2026 · 9:30 AM");
  assert.equal(dateTimeLabel("2026-10-14 13:05:00"), "Oct 14, 2026 · 1:05 PM");
  assert.equal(dateTimeLabel("2026-10-14 00:00:00"), "Oct 14, 2026");
  assert.equal(dayLabel(""), "");
  assert.ok(sortTime("2026-10-14 09:30:05") > sortTime("2026-10-14 09:30:04"));
  assert.equal(sortTime(""), 0);
});

test("a record becomes a row keyed by the column names, with _URL companions", () => {
  const ms = Date.UTC(2026, 9, 14, 1, 30, 0);
  const row = recordToRow({
    "Request No.": { link: "https://example.com/a/1", text: "202610140082" },
    "Status": "Approved",
    "Submitted at": ms,
    "Particulars_Item": [{ type: "text", text: "Camera rental" }],
    "Particulars_Price": 6500,
    "Particulars_Attachment": [{ type: "text", text: "not a link object" }],
  });
  assert.equal(row["Request No."], "202610140082");
  assert.equal(row["Request No._URL"], "https://example.com/a/1");
  assert.equal(row["Submitted at"], "2026-10-14 09:30:00");
  assert.equal(row["Particulars_Price"], "6500");
  assert.equal(row["Particulars_Attachment"], "not a link object");
  assert.equal(row["Particulars_Attachment_URL"], "");
  assert.equal(row["Project Name"], "");
  for (const v of Object.values(row)) assert.equal(typeof v, "string");
  assert.deepEqual(Object.keys(row), headers());
});

test("blank records are dropped and every row keeps its record id out of the search", () => {
  const rows = toRows([{ record_id: "rec1", fields: { "Status": "Approved" } }, { record_id: "rec2", fields: {} }, { record_id: "rec3", fields: { "Status": "  " } }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].$id, "rec1");
  assert.ok(!Object.values(rows[0]).includes("rec1"), "the id must not be searchable");
  assert.ok(isBlankRow(recordToRow({})));
});

test("the column list: names once, the five required ones, link and date kinds", () => {
  const names = COLUMNS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(COLUMNS.filter((c) => c.required).map((c) => c.name).sort(),
    ["Particulars_Item", "Project Name", "Request No.", "Status", "Supplier Details_Supplier Name"]);
  assert.deepEqual([...LINK_COLUMNS], ["Request No.", "Particulars_Attachment", "Supplier Details_Attachment"]);
  assert.deepEqual([...DATE_COLUMNS], ["Submitted at", "Completed at", "Supplier Details_Payment Date"]);
  assert.ok(names.length <= 50, "past 50 names the page would have to ask for every column");
});

test("checkSchema: required columns stop the page; optional ones and odd date columns are notes", () => {
  const all = COLUMNS.map((c) => ({ field_name: c.name, type: c.kind === "date" ? T.date : c.kind === "link" ? T.url : T.text }));
  assert.deepEqual(checkSchema(all).problems, []);
  assert.deepEqual(checkSchema(all).notes, []);
  assert.equal(checkSchema(all).present.length, COLUMNS.length);

  const noStatus = all.filter((f) => f.field_name !== "Status" && f.field_name !== "Project Name");
  const a = checkSchema(noStatus);
  assert.equal(a.problems.length, 1);
  assert.match(a.problems[0], /“Status”, “Project Name” are missing/);

  const noTalents = all.filter((f) => f.field_name !== "Talents required").map((f) => (f.field_name === "Completed at" ? { ...f, type: T.text } : f));
  const b = checkSchema(noTalents);
  assert.deepEqual(b.problems, []);
  assert.match(b.notes[0], /“Talents required” isn't in the table/);
  assert.match(b.notes[1], /“Completed at” is Text, not a date/);
  assert.ok(!b.present.includes("Talents required"));
});
