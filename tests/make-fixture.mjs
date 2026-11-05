/* Writes tests/fixture.json: a MADE-UP procurement table for preview mode and the offline tests.
   Run: npm run preview:fixture

   Every name, number, supplier, bank account and link in it is invented (suppliers are
   "Sample …", accounts are "0000-…", links point at example.com). It never holds real data, so
   it's safe to commit. The values are in the exact shapes Lark's API returns (rich-text segments,
   people, URL objects, dates in milliseconds, select names), so the page and the tests read it
   through the same code as the real table. Deterministic: the same file every run. */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COLUMNS, T } from "../js/schema.js";

// A small seeded random generator (mulberry32), so the file is the same every time.
let seed = 20261105;
const rand = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (list) => list[Math.floor(rand() * list.length)];
const weighted = (pairs) => { let r = rand() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) { if ((r -= w) < 0) return v; } return pairs[0][0]; };

const TYPES = {
  "Request No.": T.url, "Status": T.select, "Submitted at": T.date, "Completed at": T.date, "Requester": T.user,
  "Current assignee": T.user, "Project Manager": T.user, "Cost Type": T.select, "Business Unit": T.select, "Charged to": T.select,
  "Are Particulars overbudget?": T.select, "Particulars_Quantity": T.number, "Particulars_Unit Price": T.number,
  "Particulars_Unit Price-Currency": T.select, "Particulars_Price": T.number, "Particulars_Attachment": T.url,
  "Supplier Details_Form of Payment": T.select, "Supplier Details_Payment Date": T.date, "Supplier Details_Attachment": T.url,
};
const fields = COLUMNS.map((c, i) => ({ field_id: `fldSample${String(i).padStart(3, "0")}`, field_name: c.name, type: TYPES[c.name] || T.text }));

const text = (s) => [{ type: "text", text: s }];
const person = (name) => [{ id: `ou_sample_${name.toLowerCase().replace(/\W+/g, "_")}`, name, en_name: name, email: `${name.split(" ")[0].toLowerCase()}@example.com` }];
const DAY = 864e5, OFFSET = 8 * 3600e3;
const manilaMidnight = (ms) => Math.floor((ms + OFFSET) / DAY) * DAY - OFFSET;

const PEOPLE = ["Ana Reyes", "Ben Cruz", "Carla Santos", "Dan Lim", "Ella Tan", "Fred Go", "Gia Ramos", "Hugo Dela Cruz"];
const UNITS = ["Events", "Studio", "Tournament Ops", "Brand Partnerships", "Talent"];
const PROJECTS = [
  ["2026TEG-P0101", "Sample Regional Finals"], ["2026TEG-P0145", "Sample Campus Cup"], ["2026TEG-P0290", "Sample Pro League Season 3"],
  ["2026MSK-P0045", "Sample Creator Summit"], ["2026MSK-P0072", "Sample Brand Activation Mall Tour"], ["2025TEG-P0333", "Sample Year-End Showdown"],
  ["2026STD-P0018", "Sample Studio Talk Show"], ["2026TEG-P0210", "Sample Community Night"],
];
const SUPPLIERS = [
  ["Sample Bright Lights Rentals", "Sample Bright Lights Rentals Inc."], ["Sample Soundwave Audio", "Soundwave Audio Trading"],
  ["Sample Pixel Wall Co.", "Pixel Wall Co."], ["Sample Crew Hub", "Crew Hub Services"], ["Sample Print Express", "Print Express"],
  ["Sample Feast Catering", "Feast Catering Services"], ["Sample Shuttle Vans", "Shuttle Vans Transport"], ["Sample Trophy House", "Trophy House"],
  ["Sample Net Speed ISP", "Net Speed Telecom"], ["Sample Build-It Booths", "Build-It Fabrication"], ["", "Sample Freelance Photographer"],
];
const ITEMS = [
  ["Lighting rental (3 days)", 1, 45000], ["LED wall 4x3 m with processor", 1, 120000], ["Outsourced crew - stagehands", 12, 1800],
  ["Camera rental with lens kit", 2, 6500], ["Sound system rental", 1, 38000], ["Printing: tarpaulin 10 x 20 ft", 6, 1450],
  ["Catering 150 pax", 150, 420], ["Shuttle van rental", 3, 5200], ["Trophies and medals", 1, 26000],
  ["Internet line 100 Mbps (event days)", 1, 18000], ["Booth fabrication", 1, 95000], ["Outsource video editing", 1, 22000],
  ["Gaming PC rental (10 units)", 10, 3500], ["Photographer, full day", 1, 12000], ["Host talent fee", 1, 35000],
  ["Streaming encoder rental", 1, 9000], ["Outsourcing of ushers", 8, 1500], ["Stage design and setup", 1, 150000],
];
const BANKS = ["Sample Bank", "Example Savings Bank", "Demo Trust"];

