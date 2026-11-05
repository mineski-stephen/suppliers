/*
 * The filter and sort panel, opened from the funnel button beside the tabs. Every change
 * applies at once (the list behind it updates), the same choices as the old page:
 *   Sort         best match (the default) or one of eight orders
 *   Status       Approved only by default; never empty (the last one can't be switched off)
 *   Outsourced   all, only outsourced, or hide outsourced
 *   Currency     any, PHP only, or USD only (a blank currency counts as PHP)
 *   Group by     none, business unit, project or supplier
 *   Add a field filter   starts a chip in the search box with the cursor inside it
 * A popover under the button on wide screens, a bottom sheet on phones. Closes on Esc, on a
 * click outside it, and on the × button; focus goes back to the funnel button.
 *
 * ctx: { S, setFilters(patch), startField(field) }.
 */
import { $, h, ic, radioKeys } from "./ui.js";
import { RULES } from "./config.js";
import { SORTS, GROUPS, FILTER_FIELDS, activeFilterCount } from "./query.js";

const OUTSOURCE = [[null, "All"], ["only", "Only outsourced"], ["hide", "Hide outsourced"]];
const CURRENCY = [[null, "Any currency"], ...RULES.currencies.map((c) => [c, `${c} only`])];
const GROUP = [[null, "None"], ...Object.entries(GROUPS).map(([k, [label]]) => [k, label])];

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

  function paint() {
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
  $("#filterReset").addEventListener("click", () => ctx.setFilters({ sort: null, statuses: new Set(RULES.defaultStatuses), outsource: null, currency: null, group: null }));
  backdrop.addEventListener("click", () => close());
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  document.addEventListener("pointerdown", (e) => {
    if (isOpen() && !pop.contains(e.target) && !btn.contains(e.target)) close({ focus: false });
  }, true);
  addEventListener("resize", place);

  return { paint, close, isOpen };
}
