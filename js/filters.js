/*
 * The filter and sort panel, opened from the funnel button beside the tabs. Every change
 * applies at once (the list behind it updates), the same choices as the old page:
 *   Sort         best match (the default) or one of eight orders
 *   Status       Approved only by default; never empty (the last one can't be switched off)
 *   Outsourced   all, only outsourced, or hide outsourced
 *   Currency     any, PHP only, or USD only (a blank currency counts as PHP)
 *   Group by     none, business unit, project or supplier
 *   Add a field filter   starts a chip in the search box with the cursor inside it
 * On the Line Items tab the panel holds the CE line filters instead (S.lineFilters, js/lines.js):
 *   Sort         best match, or price date, unit cost, line cost, markup or project code
 *   Final CE     all lines, only lines in the final CE, or only lines from other versions
 *   Outcome      any, or the outcomes picked (won, lost, …)
 *   Category     any, or the categories picked
 *   Purchase orders   any, only lines with a matched purchase order, or only lines without
 *   Group by     none, project, category or business unit
 * A popover under the button on wide screens, a bottom sheet on phones. Closes on Esc, on a
 * click outside it, and on the × button; focus goes back to the funnel button.
 *
 * ctx: { S, setFilters(patch), startField(field), setLineFilters(patch), resetLineFilters(), lineChoices(col, blank) }.
 */
import { $, h, ic, radioKeys } from "./ui.js";
import { RULES } from "./config.js";
import { SORTS, GROUPS, FILTER_FIELDS, activeFilterCount } from "./query.js";
import { LINE_SORTS, LINE_GROUPS, LINE_FIELDS, lineFilterCount } from "./lines.js";

const OUTSOURCE = [[null, "All"], ["only", "Only outsourced"], ["hide", "Hide outsourced"]];
const CURRENCY = [[null, "Any currency"], ...RULES.currencies.map((c) => [c, `${c} only`])];
const GROUP = [[null, "None"], ...Object.entries(GROUPS).map(([k, [label]]) => [k, label])];
const LINE_FINAL = [[null, "All lines"], ["only", "Final CE only"], ["other", "Other versions only"]];
const LINE_PO = [[null, "Any"], ["yes", "With a purchase order"], ["no", "Without"]];
const LINE_GROUP = [[null, "None"], ...Object.entries(LINE_GROUPS).map(([k, [label]]) => [k, label])];

