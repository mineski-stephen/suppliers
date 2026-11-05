/*
 * "Recent orders": the newest records in a row, the newest on the left. It scrolls sideways:
 * a trackpad or Shift + wheel, a finger, a mouse drag (with momentum), the ‹ › buttons, or the
 * keyboard (Tab brings a card into view). It doesn't loop: after the last card comes one that
 * opens Browse all. A click (not the end of a drag) opens the record.
 *
 * ctx: { prefs() -> { rate, show }, open(id), browseAll(), total() }.
 */
import { $, h, ic, reduceMotion } from "./ui.js";
import { dayLabel } from "./rows.js";
import { pricesOf, supplierOf } from "./present.js";

export function createCarousel(ctx) {
  const wrap = $("#recentWrap"), track = $("#recentTrack"), prev = $("#recentPrev"), next = $("#recentNext");
  let raf = 0, drag = null, dragged = false;
  const step = () => { const c = track.firstElementChild; return c ? c.offsetWidth + 12 : 244; };

  function paintButtons() {
    const max = wrap.scrollWidth - wrap.clientWidth;
    prev.disabled = wrap.scrollLeft <= 1;
    next.disabled = wrap.scrollLeft >= max - 1;
  }

  function card(row, i) {
    const { total } = pricesOf(row, ctx.prefs().show, ctx.prefs().rate);
    const project = row["Project Name"] || "";
    const a = h("a", { class: "rcard recent-card is-entering", href: `#/r/${encodeURIComponent(row.$id)}`, draggable: "false",
                       dataset: { id: row.$id }, style: `--i:${Math.min(i, 8)}` },
      h("span", { class: "recent-no" }, row["Request No."] || ""),
      h("h3", null, row["Particulars_Item"] || "No item name"),
      h("p", { class: "rcard-sub" }, supplierOf(row) || "No supplier"),
      project ? h("p", { class: "recent-project" }, project) : null,
      h("div", { class: "rcard-foot recent-foot" }, h("b", null, total), h("span", null, dayLabel(row["Submitted at"]))));
    a.addEventListener("click", (e) => { e.preventDefault(); if (!dragged) ctx.open(row.$id); });
    return a;
  }

  /** The end of the row: Browse all. */
  function endCard(count) {
    const total = ctx.total();
    const b = h("button", { type: "button", class: "rcard recent-card recent-more is-entering", style: `--i:${Math.min(count, 8)}` },
      h("span", { class: "recent-more-icon", "aria-hidden": "true" }, ic("table")),
      h("b", null, `Browse all ${total.toLocaleString()} records`),
      h("span", { class: "rcard-sub" }, "With the same filters and sort"));
    b.addEventListener("click", () => { if (!dragged) ctx.browseAll(); });
    return b;
  }

  function render(rows) {
    cancelAnimationFrame(raf);
    track.replaceChildren(...rows.map(card), ...(rows.length ? [endCard(rows.length)] : []));
    wrap.scrollLeft = 0;   // the newest stays the anchor on the left
    $("#recent").hidden = !rows.length;
    setTimeout(() => track.querySelectorAll(".is-entering").forEach((c) => c.classList.remove("is-entering")), 900);
    paintButtons();
  }

  function glide(px) {
    cancelAnimationFrame(raf);
    wrap.scrollBy({ left: px, behavior: reduceMotion() ? "auto" : "smooth" });
  }

  // A mouse drag scrolls it, with a little momentum after; touch and trackpads scroll natively.
  wrap.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    cancelAnimationFrame(raf);
    drag = { x: e.clientX, left: wrap.scrollLeft, lastX: e.clientX, lastT: performance.now(), v: 0, id: e.pointerId };
    dragged = false;
  });
  addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!dragged && Math.abs(dx) > 4) { dragged = true; wrap.classList.add("is-dragging"); }
    if (!dragged) return;
    wrap.scrollLeft = drag.left - dx;
    const now = performance.now(), dt = now - drag.lastT;
    if (dt > 0) drag.v = ((drag.lastX - e.clientX) / dt) * 16;
    drag.lastX = e.clientX; drag.lastT = now;
  });
  const end = () => {
    if (!drag) return;
    let v = Math.max(-40, Math.min(40, drag.v));
    drag = null;
    wrap.classList.remove("is-dragging");
    if (!dragged) return;
    setTimeout(() => { dragged = false; }, 300);
    if (reduceMotion()) return;
    const coast = () => {
      if (Math.abs(v) < 0.4) return;
      wrap.scrollLeft += v;
      v *= 0.94;
      raf = requestAnimationFrame(coast);
    };
    raf = requestAnimationFrame(coast);
  };
  addEventListener("pointerup", end);
  addEventListener("pointercancel", end);
  // A vertical wheel with Shift scrolls it sideways (browsers do the rest natively).
  wrap.addEventListener("wheel", (e) => {
    if (!e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    wrap.scrollLeft += e.deltaY;
  }, { passive: false });
  wrap.addEventListener("scroll", paintButtons, { passive: true });
  prev.addEventListener("click", () => glide(-step() * 2));
  next.addEventListener("click", () => glide(step() * 2));
  addEventListener("resize", paintButtons);

  return { render, layout: paintButtons };
}
