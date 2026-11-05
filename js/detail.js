/*
 * The detail panel: everything about one procurement record, in four groups. Beside the
 * results on wide screens; a sheet over the page below 1100 px (full screen on phones).
 * Click a value to copy it. Empty values (and Lark's "None") are left out.
 *
 * ctx: { S, prefs() -> { rate, show }, close() }.
 */
import { $, h, ic, copyText, toast, copyable, reduceMotion } from "./ui.js";
import { dayLabel, dateTimeLabel } from "./rows.js";
import { priceText, currencyOf } from "./query.js";
import { statusBadge, itemNodes } from "./present.js";

// The groups and their columns, as before. Labels drop the "Particulars_" / "Supplier Details_" prefix.
export const GROUPS = [
  { title: "Particulars", fields: ["Particulars_Item", "Particulars_Quantity", "Particulars_Unit Price",
    "Particulars_Unit Price-Currency", "Particulars_Price", "Particulars_Attachment"] },
  { title: "Project details", fields: ["Cost Type", "Business Unit", "Project Name", "Project Code", "Project Manager",
    "Budget/Terms", "Associated Procurement Request", "Talents required", "Charged to", "Are Particulars overbudget?"] },
  { title: "Request information", fields: ["Request No.", "Approval process", "Submitted at", "Completed at",
    "Requester", "Initiator department", "Current assignee"] },
  { title: "Supplier details", fields: ["Supplier Details_Supplier Name", "Supplier Details_Form of Payment",
    "Supplier Details_Account Name", "Supplier Details_Account Number", "Supplier Details_Bank Name",
    "Supplier Details_Business/Home Address", "Supplier Details_Payment Date", "Supplier Details_Terms",
    "Supplier Details_Attachment"] },
];
const LINKED = { "Request No.": "Request No._URL", "Particulars_Attachment": "Particulars_Attachment_URL",
                 "Supplier Details_Attachment": "Supplier Details_Attachment_URL" };
const PRICES = new Set(["Particulars_Unit Price", "Particulars_Price"]);
const DATETIMES = new Set(["Submitted at", "Completed at"]);
const DAYS = new Set(["Supplier Details_Payment Date"]);
const label = (f) => f.replace(/^(Particulars_|Supplier Details_)/, "");
// Only web links become links (a "javascript:" value in a cell must never run).
const safeLink = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "");

/** A value you can click to copy: it flashes, and the toast at the bottom says what was copied. */
const copyValue = (text, strong, what) => {
  const b = h("button", { type: "button", class: `dv${strong ? " is-strong" : ""}`, title: "Click to copy" }, text);
  b.addEventListener("click", async () => {
    const ok = await copyText(text);
    b.classList.remove("is-copied"); void b.offsetWidth; b.classList.add("is-copied");
    toast(ok ? `Copied ${what ? `the ${what}` : `“${text.length > 60 ? `${text.slice(0, 57)}…` : text}”`}.` : `Couldn't copy. Select it and copy it by hand.`,
          { type: ok ? "success" : "error", timeout: ok ? 2200 : 0 });
  });
  return b;
};

export function createDetail(ctx) {
  const { S } = ctx;
  const panel = $("#detail"), body = $("#detailBody");
  let shown = null;   // the record on screen: a different one fades in and starts at the top
  let leaving = 0;    // the close transition's timer: the panel is hidden once it has folded away
  let skeleton = 0;   // the skeleton's timer: a record opens as shimmering bars for 0.5 s, then fades in (as before)

  // Opening and closing are CSS transitions on body.detail-open (app.css): the panel's width and opacity.
  function finishClose() {
    clearTimeout(skeleton);
    body.classList.remove("is-loading", "is-fresh");
    clearTimeout(leaving);
    leaving = 0;
    panel.hidden = true;
    body.replaceChildren();
  }
  function startOpen() {
    if (leaving) { clearTimeout(leaving); leaving = 0; }
    if (panel.hidden) { panel.hidden = false; void panel.offsetWidth; }   // from its closed size, so it grows
    document.body.classList.add("detail-open");
  }

  function fieldNode(row, f) {
    const v = String(row[f] || "").trim();
    if (!v || v === "None") return null;
    const { show, rate } = ctx.prefs();
    const url = LINKED[f] ? safeLink(row[LINKED[f]]) : "";
    let value;
    if (url && f !== "Request No.") value = h("a", { href: url, target: "_blank", rel: "noopener", class: "dlink" }, v, ic("external"));
    else if (PRICES.has(f) && !Number.isNaN(Number(v))) value = copyValue(priceText(v, currencyOf(row), show, rate) || v, true, label(f).toLowerCase());
    else if (DATETIMES.has(f)) value = copyValue(dateTimeLabel(v) || v, false, label(f).toLowerCase());
    else if (DAYS.has(f)) value = copyValue(dayLabel(v) || v, false, label(f).toLowerCase());
    else value = copyValue(v, false, /Account Number/.test(f) ? "account number" : "");
    return h("div", { class: "df" }, h("dt", null, label(f)), h("dd", null, value));
  }

  /** Draw the open record, or close the panel: it slides out the way it came in (instant: at once,
   *  e.g. when the login ends and nothing may stay on screen). */
  function render({ instant = false } = {}) {
    const row = S.open ? S.byId.get(S.open) : null;
    if (!row) {
      shown = null;
      document.body.classList.remove("detail-open");
      if (instant || reduceMotion() || panel.hidden) return finishClose();
      if (!leaving) leaving = setTimeout(finishClose, 320);
      return;
    }
    startOpen();
    const changed = shown !== S.open;
    shown = S.open;
    const keep = body.scrollTop;
    const url = safeLink(row["Request No._URL"]);
    if (changed) {   // the old page's skeleton: bars in the shape of the record, then the record fades in
      clearTimeout(skeleton);
      body.classList.remove("is-fresh");
      body.classList.add("is-loading");
      body.setAttribute("aria-busy", "true");
      skeleton = setTimeout(() => {
        body.classList.remove("is-loading");
        body.removeAttribute("aria-busy");
        void body.offsetWidth;
        body.classList.add("is-fresh");
      }, 500);
    }
    body.replaceChildren(
      h("h2", { class: "detail-title", id: "detailTitle" }, itemNodes(row["Particulars_Item"] || "No item name", [])),
      h("div", { class: "detail-meta" },
        row["Request No."] ? copyable(row["Request No."], { cls: "code", label: "request number" }) : null,
        statusBadge(row.Status),
        url ? h("a", { class: "linkish", href: url, target: "_blank", rel: "noopener" }, "Open in Lark", ic("external")) : null),
      ...GROUPS.map((g) => {
        const fields = g.fields.map((f) => fieldNode(row, f)).filter(Boolean);
        // The saved copy has no bank details: say they're coming instead of leaving them out silently.
        const later = S.fromCache && g.title === "Supplier details"
          ? h("p", { class: "hint dnote" }, "The account number, bank and address show once the latest records are read.") : null;
        return fields.length ? h("section", { class: "dgroup" }, h("h3", { class: "subhead" }, g.title), h("dl", { class: "dfields" }, fields), later) : null;
      }).filter(Boolean));
    body.scrollTop = changed ? 0 : keep;
  }

  $("#detailClose").addEventListener("click", () => ctx.close());
  $("#detailBackdrop").addEventListener("click", () => ctx.close());

  return { render, isOpen: () => !panel.hidden, focus: () => $("#detailClose").focus() };
}