export function createFilters(ctx) {
  const { S } = ctx;
  const pop = $("#filterPop"), btn = $("#filterBtn"), backdrop = $("#filterBackdrop");

  const radios = (name, choices, value, onPick) => {
    const group = h("div", { class: "chips", role: "radiogroup", "aria-labelledby": `${name}Lbl` },
      choices.map(([v, label]) => h("button", { type: "button", class: "chip-opt", role: "radio", "aria-checked": String(v === value),
        onclick: () => onPick(v) }, label)));
    radioKeys(group);
    return group;
  };
  const section = (name, label, body, hint) => h("div", { class: "fp-sec" },
    h("span", { class: "field-label", id: `${name}Lbl` }, label), body, hint ? h("p", { class: "field-help" }, hint) : null);

  /** Toggle chips for a set of values (empty = all): each chip adds or removes its value. */
  const multi = (name, choices, set, onChange) => h("div", { class: "chips", role: "group", "aria-labelledby": `${name}Lbl` },
    choices.map(([v, count]) => h("button", { type: "button", class: "chip-opt", "aria-pressed": String(set.has(v)),
      title: `${count.toLocaleString()} line${count === 1 ? "" : "s"}`,
      onclick: () => { const next = new Set(set); if (next.has(v)) next.delete(v); else next.add(v); onChange(next); } },
      set.has(v) ? ic("check") : null, v)));

  /** The Line Items tab's panel. */
  function paintLines() {
    const f = S.lineFilters;
    const sort = h("select", { id: "sortSel", "aria-labelledby": "sortLbl" },
      h("option", { value: "" }, "Best match"),
      Object.entries(LINE_SORTS).map(([k, [label]]) => h("option", { value: k, selected: f.sort === k }, label)));
    sort.addEventListener("change", () => ctx.setLineFilters({ sort: sort.value || null }));
    const outcomes = ctx.lineChoices("outcome", "Unknown");
    const categories = ctx.lineChoices("category", "Uncategorised");
    const fields = h("div", { class: "chips" }, Object.keys(LINE_FIELDS).map((k) =>
      h("button", { type: "button", class: "chip-opt", title: `${k}:'…'`, onclick: () => { close(); ctx.startField(k); } }, ic("plus"), FILTER_FIELDS[k].label)));
    return [
      h("div", { class: "fp-sec" }, h("label", { class: "field-label", id: "sortLbl", for: "sortSel" }, "Sort"), h("label", { class: "select" }, sort)),
      section("lfinal", "Final CE", radios("lfinal", LINE_FINAL, f.final, (v) => ctx.setLineFilters({ final: v })),
        "The final CE is the version that was signed or sent; other versions are drafts and options."),
      outcomes.length ? section("loutcome", "Project outcome", multi("loutcome", outcomes, f.outcomes, (s) => ctx.setLineFilters({ outcomes: s })),
        "None picked: every outcome.") : null,
      categories.length ? section("lcat", "Category", multi("lcat", categories, f.categories, (s) => ctx.setLineFilters({ categories: s })),
        "None picked: every category.") : null,
      section("lpo", "Purchase orders", radios("lpo", LINE_PO, f.po, (v) => ctx.setLineFilters({ po: v })),
        "Whether an actual purchase was matched to the line."),
      section("lgroup", "Group by", radios("lgroup", LINE_GROUP, f.group, (v) => ctx.setLineFilters({ group: v })),
        "Each group shows its total line cost."),
      section("field", "Add a field filter", fields, "Starts a filter in the search box, ready for you to type a value."),
    ].filter(Boolean);
  }

  function paint() {
    const lines = S.tab === "lines";
    $("#filterTitle").textContent = lines ? "Filter and sort line items" : "Filter and sort";
    if (lines) {
      const body = $("#filterBody");
      const keep = document.activeElement && pop.contains(document.activeElement) ? document.activeElement.textContent : null;
      body.replaceChildren(...paintLines());
      if (keep !== null) {
        const again = [...body.querySelectorAll("button, select")].find((el) => el.textContent === keep);
        if (again) again.focus();
      }
      const n = lineFilterCount(S.lineFilters);
      $("#filterCount").textContent = n ? String(n) : "";
      btn.setAttribute("aria-label", n ? `Filter and sort line items: ${n} changed` : "Filter and sort line items");
      btn.title = "Filter and sort line items";
      $("#filterReset").disabled = !n;
      return;
    }
    btn.title = "Filter and sort";
    const f = S.filters;
    const sort = h("select", { id: "sortSel", "aria-labelledby": "sortLbl" },
      h("option", { value: "" }, "Best match"),
      Object.entries(SORTS).map(([k, [label]]) => h("option", { value: k, selected: f.sort === k }, label)));
    sort.addEventListener("change", () => ctx.setFilters({ sort: sort.value || null }));
    const statuses = h("div", { class: "chips", role: "group", "aria-labelledby": "statusLbl" },
      RULES.statuses.map((s) => h("button", { type: "button", class: "chip-opt", "aria-pressed": String(f.statuses.has(s)),
        onclick: () => {
          const next = new Set(f.statuses);
          if (next.has(s)) next.delete(s); else next.add(s);
          if (!next.size) RULES.defaultStatuses.forEach((d) => next.add(d));   // never empty
          ctx.setFilters({ statuses: next });
        } }, f.statuses.has(s) ? ic("check") : null, s)));
    const fields = h("div", { class: "chips" }, Object.entries(FILTER_FIELDS).map(([k, x]) =>
      h("button", { type: "button", class: "chip-opt", title: `${k}:'…'`, onclick: () => { close(); ctx.startField(k); } }, ic("plus"), x.label)));
    const body = $("#filterBody");
    const keep = document.activeElement && pop.contains(document.activeElement) ? document.activeElement.textContent : null;
    body.replaceChildren(
      h("div", { class: "fp-sec" }, h("label", { class: "field-label", id: "sortLbl", for: "sortSel" }, "Sort"), h("label", { class: "select" }, sort)),
      section("status", "Status", statuses, "Only Approved is shown until you pick more."),
      section("outsource", "Outsourced", radios("outsource", OUTSOURCE, f.outsource, (v) => ctx.setFilters({ outsource: v }))),
      section("currency", "Currency", radios("currency", CURRENCY, f.currency, (v) => ctx.setFilters({ currency: v }))),
      section("group", "Group by", radios("group", GROUP, f.group, (v) => ctx.setFilters({ group: v }))),
      section("field", "Add a field filter", fields, "Starts a filter in the search box, ready for you to type a value."));
    // Keep the keyboard where it was after a redraw.
    if (keep !== null) {
      const again = [...body.querySelectorAll("button, select")].find((el) => el.textContent === keep);
      if (again) again.focus();
    }
    const n = activeFilterCount(f);
    $("#filterCount").textContent = n ? String(n) : "";
    btn.setAttribute("aria-label", n ? `Filter and sort: ${n} changed` : "Filter and sort");
    $("#filterReset").disabled = !n;
  }

  function place() {
    if (pop.hidden || matchMedia("(max-width: 640px)").matches) { pop.style.left = pop.style.top = pop.style.maxHeight = ""; return; }
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    pop.style.top = `${r.bottom + 8}px`;
    pop.style.maxHeight = `${Math.max(240, innerHeight - r.bottom - 24)}px`;
  }
  function openPop() {
    paint();
    pop.hidden = false;
    backdrop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    place();
    const first = pop.querySelector("select, button");
    if (first) first.focus();
  }
  function close({ focus = true } = {}) {
    if (pop.hidden) return;
    pop.hidden = true;
    backdrop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (focus) btn.focus();
  }
  const isOpen = () => !pop.hidden;

  btn.addEventListener("click", () => (isOpen() ? close() : openPop()));
  $("#filterClose").addEventListener("click", () => close());
  $("#filterReset").addEventListener("click", () => (S.tab === "lines" ? ctx.resetLineFilters()
    : ctx.setFilters({ sort: null, statuses: new Set(RULES.defaultStatuses), outsource: null, currency: null, group: null })));
  backdrop.addEventListener("click", () => close());
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  document.addEventListener("pointerdown", (e) => {
    if (isOpen() && !pop.contains(e.target) && !btn.contains(e.target)) close({ focus: false });
  }, true);
  addEventListener("resize", place);

  return { paint, close, isOpen };
}
