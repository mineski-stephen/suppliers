/*
 * The results: the tab counts, the list (or the groups, with their totals), "Show more",
 * and what the filters leave out. A card opens its record (#/r/<record id>); clicking the
 * open one again closes it.
 *
 * ctx: { S, prefs() -> { rate, show }, open(id), close(), resetFilters() }.
 */
import { $, $$, h, fmt } from "./ui.js";
import { RULES } from "./config.js";
import { dayLabel } from "./rows.js";
import { applyFilters, groupResults, priceText, TABS, hiddenBy } from "./query.js";
import { statusBadge, marked, itemNodes, pricesOf, supplierOf } from "./present.js";

export function createResults(ctx) {
  const { S } = ctx;
  const listEl = $("#resultList"), countEl = $("#resultsCount"), noteEl = $("#resultsNote"), moreBtn = $("#showMore");
  let current = [];   // the active tab's results after the filters
  let drawn = 0;
  const opened = new Set();   // groups opened (by name), kept while the results stay the same

  let animate = false;   // the next cards drawn rise in, one after another (a new search, tab or filter)

  /** One result, in the old page's layout: request no. and status; the item; the supplier with the
   *  prices on the right; the project and the date. */
  function card(r, terms, i = 0) {
    const row = r.item, id = row.$id;
    const { qty, unit, total } = pricesOf(row, ctx.prefs().show, ctx.prefs().rate);
    const project = row["Project Name"] || "";
    const supplier = supplierOf(row);
    const date = dayLabel(row["Submitted at"]);
    return h("a", { class: `card result${animate ? " is-entering" : ""}`, href: `#/r/${encodeURIComponent(id)}`, dataset: { id },
                    style: animate ? `--i:${Math.min(i, 15)}` : null, "aria-current": S.open === id ? "true" : null },
      h("div", { class: "result-head" },
        h("span", { class: "result-no" }, row["Request No."] || "No request number"),
        statusBadge(row.Status)),
      h("h3", { class: "result-title" }, itemNodes(row["Particulars_Item"] || "No item name", terms)),
      h("div", { class: "result-meta" },
        h("span", { class: "result-supplier" }, supplier ? marked(supplier, terms) : "No supplier"),
        unit || total ? h("div", { class: "result-pricing" },
          unit ? h("span", { class: "result-unit" }, `${qty || "1"} × ${unit}`) : null,
          total ? h("b", { class: "result-total" }, unit ? `Total ${total}` : total) : null) : null),
      project || date ? h("div", { class: "result-foot" },
        project ? h("span", { class: "result-project" }, marked(project, terms)) : null,
        date ? h("span", { class: "result-date" }, date) : null) : null);
  }

  function drawMore() {
    const terms = S.terms;
    const next = current.slice(drawn, drawn + RULES.chunk);
    listEl.append(...next.map((r, i) => card(r, terms, i)));
    animate = false;
    drawn += next.length;
    const left = current.length - drawn;
    moreBtn.hidden = left <= 0;
    moreBtn.querySelector(".label").textContent = `Show ${Math.min(left, RULES.chunk).toLocaleString()} more`;
    moreBtn.title = `${left.toLocaleString()} more to show`;
  }

  function groupEl(g, terms) {
    const { show, rate } = ctx.prefs();
    const sum = g.sumPhp > 0 ? priceText(g.sumPhp, "PHP", show, rate) : "";
    const box = h("div", { class: "cards rgroup-items" });
    const d = h("details", { class: "rgroup", open: opened.has(g.name) },
      h("summary", null, h("span", { class: "rgroup-name" }, g.name),
        h("span", { class: "done-count" }, g.items.length.toLocaleString()),
        sum ? h("span", { class: "rgroup-sum" }, sum) : null),
      box);
    // Opening a group draws its cards and lets them rise in (each time it opens, as before).
    const fill = (rise) => {
      if (!box.childElementCount) { animate = rise; box.append(...g.items.map((r, i) => card(r, terms, i))); animate = false; return; }
      if (!rise) return;
      [...box.children].forEach((c, i) => { c.classList.remove("is-entering"); void c.offsetWidth; c.style.setProperty("--i", Math.min(i, 15)); c.classList.add("is-entering"); });
    };
    if (d.open) fill(false);
    d.addEventListener("toggle", () => {
      if (d.open) { opened.add(g.name); fill(true); } else opened.delete(g.name);
    });
    return d;
  }

  /** Draw the results. keepScroll: a refresh or a currency change (don't jump to the top, don't animate).
   *  Otherwise (a new search, a tab, a filter) the cards rise in, as on the old page. */
  function render({ keepScroll = false, newResults = false } = {}) {
    animate = !keepScroll;
    const has = !!S.results;
    $("#results").hidden = !has;
    for (const t of $$(".qtab")) {
      const i = TABS.indexOf(t.dataset.tab);
      const n = has ? applyFilters(S.results[i], S.filters, ctx.prefs().rate).length : 0;
      t.querySelector(".count").textContent = n ? n.toLocaleString() : "";
      t.setAttribute("aria-selected", String(t.dataset.tab === S.tab));
      t.tabIndex = t.dataset.tab === S.tab ? 0 : -1;
    }
    if (!has) { listEl.replaceChildren(); return; }
    if (newResults) opened.clear();
    const raw = S.results[TABS.indexOf(S.tab)] || [];
    const { rate } = ctx.prefs();
    current = applyFilters(raw, S.filters, rate);
    const scroll = keepScroll ? scrollY : 0;
    listEl.replaceChildren();
    drawn = 0;
    moreBtn.hidden = true;

    const n = current.length;
    if (!n) {
      const what = S.browse ? "No records" : `No records match “${S.queryText}”`;
      listEl.append(h("div", { class: "empty small" },
        h("p", null, raw.length ? `${what} with these filters.` : `${what}.`),
        raw.length ? h("button", { type: "button", class: "btn btn-sm", onclick: () => ctx.resetFilters() }, "Reset filters")
                   : h("p", null, "Try fewer words, or switch Exact off.")));
      countEl.textContent = "";
    } else if (S.filters.group) {
      const groups = groupResults(current, S.filters.group, S.filters.sort, rate);
      countEl.textContent = `${fmt.plural(n, "result")} in ${fmt.plural(groups.length, "group")}`;
      listEl.append(...groups.map((g) => groupEl(g, S.terms)));
    } else {
      countEl.textContent = S.browse ? `All records · ${fmt.plural(n, "record")}` : fmt.plural(n, "result");
      drawMore();
    }

    // Say what isn't shown, and why.
    const hid = hiddenBy(raw, S.filters);
    const parts = [hid.status ? `${hid.status.toLocaleString()} with another status` : "",
                   hid.outsource ? `${hid.outsource.toLocaleString()} ${S.filters.outsource === "hide" ? "outsourced" : "not outsourced"}` : "",
                   hid.currency ? `${hid.currency.toLocaleString()} in another currency` : ""].filter(Boolean);
    const capped = !S.browse && S.results.some((list) => list.length >= RULES.searchLimit);
    // (replaceChildren would print a null as "null": leave the missing parts out instead)
    noteEl.replaceChildren(...[
      n && parts.length ? h("span", null, `Not shown: ${parts.join(" · ")}. `) : null,
      n && parts.length ? h("button", { type: "button", class: "linkish", onclick: () => ctx.resetFilters() }, "Reset filters") : null,
      capped ? h("span", { class: "capped" }, `${parts.length && n ? " " : ""}Showing the best ${RULES.searchLimit.toLocaleString()} matches. Add a word or a filter to narrow it down.`) : null,
    ].filter(Boolean));
    noteEl.hidden = !noteEl.childElementCount;
    if (!keepScroll) window.scrollTo(0, 0); else window.scrollTo(0, scroll);
  }

  /** Mark the open record's card (without redrawing). */
  function markOpen() {
    for (const a of $$(".result")) {
      if (a.dataset.id === S.open) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    }
  }

  moreBtn.addEventListener("click", () => { if (!S.filters.group) drawMore(); });
  // Clicking the open record's card closes it (as before).
  listEl.addEventListener("click", (e) => {
    const a = e.target.closest("a.result");
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    if (a.dataset.id === S.open) ctx.close(); else ctx.open(a.dataset.id);
  });

  return { render, markOpen, cardFor: (id) => listEl.querySelector(`a.result[data-id="${CSS.escape(id)}"]`) };
}
