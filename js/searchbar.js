/*
 * The search box: free text plus field-filter chips, the same behaviour as the old page.
 *
 *   type "/"            the field list opens (↑ ↓ to move, Enter or Tab to pick, Esc to close)
 *   pick a field        a chip opens with the cursor inside it; type a value (suggestions
 *                       appear once you type). Enter commits it. Type your own quotes to choose:
 *                       'contains' (the default) or "exact"
 *   click a chip        switches it off (grey) or back on; double-click (or F2) edits it; × removes it
 *   Backspace           in an empty box, cancels the chip being typed, else removes the last chip
 *   Enter               searches now; typed field:'value' tokens become chips
 *   Esc                 closes the list, else cancels the chip being typed, else clears the search
 *
 * The app creates it with a ctx: { fieldValues(field, prefix, n), changed({ now }), cleared() }.
 */
import { $, h, ic } from "./ui.js";
import { FILTER_FIELDS, chipText, chipValue } from "./query.js";

const SLASH_RE = /(?:^|\s)\/([a-z_]*)$/i;           // a "/token" being typed at the end
const TOKEN_RE = /([a-z_]+):(['"])(.*?)\2/gi;        // a complete field:'value' anywhere
const PLACEHOLDER = "Search items, suppliers, projects…";

export function createSearchBar(ctx) {
  const input = $("#q"), field = $("#qfield"), box = $("#qchips"), list = $("#qsuggest"), clearBtn = $("#qclear");
  let chips = [];             // { field, value, exact, off }
  let pending = null;         // the field whose value is being typed
  let items = [], index = 0, open = false;
  let timer = null, clickTimer = null, sizer = null, placeholder = PLACEHOLDER;
  let editing = null;         // a chip being edited: { chip, index, text } (Esc puts it back; the free text returns after)

  // ---- what the box holds ------------------------------------------------------
  const freeText = () => (pending ? "" : input.value.replace(SLASH_RE, "").trim());
  const fullQuery = () => [chips.filter((c) => !c.off).map(chipText).join(" "), freeText()].filter(Boolean).join(" ");
  /** The text to highlight in results: chip values and free text, never field names. */
  const highlightText = () => [...chips.filter((c) => !c.off).map((c) => c.value), freeText()].filter(Boolean).join(" ");
  const hasContent = () => !!input.value || chips.length > 0 || !!pending;

  // ---- drawing the chips --------------------------------------------------------
  function paint() {
    const focused = document.activeElement === input;
    const s = input.selectionStart, e = input.selectionEnd;
    field.append(input);   // the input may be inside the pending chip: bring it home before redrawing
    box.replaceChildren(...chips.map((c, i) => {
      const q = c.exact ? '"' : "'";
      const label = `${c.field} ${c.exact ? "is exactly" : "contains"} “${c.value}”`;
      return h("span", { class: `qchip${c.exact ? " is-exact" : ""}${c.off ? " is-off" : ""}`, dataset: { index: i } },
        h("button", { type: "button", class: "qchip-body", "aria-pressed": String(!c.off),
          title: `${c.off ? "Off: click to switch it on" : "Click to switch it off"} · double-click to edit`,
          "aria-label": `Filter: ${label}${c.off ? " (off)" : ""}` },
          h("span", { class: "qchip-field" }, `${c.field}:`), h("span", { class: "qchip-val" }, `${q}${c.value}${q}`)),
        h("button", { type: "button", class: "qchip-x", title: "Remove filter", "aria-label": `Remove the ${c.field} filter` }, ic("x")));
    }));
    if (pending) {
      const x = h("button", { type: "button", class: "qchip-x", title: "Cancel this filter", "aria-label": "Cancel this filter" }, ic("x"));
      x.addEventListener("mousedown", (ev) => { ev.preventDefault(); ev.stopPropagation(); cancelPending(); });
      const chip = h("span", { class: "qchip is-pending" }, h("span", { class: "qchip-field" }, `${pending}:`),
        h("span", { class: "qchip-q" }, "'"), input, h("span", { class: "qchip-q" }, "'"), x);
      chip.addEventListener("mousedown", (ev) => {
        if (ev.target.closest(".qchip-x") || ev.target === input) return;
        ev.preventDefault();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
      box.append(chip);
      input.classList.add("in-chip");
      input.placeholder = "";
      input.setAttribute("aria-label", `Value for ${pending}`);
      size();
    } else {
      input.classList.remove("in-chip");
      input.style.width = "";
      input.placeholder = placeholder;
      input.setAttribute("aria-label", "Search procurement records");
    }
    if (focused) { input.focus(); try { input.setSelectionRange(s, e); } catch (_) { /* shorter now */ } }
    clearBtn.hidden = !hasContent() && !ctx.browsing();
  }

  /** The input inside a chip is exactly as wide as its text, so the closing quote hugs it. */
  function size() {
    if (!input.classList.contains("in-chip")) return;
    if (!sizer) {
      sizer = h("span", { "aria-hidden": "true", style: "position:absolute;left:-9999px;top:-9999px;white-space:pre;visibility:hidden" });
      document.body.append(sizer);
    }
    const cs = getComputedStyle(input);
    Object.assign(sizer.style, { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing });
    sizer.textContent = input.value || "";
    input.style.width = `${Math.max(4, Math.ceil(sizer.getBoundingClientRect().width) + 1)}px`;
  }

  // ---- the suggestion list --------------------------------------------------------
  function closeList() {
    open = false; items = []; index = 0;
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function paintList() {
    if (!items.length) {
      list.replaceChildren(h("li", { class: "suggest-head", role: "presentation" }, "No field matches. Keep typing to search for the text."));
    } else {
      list.replaceChildren(
        h("li", { class: "suggest-head", role: "presentation" }, pending ? `Values for ${pending}, or type your own` : "Filter by field"),
        ...items.map((it, i) => h("li", { role: "option", id: `qopt-${i}`, dataset: { index: i }, "aria-selected": String(i === index) },
          it.type === "field" ? [h("b", { class: "mono" }, it.name), h("small", null, it.desc)] : h("span", null, it.value))));
    }
    list.hidden = false;
    open = true;
    input.setAttribute("aria-expanded", "true");
    if (items.length) {
      input.setAttribute("aria-activedescendant", `qopt-${index}`);
      const on = list.querySelector('[aria-selected="true"]');
      if (on) on.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }
  function fieldList(prefix) {
    const p = prefix.toLowerCase();
    items = Object.entries(FILTER_FIELDS).filter(([k]) => k.includes(p)).map(([k, f]) => ({ type: "field", name: k, desc: f.desc }));
    index = 0;
    paintList();
  }
  // Values stay hidden until something is typed, so it reads as "type a value", not "pick one".
  function valueList(f, prefix) {
    if (!prefix) return closeList();
    items = ctx.fieldValues(f, prefix, 8).map((v) => ({ type: "value", value: v }));
    index = 0;
    if (!items.length) return closeList();
    paintList();
  }
  function refreshList() {
    if (pending) return valueList(pending, input.value.trim());
    const m = input.value.match(SLASH_RE);
    if (m) return fieldList(m[1]);
    closeList();
  }
  function pick(i) {
    const it = items[i];
    if (!it) return;
    if (it.type === "field") {
      input.value = input.value.replace(SLASH_RE, "").trimStart();
      pending = it.name;
      closeList();
      paint();
      input.focus();
    } else if (pending && commit(pending, it.value)) {
      pending = null;
      input.value = doneEditing();
      closeList();
      paint();
      input.focus();
      ctx.changed({ now: true });
    }
  }

  // ---- chips ------------------------------------------------------------------------
  function commit(f, raw) {
    const { value, exact } = chipValue(raw);
    if (!value) return false;
    chips.push({ field: f, value, exact, off: false });
    return true;
  }
  /** The free text typed before a chip was edited (it comes back once the chip is done). */
  function doneEditing() {
    const text = editing ? editing.text : "";
    editing = null;
    return text;
  }
  function cancelPending() {
    if (editing) chips.splice(Math.min(editing.index, chips.length), 0, editing.chip);   // Esc while editing: the chip as it was
    pending = null;
    input.value = doneEditing();
    paint();
    closeList();
    ctx.changed({ now: true });
  }
  /** Typed field:'value' tokens become chips (the "edit as text" round trip). */
  function absorbTyped() {
    if (pending) return false;
    let found = false;
    const rest = input.value.replace(TOKEN_RE, (match, name, q, value) => {
      const key = name.toLowerCase();
      if (!FILTER_FIELDS[key]) return match;
      if (!value.trim()) return " ";
      chips.push({ field: key, value: value.trim(), exact: q === '"', off: false });
      found = true;
      return " ";
    });
    if (found) { input.value = rest.replace(/\s+/g, " ").trim(); paint(); }
    return found;
  }
  function edit(i) {
    const c = chips.splice(i, 1)[0];
    if (!c) return;
    editing = { chip: c, index: i, text: input.value };
    pending = c.field;
    input.value = c.value;
    paint();
    closeList();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    ctx.changed({ now: true });
  }

  // ---- events --------------------------------------------------------------------------
  input.addEventListener("input", () => {
    clearTimeout(timer);
    clearBtn.hidden = !hasContent() && !ctx.browsing();
    refreshList();
    if (pending) { size(); return; }   // typing a chip's value: just grow it, no search yet
    if (open) return;
    timer = setTimeout(() => ctx.changed({ now: false }), 200);
  });

  input.addEventListener("keydown", (e) => {
    if (open && items.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        index = (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        paintList();
        return;
      }
      if (e.key === "Tab") { e.preventDefault(); pick(index); return; }
      if (e.key === "Enter" && items[index].type === "field") { e.preventDefault(); pick(index); return; }
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      if (open) return closeList();
      if (pending) return cancelPending();
      if (hasContent() || ctx.browsing()) { clear(); ctx.cleared(); }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (pending) {
        const raw = input.value.trim();
        if (raw && commit(pending, raw)) {
          pending = null;
          input.value = doneEditing();
          paint();
          closeList();
          ctx.changed({ now: true });
        } else if (!raw) cancelPending();
        return;
      }
      absorbTyped();
      clearTimeout(timer);
      ctx.changed({ now: true });
      return;
    }
    if (e.key === "Backspace" && input.value === "") {
      if (pending) { e.preventDefault(); cancelPending(); return; }
      if (chips.length) { e.preventDefault(); chips.pop(); paint(); ctx.changed({ now: true }); }
    }
  });

  // A chip: click switches it off or on (after a short wait, so a double-click can edit instead).
  box.addEventListener("click", (e) => {
    const chip = e.target.closest(".qchip");
    if (!chip || chip.classList.contains("is-pending")) return;
    const i = Number(chip.dataset.index);
    if (!chips[i]) return;
    clearTimeout(clickTimer);
    if (e.target.closest(".qchip-x")) {
      chips.splice(i, 1);
      paint();
      input.focus();
      ctx.changed({ now: true });
      return;
    }
    clickTimer = setTimeout(() => {
      if (!chips[i]) return;
      chips[i].off = !chips[i].off;
      paint();
      const again = box.querySelector(`.qchip[data-index="${i}"] .qchip-body`);
      if (again) again.focus();
      ctx.changed({ now: true });
    }, 220);
  });
  box.addEventListener("dblclick", (e) => {
    const chip = e.target.closest(".qchip");
    if (!chip || chip.classList.contains("is-pending") || e.target.closest(".qchip-x")) return;
    clearTimeout(clickTimer);
    edit(Number(chip.dataset.index));
  });
  box.addEventListener("keydown", (e) => {
    const body = e.target.closest(".qchip-body");
    if (!body) return;
    const i = Number(body.closest(".qchip").dataset.index);
    if (e.key === "F2") { e.preventDefault(); edit(i); }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      chips.splice(i, 1);
      paint();
      input.focus();
      ctx.changed({ now: true });
    }
  });

  // The list: mousedown, so the input keeps its focus.
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-index]");
    if (!li) return;
    e.preventDefault();
    pick(Number(li.dataset.index));
  });
  document.addEventListener("click", (e) => { if (open && !e.target.closest("#qbox")) closeList(); });
  // Clicking the box's empty space puts the cursor in the input.
  $("#qbox").addEventListener("mousedown", (e) => {
    if (e.target.closest("button, input, .suggest")) return;
    e.preventDefault();
    input.focus();
  });
  clearBtn.addEventListener("click", () => { clear(); ctx.cleared(); input.focus(); });

  // ---- what the app calls --------------------------------------------------------------
  function clear() {
    clearTimeout(timer);
    editing = null;
    chips = [];
    pending = null;
    input.value = "";
    closeList();
    paint();
  }
  /** Start a field filter (the filter panel's "Add a field filter"): the cursor lands in the chip. */
  function startField(f) {
    if (!FILTER_FIELDS[f]) return;
    pending = f;
    paint();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    size();
    refreshList();
  }
  function setState(list2, text) {
    editing = null;
    chips = (list2 || []).map((c) => ({ field: c.field, value: c.value, exact: !!c.exact, off: !!c.off }));
    pending = null;
    input.value = text || "";
    closeList();
    paint();
  }
  /** While the records load the box is read-only; what's typed (or came in a link) is kept. */
  function setReady(ready, text) {
    input.readOnly = !ready;
    placeholder = ready ? (ctx.browsing() ? "Browsing every record. Type to search instead." : PLACEHOLDER) : (text || "Loading records…");
    if (!pending) input.placeholder = placeholder;
    clearBtn.hidden = !hasContent() && !ctx.browsing();
  }

  return {
    freeText, fullQuery, highlightText, clear, startField, setState, setReady, absorbTyped,
    chips: () => chips.map((c) => ({ ...c })),
    composing: () => !!pending || open,
    focus: () => input.focus(),
    paint,
  };
}
