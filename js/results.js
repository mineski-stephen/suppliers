/*
 * The results: the tab counts, the list (or the groups, with their totals), "Show more",
 * and what the filters leave out. A card opens its record (#/r/<record id>); clicking the
 * open one again closes it. The Line Items tab lists CE line items instead (S.lineResults),
 * with its own filters, sort and groups (S.lineFilters, js/lines.js).
 *
 * ctx: { S, prefs() -> { rate, show }, open(id), close(), resetFilters() }.
 */
import { $, $$, h, fmt } from "./ui.js";
import { RULES } from "./config.js";
import { dayLabel } from "./rows.js";
import { applyFilters, groupResults, priceText, TABS, hiddenBy } from "./query.js";
import { statusBadge, marked, itemNodes, pricesOf, supplierOf, lineBadge } from "./present.js";
import { applyLineFilters, lineHiddenBy, groupLines } from "./lines.js";

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

  /** One CE line item: project code and CE tab, final or not; the particular; the project with the
   *  unit cost, markup and client price on the right; the project (where a purchase order shows
   *  its project), what was paid and the price date. */
  function lineCard(r, terms, i = 0) {
    const row = r.item, id = row.$id;
    const { show, rate } = ctx.prefs();
    const unit = priceText(row.unit_price_php, "PHP", show, rate);
    const client = priceText(row.client_price_php, "PHP", show, rate);
    const markup = row.markup === null || row.markup === undefined ? ""
      : `${(Number(row.markup) * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}% markup`;
    const date = dayLabel(row.price_date);
    return h("a", { class: `card result result-line${animate ? " is-entering" : ""}`, href: `#/r/${encodeURIComponent(id)}`, dataset: { id },
                    style: animate ? `--i:${Math.min(i, 15)}` : null, "aria-current": S.open === id ? "true" : null },
      h("div", { class: "result-head" },
        h("span", { class: "result-no" }, marked([row.project_code, row.source_tab].filter(Boolean).join(" · ") || "CE line", terms)),
        lineBadge(row)),
      h("h3", { class: "result-title" }, marked(row.particular || row.item || "No particular", terms)),
      h("div", { class: "result-meta" },
        h("span", { class: "result-supplier" }, marked(row.category || "Uncategorised", terms)),
        unit || markup || client ? h("div", { class: "result-pricing" },
          unit || markup ? h("span", { class: "result-unit" }, [unit && `Unit ${unit}`, markup].filter(Boolean).join(" · ")) : null,
          client ? h("b", { class: "result-total" }, `Client ${client}`) : null) : null),
      h("div", { class: "result-foot" },
        h("span", { class: "result-project" }, marked(row.project_name || row.client || "No project name", terms)),
        row.actual_php ? h("span", { class: "result-date" }, `Paid ${priceText(row.actual_php, "PHP", show, rate)}`) : null,
        date ? h("span", { class: "result-date" }, date) : null));
  }

  function drawMore() {
    const terms = S.terms;
    const next = current.slice(drawn, drawn + RULES.chunk);
    listEl.append(...next.map((r, i) => (r.item.$line ? lineCard(r, terms, i) : card(r, terms, i))));
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
      if (!box.childElementCount) { animate = rise; box.append(...g.items.map((r, i) => (r.item.$line ? lineCard(r, terms, i) : card(r, terms, i)))); animate = false; return; }
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
      const n = !has ? 0 : t.dataset.tab === "lines" ? (S.lineResults ? applyLineFilters(S.lineResults, S.lineFilters).length : 0)
        : applyFilters(S.results[i], S.filters, ctx.prefs().rate).length;
      t.querySelector(".count").textContent = n ? n.toLocaleString() : "";
      t.setAttribute("aria-selected", String(t.dataset.tab === S.tab));
      t.tabIndex = t.dataset.tab === S.tab ? 0 : -1;
    }
    if (!has) { listEl.replaceChildren(); return; }
    if (newResults) opened.clear();
    if (S.tab === "lines") return renderLines({ keepScroll });
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
    // (replaceChildren would print a null as "null": leave the missing parts out instead)
    noteEl.replaceChildren(...[
      n && parts.length ? h("span", null, `Not shown: ${parts.join(" · ")}. `) : null,
      n && parts.length ? h("button", { type: "button", class: "linkish", onclick: () => ctx.resetFilters() }, "Reset filters") : null,
    ].filter(Boolean));
    noteEl.hidden = !noteEl.childElementCount;
    if (!keepScroll) window.scrollTo(0, 0); else window.scrollTo(0, scroll);
  }

  /** The Line Items tab: CE line items, best first. No filters or groups (they're for purchase orders). */
  function renderLines({ keepScroll = false } = {}) {
    const scroll = keepScroll ? scrollY : 0;
    listEl.replaceChildren();
    drawn = 0;
    moreBtn.hidden = true;
    noteEl.replaceChildren();
    noteEl.hidden = true;
    if (!S.lineResults) {
      const info = ctx.lines();
      current = [];
      countEl.textContent = "";
      const p = info.progress;
      listEl.append(h("div", { class: "empty small" }, info.state === "loading"
        ? h("div", { class: "loader-title lines-loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }),
            `Reading the CE line items${p && p.total ? ` (${p.n.toLocaleString()} of ${p.total.toLocaleString()})` : ""}…`)
        : h("p", null, info.note || "CE line items aren't available right now.")));
      return;
    }
    const f = S.lineFilters;
    const raw = S.lineResults;
    current = applyLineFilters(raw, f);
    const n = current.length;
    if (!n) {
      const what = S.browse ? "No CE line items" : `No CE line items match “${S.queryText}”`;
      listEl.append(h("div", { class: "empty small" },
        h("p", null, raw.length ? `${what} with these filters.` : `${what}.`),
        raw.length ? h("button", { type: "button", class: "btn btn-sm", onclick: () => ctx.resetLineFilters() }, "Reset filters")
                   : h("p", null, "Try fewer words, or switch Exact off.")));
      countEl.textContent = "";
    } else if (f.group) {
      const groups = groupLines(current, f.group, f.sort);
      countEl.textContent = `${fmt.plural(n, "CE line item")} in ${fmt.plural(groups.length, "group")}`;
      listEl.append(...groups.map((g) => groupEl(g, S.terms)));
    } else {
      countEl.textContent = S.browse ? `All CE line items · ${fmt.plural(n, "line")}` : fmt.plural(n, "CE line item");
      drawMore();
    }
    // Say what the filters leave out, and why.
    const hid = lineHiddenBy(raw, f);
    const parts = [hid.final ? `${hid.final.toLocaleString()} ${f.final === "only" ? "only in other versions" : "in the final CE"}` : "",
                   hid.outcome ? `${hid.outcome.toLocaleString()} with another outcome` : "",
                   hid.category ? `${hid.category.toLocaleString()} in another category` : "",
                   hid.po ? `${hid.po.toLocaleString()} ${f.po === "yes" ? "without" : "with"} a purchase order` : ""].filter(Boolean);
    noteEl.replaceChildren(...[
      n && parts.length ? h("span", null, `Not shown: ${parts.join(" · ")}. `) : null,
      n && parts.length ? h("button", { type: "button", class: "linkish", onclick: () => ctx.resetLineFilters() }, "Reset filters") : null,
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
