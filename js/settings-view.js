/*
 * The Settings screen, in the family's order: Account · Appearance · Prices (this tool's) ·
 * Connections (with Advanced on a local page) · This browser. It works logged out.
 * ctx: { data() -> { state, count, newest, error, notes, loadedAt }, refresh(), login(), logout(),
 *        clearLocal(), pricesChanged() }.
 */
import * as settings from "./settings.js";
import { cfg, isServiceUrl, localPage } from "./settings.js";
import * as auth from "./auth.js";
import { larkService, onAnyService } from "./net.js";
import { RULES, ENV_LABEL } from "./config.js";
import { dayLabel } from "./rows.js";
import { $, h, ic, initTheme, radioKeys, toast, fmt } from "./ui.js";

const sessionLine = () => `Logged in until ${fmt.time(auth.endsAt())} · ${fmt.duration(auth.msLeft())} left`;
const initials = (name) => (name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

/** The connection service's status as [dot class, sentence]: the family's words. */
function serviceLine(svc) {
  const s = svc.status;
  const [tone, text] = {
    unset: ["", "Not set. Add its address under Advanced."],
    unknown: ["", "Not checked yet"],
    waking: ["is-warn", "Waking up… It sleeps when nobody's using it. This can take up to a minute."],
    awake: ["is-ok", `Awake${s.version ? ` · v${s.version}` : ""}`],
    down: ["is-err", `Unreachable (${s.detail || "no answer"}). Suppliers keeps trying when you use it.`],
    blocked: ["is-err", "Blocked by an ad blocker or privacy extension in this browser. Allow the address below, then reload."],
    outdated: ["is-warn", `Out of date (${s.detail}). Ask the admin to redeploy it.`],
  }[svc.url() ? s.state : "unset"] || ["", ""];
  const mine = cfg().overrides.filter((o) => o.startsWith("Connection service"));
  const note = mine.length ? (mine.some((o) => o.includes("page link"))
    ? " (test address from the page link; open the page with ?reset to go back)" : " (test address from Advanced)") : "";
  return [tone, `${text}${svc.host() ? ` · ${svc.host()}` : ""}${note}`];
}

export function createSettingsView(ctx) {
  function paintAccount() {
    const box = $("#account");
    if (auth.currentToken()) {
      const u = auth.user() || {};
      const pic = u.avatar ? h("img", { class: "avatar", src: u.avatar, alt: "", referrerpolicy: "no-referrer" })
        : h("span", { class: "avatar avatar-initials", "aria-hidden": "true" }, initials(u.name));
      box.replaceChildren(pic,
        h("div", { class: "account-text" }, h("b", null, u.name || "Logged in with Lark"), h("span", { id: "accSession" }, sessionLine())),
        h("div", { class: "account-actions" },
          h("button", { type: "button", class: "btn btn-sm", onclick: () => ctx.login(location.hash) }, "Log in again"),
          h("button", { type: "button", class: "btn btn-sm btn-ghost", onclick: () => ctx.logout() }, ic("logout"), "Log out")));
    } else {
      box.replaceChildren(
        h("div", { class: "account-text" }, h("b", null, "You're not logged in."),
          h("span", null, "Log in with Lark to search the procurement records. A login lasts about 2 hours.")),
        h("div", { class: "account-actions" },
          h("button", { type: "button", class: "btn btn-sm btn-primary", onclick: () => ctx.login("#/") }, "Log in with Lark")));
    }
  }

  function paintPrices() {
    const input = $("#rateInput");
    if (document.activeElement !== input) input.value = String(settings.exchangeRate());
    input.placeholder = String(RULES.exchangeRate);
    const show = settings.showPrices();
    for (const b of $("#showSeg").querySelectorAll("[data-show]")) b.setAttribute("aria-checked", String(b.dataset.show === show));
  }

  function paintConnections() {
    const conn = serviceLine(larkService);
    const d = ctx.data();
    const lark = {
      out: ["", "Log in to connect"],
      loading: ["is-warn", "Reading the records… This can take up to a minute after a quiet spell."],
      ok: ["is-ok", `Connected · ${fmt.plural(d.count || 0, "record")}${d.newest ? ` · newest ${dayLabel(d.newest)}` : ""}${d.loadedAt ? ` · updated ${fmt.time(d.loadedAt)}` : ""}`],
      error: ["is-err", d.error || "Couldn't connect"],
      unknown: ["", "Not loaded yet"],
    }[auth.currentToken() ? d.state : "out"];
    const t = cfg().table;
    $("#connList").replaceChildren(
      h("li", null, h("span", { class: `dot ${conn[0]}`.trim() }),
        h("span", { class: "status-text" }, h("b", null, "Connection service"), h("span", null, conn[1])),
        h("button", { type: "button", class: "btn btn-sm", onclick: () => { larkService.wake({ force: true }); paintConnections(); } },
          ["down", "outdated", "blocked"].includes(larkService.status.state) ? "Try again" : "Wake up")),
      h("li", null, h("span", { class: `dot ${lark[0]}`.trim() }),
        h("span", { class: "status-text" }, h("b", null, "Lark Base"), h("span", null, lark[1])),
        auth.currentToken() ? h("button", { type: "button", class: "btn btn-sm", disabled: d.state === "loading", onclick: () => ctx.refresh() }, "Refresh") : null),
      h("li", null,
        h("span", { class: "status-text" }, h("b", null, "Procurement table"),
          h("span", null, t.error ? t.error : `${t.app} · ${t.table}`)),
        t.url ? h("a", { class: "btn btn-sm btn-ghost", href: t.url, target: "_blank", rel: "noopener" }, "Open in Lark", ic("external")) : null));
    const notes = d.notes || [];
    $("#schemaBox").hidden = !notes.length;
    $("#schemaList").replaceChildren(...notes.map((n) => h("li", null, n)));
    $("#envNote").hidden = !ENV_LABEL;
    $("#envNote").textContent = ENV_LABEL ? `Suppliers is connected to the ${ENV_LABEL.toLowerCase()} table. To go live, set APP.env in js/config.js.` : "";
  }

  function paint() { paintAccount(); paintPrices(); paintConnections(); }

  function show() {
    $("#advanced").hidden = !localPage;
    const s = settings.get();
    if (document.activeElement !== $("#proxyInput")) $("#proxyInput").value = s.larkUrl || "";
    $("#proxyInput").placeholder = settings.cfg().larkUrl;
    if (!larkService.isFresh()) larkService.wake();   // retry on open
    paint();
  }

  function mount() {
    initTheme($("#themeSeg"), "suppliers.theme");
    // Prices: the exchange rate (PHP per 1 USD) and how prices are shown.
    const rate = $("#rateInput");
    const saveRate = () => {
      const v = parseFloat(rate.value);
      if (!(v > 0) || !Number.isFinite(v)) {
        rate.setAttribute("aria-invalid", "true");
        $("#rateHelp").textContent = "Type a number above 0, for example 57.";
        return;
      }
      rate.removeAttribute("aria-invalid");
      $("#rateHelp").textContent = "";
      if (v === settings.exchangeRate()) return;
      settings.set({ exchangeRate: v === RULES.exchangeRate ? null : v });
      ctx.pricesChanged();
    };
    rate.addEventListener("change", saveRate);
    rate.addEventListener("keydown", (e) => { if (e.key === "Enter") saveRate(); });
    $("#showSeg").addEventListener("click", (e) => {
      const b = e.target.closest("[data-show]");
      if (!b) return;
      settings.set({ showPrices: b.dataset.show || null });
      paintPrices();
      ctx.pricesChanged();
    });
    radioKeys($("#showSeg"));

    $("#proxySave").addEventListener("click", () => {
      const v = $("#proxyInput").value.trim();
      if (v && !isServiceUrl(v)) { toast("Use an https:// address, or http:// for one on this computer.", { type: "error" }); return; }
      settings.set({ larkUrl: v });
      toast(v ? "Using that connection service on this computer." : "Using the hosted connection service.", { type: "success" });
      larkService.wake({ force: true });
      ctx.refresh();
    });
    $("#proxyReset").addEventListener("click", () => {
      settings.set({ larkUrl: "" });
      $("#proxyInput").value = "";
      toast("Using the hosted connection service.", { type: "success" });
      larkService.wake({ force: true });
      ctx.refresh();
    });
    $("#clearLocal").addEventListener("click", () => ctx.clearLocal());
    onAnyService(() => { if (document.body.dataset.view === "settings") paintConnections(); });
  }

  /** Refresh just the "time left" line (the session clock). */
  function tick() {
    const line = document.getElementById("accSession");
    if (line && auth.currentToken()) line.textContent = sessionLine();
  }

  return { mount, show, paint, tick };
}
