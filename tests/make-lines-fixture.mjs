// Builds tests/lines-fixture.json: MADE-UP CE line items for preview mode and the tests, in the shape
// anthropic-ce's GET /lines returns ({ columns, rows }). Built from the made-up procurement sample
// (tests/fixture.json), so the projects match and some lines carry purchase order numbers that the
// sample has. Run: node tests/make-lines-fixture.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { toRows } from "../js/rows.js";

const fx = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const pos = toRows(fx.records).filter((r) => r.Status === "Approved");

const COLUMNS = ["line_key", "project_code", "project_name", "client", "outcome", "business_unit", "entity", "budget_tier",
  "source_file", "source_tab", "source_row", "versions", "n_versions", "in_final", "version_role", "layout", "section", "subsection",
  "category", "item", "particular", "remarks", "qty", "frq", "per", "currency", "unit_price_php", "base_price_php", "markup",
  "gross_profit_php", "client_price_php", "method", "sourcing", "price_date", "inactive", "waived", "free", "contingency",
  "is_package", "package_contents", "po_numbers", "actual_php", "po_count", "savings_php", "match_confidence"];

const CATS = ["Manpower", "Equipment & Furniture", "Stage Technicals", "Fabrication & Collateral", "Food & Beverage", "Service"];
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const rows = [];
const byProject = new Map();
for (const r of pos) {
  const code = r["Project Code"];
  if (!code) continue;
  if (!byProject.has(code)) byProject.set(code, []);
  byProject.get(code).push(r);
}
let n = 0;
for (const [code, list] of byProject) {
  const name = list[0]["Project Name"];
  const file = `CE_${code} ${name}.xlsx`;
  for (const [i, po] of list.slice(0, 14).entries()) {
    const unit = Math.round(Number(po["Particulars_Unit Price"] || 0) * (0.9 + rnd() * 0.3)) || Math.round(1000 + rnd() * 50000);
    const qty = Number(po["Particulars_Quantity"] || 1) || 1;
    const frq = pick([1, 1, 1, 2, 3]);
    const base = unit * qty * frq;
    const markup = pick([0, 0.05, 0.1, 0.1, 0.15, 0.2]);
    const final = i % 4 !== 3;
    const matched = final && rnd() < 0.6;
    const actual = matched ? Math.round(Number(po["Particulars_Price"] || base) || base) : null;
    n++;
    rows.push([`${code}|${code}|${100 + n}`, code, name, "Sample Client Inc.", pick(["Won", "Won", "Lost"]), po["Business Unit"] || "Events",
      "PDEI", pick(["A", "B", "C"]), file, final ? "COST ESTIMATE FINAL" : "COST ESTIMATE v1", 20 + i,
      final ? "COST ESTIMATE FINAL; COST ESTIMATE v1" : "COST ESTIMATE v1", final ? 2 : 1, final ? 1 : 0, final ? "final" : "version", "D",
      "GENERAL OPERATIONS", "", pick(CATS), po["Particulars_Item"], po["Particulars_Item"], rnd() < 0.3 ? "Sample remark: inclusive of setup" : "",
      qty, frq, pick(["per day", "per project", "per unit"]), "PHP", unit, base, markup, Math.round(base * markup), Math.round(base * (1 + markup)),
      pick(["Procurement", "Procurement", "Internal"]), "", "2026-0" + (1 + (n % 9)) + "-15", 0, 0, 0, 0, 0, "",
      matched ? po["Request No."] : "", actual, matched ? 1 : null, matched ? base - actual : null, matched ? "high" : ""]);
  }
}
const out = { note: "Made-up sample data for preview mode and the tests. Not real CE line items.", columns: COLUMNS, rows };
writeFileSync(new URL("./lines-fixture.json", import.meta.url), JSON.stringify(out, null, 0) + "\n");
console.log(`lines-fixture.json: ${rows.length} made-up lines across ${byProject.size} projects`);