const records = [];
const start = Date.UTC(2025, 9, 1), end = Date.UTC(2026, 9, 30);
for (let i = 0; i < 420; i++) {
  const submitted = Math.floor(start + rand() * (end - start));
  const status = weighted([["Approved", 70], ["Under Review", 12], ["Rejected", 10], ["Recalled", 8]]);
  const [code, name] = pick(PROJECTS);
  const [supplier, account] = pick(SUPPLIERS);
  const [item, qty0, price0] = pick(ITEMS);
  const usd = rand() < 0.15;
  const qty = Math.max(1, Math.round(qty0 * (0.5 + rand())));
  const unit = Math.round((usd ? price0 / 57 : price0) * (0.8 + rand() * 0.4) * 100) / 100;
  const day = new Date(submitted + OFFSET).toISOString().slice(0, 10).replace(/-/g, "");
  const reqNo = `${day}${String(1000 + i).slice(-4)}`;
  const f = {
    "Request No.": { link: `https://example.com/approval/${reqNo}`, text: reqNo },
    "Status": status,
    "Approval process": text("Procurement Request"),
    "Submitted at": submitted,
    "Requester": person(pick(PEOPLE)),
    "Initiator department": text(pick(UNITS)),
    "Current assignee": status === "Under Review" ? person(pick(PEOPLE)) : [],
    "Approval steps": text("Requester > Department head > Finance"),
    "Cost Type": pick(["Direct Cost", "Operating Expense"]),
    "Business Unit": pick(UNITS),
    "Project Name": text(name),
    "Project Code": text(code),
    "Project Manager": person(pick(PEOPLE)),
    "Charged to": pick(["Client", "Mineski"]),
    "Are Particulars overbudget?": rand() < 0.1 ? "Yes" : "No",
    "Particulars_Item": text(item),
    "Particulars_Quantity": qty,
    "Particulars_Unit Price": unit,
    "Particulars_Unit Price-Currency": usd ? "USD" : "PHP",
    "Particulars_Price": Math.round(unit * qty * 100) / 100,
    "Supplier Details_Form of Payment": pick(["Bank Transfer", "Check"]),
    "Supplier Details_Account Name": text(account),
    "Supplier Details_Account Number": text(`0000-${String(Math.floor(rand() * 1e4)).padStart(4, "0")}-SAMPLE`),
    "Supplier Details_Bank Name": text(pick(BANKS)),
    "Supplier Details_Business/Home Address": text(`${Math.floor(rand() * 900) + 100} Sample Street, Example City`),
    "Supplier Details_Terms": text(pick(["30 days", "50% down, 50% after", "Cash on delivery"])),
    "SourceID": text(`SRC-${i}`),
    "Budget/Terms": text(pick(["Within budget", "Approved additional budget"])),
  };
  if (supplier) f["Supplier Details_Supplier Name"] = text(supplier);   // one supplier has only an account name
  if (status === "Approved" || status === "Rejected") f["Completed at"] = submitted + Math.floor(rand() * 5 * DAY);
  if (status === "Approved") f["Supplier Details_Payment Date"] = manilaMidnight(submitted + 14 * DAY);
  if (rand() < 0.3) f["Particulars_Attachment"] = { link: `https://example.com/files/quote-${reqNo}.pdf`, text: `quote-${reqNo}.pdf` };
  if (rand() < 0.2) f["Supplier Details_Attachment"] = { link: `https://example.com/files/bir-${reqNo}.pdf`, text: `bir-${reqNo}.pdf` };
  // Talents required: rich text with a link segment in the middle (joins without commas).
  if (/talent/i.test(item)) f["Talents required"] = [{ type: "text", text: "Host, see " }, { type: "url", text: "the brief", link: "https://example.com/brief" }];
  records.push({ record_id: `recSample${String(i).padStart(4, "0")}`, fields: f });
}
records.push({ record_id: "recSampleBlank", fields: {} });   // Lark keeps empty rows around: the page drops them

const out = { note: "Made-up sample data for preview mode and the tests. Not real records.", table: "tblSample00000001", fields, records };
const path = fileURLToPath(new URL("./fixture.json", import.meta.url));
// One column and one record per line: small, and easy to read in a diff.
const lines = (list) => list.map((x) => JSON.stringify(x)).join(",\n");
writeFileSync(path, `{"note": ${JSON.stringify(out.note)}, "table": ${JSON.stringify(out.table)},\n"fields": [\n${lines(fields)}\n],\n"records": [\n${lines(records)}\n]}\n`);
console.log(`Wrote ${records.length} sample records and ${fields.length} columns to tests/fixture.json`);
