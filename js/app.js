/*
 * Suppliers: the page shell. State, routes, the header, the login, loading the records,
 * the address bar, and the wiring between the views (each view is a module of its own:
 * searchbar.js, filters.js, results.js, detail.js, carousel.js, settings-view.js).
 *
 * Routes: #/ search · #/r/<record id> a record open beside the results · #/settings.
 * The search itself lives in the query string (?q=…&tab=…), in the old page's format, so
 * a link someone shared opens the same view (after they log in).
 *
 * The records come from the Lark Base every time the page loads, read as the signed-in
 * person, and stay in this tab's memory only (they include suppliers' bank details): never
 * in browser storage, and dropped the moment the login ends.
 */
import { APP, ENV_LABEL, LARK, RULES } from "./config.js";
import { $, $$, h, ic, fillIcons, toast, fmt, store, recall, sleep, closeMenu } from "./ui.js";
import * as settings from "./settings.js";
import { cfg } from "./settings.js";
import { larkService, onAnyService, blockedHosts, describe, lark, unreachable } from "./net.js";
import { isDeadToken, LarkError } from "./errors.js";
import * as auth from "./auth.js";
import { loadFields, loadRecords } from "./tables.js";
import { checkSchema } from "./schema.js";
import { toRows, sortTime } from "./rows.js";
import { createIndex } from "./search.js";
import { cacheKey, pack, unpack, ownerOf } from "./cache.js";
import { TABS, detectExactPattern, highlightTerms, encodeState, decodeState, statsOf, recent } from "./query.js";
import { createSearchBar } from "./searchbar.js";
import { createFilters } from "./filters.js";
import { createResults } from "./results.js";
import { createDetail } from "./detail.js";
import { createCarousel } from "./carousel.js";
import { createSettingsView } from "./settings-view.js";

const KEY = { theme: "suppliers.theme", view: "suppliers.view" };
// What "Clear local data" forgets (never the login or the theme): the settings and the saved copy of the records.
const localKeys = () => ["suppliers.settings", ...(cfg().table.error ? [] : [cacheKey(cfg().table)])];
const LOW_SESSION_MS = 10 * 60 * 1000;

/* ======================= state ======================= */
const defaultFilters = () => ({ sort: null, statuses: new Set(RULES.defaultStatuses), outsource: null, currency: null, group: null });
const S = {
  view: "login",            // login | busy | search | settings
  gen: 0,                   // bumped when a login ends, so a load still running can't bring its records back
  rows: null, byId: new Map(), index: null, stats: null, loadedAt: 0, schema: null, countNote: "",
  fromCache: false,         // the records on screen are the saved copy (the live read is still running)
  loading: false, quiet: false, waking: false, stage: "", progress: null, loadError: null,
  fresh: null,              // a quiet refresh that finished while results were showing: applied on "Show them"
  filters: defaultFilters(),
  tab: "all", exact: false, userExact: false, autoExact: false,
  browse: false,            // "Browse all": every record, with the filters
  results: null,            // one list per tab ([{ item, score }]), or null when there's no search
  terms: [], queryText: "",
  open: null,               // the record open in the detail panel
  user: null, loginNote: "", returnTo: "",
};
const prefs = () => ({ rate: settings.exchangeRate(), show: settings.showPrices() });

/* Every Lark call runs as the signed-in person, and every one of them is a read (retried while
   the proxy wakes). While a load runs (auth.track), its calls may use the token until its real
   expiry, so the clock can't cut a load off half way. */
function call(method, url, body) {
  const t = auth.busyWorking() ? auth.workToken() : auth.currentToken();
  if (!t) {
    auth.end("Your login ended after about 2 hours. Log in again to keep going.");
    return Promise.reject(new LarkError("login ended", { deadToken: true }));
  }
  return lark(method, url, { token: t.access_token, body, read: true });
}

/* ======================= views ======================= */
const ctx = {
  S, prefs,
  browsing: () => S.browse,
  fieldValues: (f, p, n) => (S.index ? S.index.fieldValues(f, p, n) : []),
  changed: () => runSearch(),
  cleared: () => clearSearch(),
  setFilters: (patch) => setFilters(patch),
  resetFilters: () => setFilters(defaultFilters()),
  startField: (f) => bar.startField(f),
  open: (id) => openRecord(id),
  browseAll: () => browseAll(),
  total: () => (S.rows ? S.rows.length : 0),
  close: () => closeRecord(),
  data: () => ({
    state: S.loading && !S.rows ? "loading" : S.loadError ? "error" : S.rows ? "ok" : "unknown",
    count: S.rows ? S.rows.length : 0, newest: S.stats ? S.stats.newest : "", loadedAt: S.loadedAt,
    error: S.loadError ? loadErrorText(S.loadError) : "", notes: S.schema ? S.schema.notes : [],
  }),
  refresh: () => load({ quiet: true, manual: true }),
  login: (returnTo) => login(returnTo),
  logout: () => { dropCache(); auth.logout(); location.hash = "#/"; },
  clearLocal: () => clearLocal(),
  pricesChanged: () => pricesChanged(),
};
const bar = createSearchBar(ctx);
const filters = createFilters(ctx);
const results = createResults(ctx);
const detail = createDetail(ctx);
const carousel = createCarousel(ctx);
const settingsView = createSettingsView(ctx);

/* ======================= routes ======================= */
function parseRoute() {
  const hash = location.hash || "#/";
  if (/^#\/settings\b/.test(hash)) return { view: "settings", open: null };
  const m = hash.match(/^#\/r\/([^/?#]+)/);
  return { view: "search", open: m ? decodeURIComponent(m[1]) : null };
}

function onRoute() {
  const r = parseRoute();
  const wasOpen = S.open;
  if (r.view === "settings") S.view = "settings";
  else if (!auth.currentToken()) { S.view = "login"; S.returnTo = location.hash || "#/"; }
  else { S.view = "search"; S.open = r.open; }
  if (S.view === "search" && S.open && S.rows && !S.byId.has(S.open)) {
    toast("That record isn't in the procurement table, or your account can't see it.", { type: "info" });
    S.open = null;
    history.replaceState(null, "", `${location.pathname}${location.search}#/`);
  }
  render();
  if (S.view === "search" && S.open !== wasOpen) afterOpenChange(wasOpen);
  if (auth.currentToken() && !S.rows && !S.loading && !S.loadError) load();
  if (S.view === "settings") window.scrollTo(0, 0);
}

/** A record opened or closed: on a narrow screen the sheet takes the keyboard; closing gives it back to the card. */
function afterOpenChange(was) {
  const narrow = matchMedia("(max-width: 768px)").matches;   // the panel covers the screen
  if (S.open && narrow) detail.focus();
  if (!S.open && was) {
    const c = results.cardFor(was) || document.querySelector(`.recent-card[data-id="${CSS.escape(was)}"]`);
    if (c && (narrow || document.activeElement === document.body || $("#detail").contains(document.activeElement))) c.focus({ preventScroll: !narrow });
  }
}

/* Opening a record from the list adds one history entry (so Back closes it); moving from one
   open record to another replaces it, so Back doesn't walk through every card you looked at. */
function openRecord(id) {
  const url = `${location.pathname}${location.search}#/r/${encodeURIComponent(id)}`;
  if (S.open) history.replaceState(history.state, "", url);
  else history.pushState({ opened: true }, "", url);
  onRoute();
}
function closeRecord() {
  if (!S.open) return;
  if (history.state && history.state.opened) history.back();   // popstate runs onRoute
  else { history.replaceState(null, "", `${location.pathname}${location.search}#/`); onRoute(); }
}

/* ======================= rendering ======================= */
function pageTitle() {
  if (S.view === "search" && S.open && S.byId.has(S.open)) return `${S.byId.get(S.open)["Particulars_Item"] || "Record"} · ${APP.name}`;
  return `${{ login: "Log in", busy: "Logging in", settings: "Settings", search: "Search" }[S.view]} · ${APP.name}`;
}

function render() {
  for (const v of $$(".view")) v.classList.toggle("active", v.dataset.view === S.view);
  document.body.dataset.view = S.view;
  document.title = pageTitle();
  renderHeader();
  paintBlock();
  if (S.view === "login") renderLogin();
  if (S.view === "settings") settingsView.show();
  if (S.view === "search") renderSearch();
  else document.body.classList.remove("detail-open");
}

const initials = (name) => (name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

function renderHeader() {
  $("#appVersion").textContent = $("#loginVersion").textContent = `v${APP.version}`;
  $("#appVersion").title = `${APP.name} version ${APP.version}`;
  const signedIn = !!auth.currentToken();
  $("#envBadge").hidden = !ENV_LABEL;
  $("#envBadge").textContent = ENV_LABEL;
  const over = cfg().overrides;
  $("#overrideBadge").hidden = !over.length;
  $("#overrideBadge").title = over.length ? `Overridden in this browser. ${over.join(". ")}` : "";
  $("#sessionPill").hidden = !signedIn;
  $("#meLink").hidden = !signedIn;
  $("#searchLink").hidden = !signedIn;
  for (const a of $$(".nav a")) {
    if (a.dataset.nav === S.view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  if (signedIn) {
    const left = auth.msLeft();
    $("#sessionLeft").textContent = fmt.duration(left);
    $("#sessionPill").classList.toggle("is-low", left < LOW_SESSION_MS);
    $("#sessionPill").title = `Your login lasts until ${fmt.time(auth.endsAt())}`;
    $("#sessionPill").setAttribute("aria-label", `Logged in for ${fmt.duration(left)} more, until ${fmt.time(auth.endsAt())}`);
    const u = S.user || auth.user() || {};
    $("#avatar").hidden = !u.avatar;
    if (u.avatar && $("#avatar").getAttribute("src") !== u.avatar) $("#avatar").src = u.avatar;
    $("#initials").hidden = !!u.avatar;
    $("#initials").textContent = initials(u.name);
    $("#meLink").title = u.name ? `${u.name} · Settings` : "Settings";
  }
}

function paintBlock() {
  const hosts = blockedHosts();
  $("#blockNote").hidden = !hosts.length;
  $("#blockHost").textContent = hosts.join(", ") || larkService.host();
}

function renderSearch() {
  $(".view-search").classList.toggle("has-results", !!S.results);
  paintLoad();
  paintStatus();
  $("#home").hidden = !S.rows || !!S.results;
  if (S.stats) $("#browseAll").querySelector(".label").textContent = `Browse all ${S.stats.records.toLocaleString()}`;
  const notes = S.rows && S.schema ? S.schema.notes : [];
  $("#schemaNote").hidden = !notes.length || !!S.results;
  $("#schemaNoteText").textContent = notes.join(" ");
  $("#openLark").href = cfg().table.url || "#/";
  $("#refreshBtn").disabled = !auth.currentToken() || (S.loading && !S.quiet);
  $("#refreshBtn").classList.toggle("is-busy", S.loading);
  paintExact();
  filters.paint();
  bar.setReady(!!S.index);
  detail.render();
  results.markOpen();
}

/** Redraw the list (after a search, a tab, a filter or a price change). */
function drawList(opts = {}) {
  results.render(opts);
  $(".view-search").classList.toggle("has-results", !!S.results);
  const homeWas = $("#home").hidden;
  $("#home").hidden = !S.rows || !!S.results;
  if (homeWas && !$("#home").hidden) carousel.layout();   // back on the landing: the strip may have a new width
  $("#schemaNote").hidden = !(S.rows && S.schema && S.schema.notes.length) || !!S.results;
}

function paintExact() {
  const b = $("#qexact");
  b.setAttribute("aria-pressed", String(S.exact));
  b.title = S.autoExact ? "Exact match: on, because this looks like a request number or project code" : "Exact match only";
}

/* The status line: what's loaded and how fresh it is. */
function paintStatus() {
  const el = $("#status");
  if (!S.rows) { el.replaceChildren(); el.hidden = true; return; }
  el.hidden = false;
  const s = S.stats;
  const parts = [h("span", null, `${fmt.plural(s.records, "record")} · ${fmt.plural(s.suppliers, "supplier")}`)];
  if (S.fromCache) parts.push(h("span", null, `· Saved copy from ${fmt.day(S.loadedAt)}, ${fmt.time(S.loadedAt)}`));
  if (S.loading) parts.push(h("span", { class: "spinner", "aria-hidden": "true" }), h("span", null, S.fromCache ? "Reading the latest…" : "Refreshing…"));
  else if (S.fresh) {
    const d = S.fresh.rows.length - S.rows.length;
    parts.push(h("span", null, `· Newer records are ready${d > 0 ? ` (${fmt.plural(d, "new record")})` : ""}.`),
      h("button", { type: "button", class: "linkish", onclick: () => apply(S.fresh, { keepScroll: true }) }, "Show them"));
  } else if (!S.fromCache) parts.push(h("span", null, `· Updated ${fmt.time(S.loadedAt)}`));
  if (S.countNote) parts.push(h("span", { class: "status-warn" }, `· ${S.countNote}`));
  el.replaceChildren(...parts);
}

/* The first load: a staged loader. Errors stay until the person tries again. */
const STAGES = [["wake", "Connecting to Lark"], ["fields", "Checking the table's columns"],
                ["records", "Reading the records"], ["index", "Building the search index"]];
function loadErrorText(err) {
  if (err.schema) return `${err.schema.problems.join(" ")} Tell the tool owner.`;
  return describe(err);
}
function paintLoad() {
  const box = $("#loadBox");
  if (S.loadError && !S.rows) {
    const err = S.loadError;
    box.replaceChildren(h("div", { class: "callout callout-err", role: "alert" }, ic("alert"),
      h("div", null, h("p", null, h("b", null, err.schema ? "Suppliers can't use the procurement table." : "Couldn't load the procurement records.")),
        h("p", null, loadErrorText(err))),
      err.schema && cfg().table.url ? h("a", { class: "btn btn-sm", href: cfg().table.url, target: "_blank", rel: "noopener" }, "Open in Lark")
        : h("button", { type: "button", class: "btn btn-sm", onclick: () => { S.loadError = null; load(); } }, "Try again")));
    return;
  }
  if (!S.loading || S.quiet || S.rows) { box.replaceChildren(); return; }
  const at = STAGES.findIndex(([k]) => k === S.stage);
  const p = S.progress;
  box.replaceChildren(h("div", { class: "loader", role: "status" },
    h("div", { class: "loader-title" }, h("span", { class: "spinner", "aria-hidden": "true" }),
      S.waking ? "Waking up the connection…" : "Reading the procurement records…"),
    S.waking ? h("p", { class: "loader-sub" }, "It sleeps when nobody's using it. This can take up to a minute.") : null,
    h("ul", { class: "stages" }, STAGES.map(([k, label], i) => h("li", { class: i < at ? "done" : i === at ? "current" : "" },
      i < at ? ic("check") : i === at ? h("span", { class: "spinner", "aria-hidden": "true" }) : h("span", { class: "slot", "aria-hidden": "true" }),
      label,
      i === at && p ? h("span", { class: "n" }, p.total ? `${p.n.toLocaleString()} of ${p.total.toLocaleString()}` : p.n.toLocaleString()) : null)))));
}

/* ======================= login ======================= */
let probed = null;
function renderLogin() {
  const note = $("#loginMsg");
  note.hidden = !S.loginNote;
  note.textContent = S.loginNote;
  // Check the address on the way in, and again whenever the screen comes back after a failure.
  if (probed !== S.loginNote) {
    probed = S.loginNote;
    larkService.wake();   // start waking the proxy now, so it's ready after login
    auth.redirectProblem().then((problem) => {
      $("#redirectMsg").hidden = !problem;
      $("#redirectMsg").textContent = problem || "";
    });
  }
}

async function login(returnTo) {
  try {
    await auth.startLogin(returnTo || S.returnTo || "#/");
  } catch (e) {
    S.loginNote = e.message;
    if (S.view === "login") renderLogin(); else toast(e.message, { type: "error" });
  }
}
// The search in the address bar is kept across Lark's page (Lark returns to the bare address).
auth.onBeforeLogin(() => store("session", KEY.view, location.search));

/* Drop every record from memory. */
function forgetRecords() {
  S.gen++;
  Object.assign(S, { rows: null, byId: new Map(), index: null, stats: null, schema: null, results: null, fresh: null, fromCache: false,
                     open: null, loadError: null, loadedAt: 0, countNote: "", user: null });
  carousel.render([]);
  results.render();
  detail.render({ instant: true });   // the panel's text goes too (it may show a supplier's bank details)
}

/* A login ended (the clock, Lark refusing the token, Log out, here or in another tab or tool: they
   share the login): drop every record from memory. Ended early elsewhere (most likely Log out in
   another tool): the saved copy goes too, as with Log out here. */
function sessionEnded(message, { elsewhere = false } = {}) {
  S.gen++;
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
  filters.close({ focus: false });
  closeMenu();
  if (elsewhere) dropCache();
  forgetRecords();
  S.loginNote = message || "Your login ended after about 2 hours. Log in again to keep going.";
  S.returnTo = location.hash || "#/";
  if (S.view !== "settings") S.view = "login";
  render();
}
auth.onEnded(sessionEnded);

/* Another tab, of Suppliers or another Mineski tool, logged in or renewed the login (js/session.js).
   A tab on the login screen goes straight in and reads the table. If it's someone else now, what
   this tab read for the previous person goes first. */
function sharedLogin({ renewed }) {
  S.loginNote = "";
  const was = ownerOf(S.user);
  auth.loadUser().then((u) => {
    if (was && ownerOf(u) !== was) { forgetRecords(); S.user = u; onRoute(); return; }
    S.user = u;
    renderHeader();
    if (S.view === "settings") settingsView.paint();
  }).catch(() => {});
  if (renewed) { renderHeader(); if (S.view === "settings") settingsView.tick(); return; }
  if (S.view !== "busy") onRoute();   // busy: this tab is finishing its own login
}
auth.onShared(sharedLogin);

/* ======================= loading ======================= */
const showingResults = () => !!S.results || !!S.open;

/** Read the whole table. quiet: keep showing what's there and refresh in the background.
 *  manual: the person asked (Refresh), so apply it at once. A background refresh that finds
 *  results on screen waits for "Show them" instead of moving them under the person. */
async function load({ quiet = false, manual = false } = {}) {
  if (S.loading || !auth.currentToken()) return;
  const t = cfg().table;
  if (t.error) { S.loadError = new LarkError(t.error, { userMessage: t.error }); render(); return; }
  const gen = S.gen;
  Object.assign(S, { loading: true, quiet: quiet && !!S.rows, loadError: null, stage: "wake", progress: null, waking: false });
  if (S.view === "search") renderSearch();
  // Nothing on screen yet: show the saved copy (if this person has one) while the table is read behind it.
  if (!S.rows) {
    const saved = await readCache(t);
    if (gen !== S.gen) { S.loading = false; return; }
    if (saved) {
      const index = createIndex();
      await index.build(saved.rows);
      if (gen !== S.gen) { S.loading = false; return; }
      apply({ rows: saved.rows, index, schema: null, at: saved.at, countNote: "", fromCache: true });
      S.quiet = true;
      if (S.view === "search") renderSearch();
    }
  }
  try {
    const fresh = await auth.track(async () => {
      const awake = larkService.wake();
      if ((await Promise.race([awake, sleep(1200).then(() => "slow")])) === "slow" && !S.quiet) { S.waking = true; paintLoad(); }
      if (!(await awake)) throw unreachable();
      S.waking = false;
      S.stage = "fields"; paintLoad();
      const schema = checkSchema(await loadFields(call, t));
      if (schema.problems.length) throw Object.assign(new Error(schema.problems.join(" ")), { schema });
      S.stage = "records"; paintLoad();
      let total = null;
      const items = await loadRecords(call, t, schema.present, (n, of) => { total = of; S.progress = { n, total: of }; paintLoad(); });
      const rows = toRows(items, LARK.tzOffsetMinutes);
      S.stage = "index"; S.progress = null; paintLoad();
      const index = createIndex();
      await index.build(rows, (n, of) => { S.progress = { n, total: of }; paintLoad(); });
      return { rows, index, schema, at: Date.now(),
        countNote: total !== null && total !== items.length
          ? `Lark counted ${total.toLocaleString()} records but ${items.length.toLocaleString()} came back, so the table changed while it was read. Refresh to be sure.` : "" };
    });
    if (gen !== S.gen) return;   // the login ended meanwhile: these records must not come back
    saveCache(t, fresh.rows, fresh.at);
    // The saved copy is replaced at once (search, filters and the open record stay); a quiet refresh
    // over live records waits for "Show them" while results are on screen.
    if (quiet && !manual && S.rows && !S.fromCache && showingResults()) S.fresh = fresh;
    else apply(fresh, { keepScroll: !!S.rows });
  } catch (err) {
    if (gen !== S.gen || isDeadToken(err)) return;   // the session already ended; the login screen is up
    if (S.rows) toast("Couldn't refresh the records.", { type: "error", detail: loadErrorText(err), action: "Try again", onAction: () => load({ quiet: true, manual: true }) });
    else S.loadError = err;
  } finally {
    S.loading = false; S.quiet = false; S.stage = ""; S.progress = null; S.waking = false;
    if (gen === S.gen) render();
  }
}

/** Put freshly read records in place: the search, filters, tab and open record stay as they are. */
function apply(fresh, { keepScroll = false } = {}) {
  const first = !S.rows;
  Object.assign(S, { rows: fresh.rows, index: fresh.index, schema: fresh.schema, loadedAt: fresh.at, countNote: fresh.countNote, fresh: null,
                     fromCache: !!fresh.fromCache });
  S.byId = new Map(fresh.rows.map((r) => [r.$id, r]));
  S.stats = statsOf(fresh.rows);
  carousel.render(recent(fresh.rows));
  bar.setReady(true);
  if (S.open && !S.byId.has(S.open)) {
    toast("The record you had open isn't in the table any more.", { type: "info" });
    closeRecord();
  }
  if (bar.fullQuery() || S.browse) runSearch({ keepScroll, keepOpen: true });
  render();
  if (first && S.view === "search" && !S.open) bar.focus();
}

/* ======================= the saved copy (js/cache.js) ======================= */
/** This person's saved copy of the table, or null. Someone else's (or an old format) is dropped. */
async function readCache(t) {
  const key = cacheKey(t);
  const saved = recall("local", key);
  if (!saved) return null;
  const owner = ownerOf(await auth.loadUser().catch(() => null));
  const got = owner ? await unpack(saved, owner).catch(() => null) : null;
  if (!got && owner) store("local", key);
  return got;
}
/** Save the live read for next time (quietly: a full browser storage just means no saved copy). */
async function saveCache(t, rows, at) {
  try {
    const owner = ownerOf(auth.user() || await auth.loadUser());
    if (!owner || !auth.currentToken()) return;
    const gen = S.gen;
    const packed = await pack(rows, { owner, at });
    if (gen === S.gen) store("local", cacheKey(t), packed);
  } catch (_) { /* no saved copy this time */ }
}
function dropCache() { if (!cfg().table.error) store("local", cacheKey(cfg().table)); }

/* ======================= searching ======================= */
let seq = 0;
async function runSearch({ keepScroll = false, keepOpen = false } = {}) {
  const full = bar.fullQuery();
  if (full) S.browse = false;
  bar.setReady(!!S.index);
  // Request numbers and project codes switch Exact on by themselves (free text only), unless you chose.
  const free = bar.freeText();
  const auto = free ? detectExactPattern(free) : false;
  if (auto && !S.userExact) { S.autoExact = true; S.exact = true; }
  else if (!auto && S.autoExact) { S.autoExact = false; S.exact = S.userExact; }
  paintExact();
  updateUrl();
  if (!S.index) return;   // still loading: it runs again once the records are in
  if (!full && !S.browse) { clearResults(); return; }
  const my = ++seq;
  let lists;
  if (!full) {
    const all = S.rows.slice().sort((a, b) => sortTime(b["Submitted at"]) - sortTime(a["Submitted at"])).map((item) => ({ item, score: 0 }));
    lists = TABS.map(() => all);
  } else {
    lists = await Promise.all(TABS.map((tab) => S.index.search(full, { tab, exact: S.exact })));
  }
  if (my !== seq) return;   // a newer search has started
  S.results = lists;
  S.queryText = full;
  S.terms = highlightTerms(bar.highlightText());
  if (!keepOpen && S.open) closeRecord();
  drawList({ keepScroll, newResults: true });
  renderSearch();
}

function clearResults() {
  S.results = null; S.terms = []; S.queryText = "";
  if (S.open) closeRecord();
  drawList();
  renderSearch();
}
function clearSearch() {
  S.browse = false;
  bar.setReady(!!S.index);
  runSearch();
}

function setFilters(patch) {
  Object.assign(S.filters, patch);
  filters.paint();
  drawList();
  updateUrl();
}

function pricesChanged() {
  if (S.results) drawList({ keepScroll: true });
  detail.render();
  if (S.rows) carousel.render(recent(S.rows));
  updateUrl();
}

/* ======================= the address bar ======================= */
function updateUrl() {
  const qs = encodeState({
    chips: bar.chips(), text: bar.freeText(), exact: S.exact, tab: S.tab, ...S.filters, all: S.browse,
    theme: recall("local", KEY.theme) || "system", rate: settings.exchangeRate(), show: settings.showPrices(),
  });
  // Developer switches stay in the address while they're on (local page only).
  const keep = new URLSearchParams();
  if (settings.localPage) {
    const now = new URLSearchParams(location.search);
    for (const k of ["preview", "lark"]) if (now.has(k)) keep.set(k, now.get(k));
  }
  const all = [qs, keep.toString()].filter(Boolean).join("&");
  const next = `${location.pathname}${all ? `?${all}` : ""}${location.hash}`;
  if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, "", next);
}

function applyUrlState() {
  const d = decodeState(location.search);
  if ("exact" in d) { S.userExact = d.exact; S.exact = d.exact; }
  if (d.tab) S.tab = d.tab;
  for (const k of ["sort", "statuses", "outsource", "currency", "group"]) if (k in d) S.filters[k] = d[k];
  if (d.all) S.browse = true;
  if (d.chips) bar.setState(d.chips, d.text);
  if (!("exact" in d) && d.text && detectExactPattern(d.text)) { S.autoExact = true; S.exact = true; }
}

/* ======================= this browser ======================= */
function clearLocal() {
  const saved = localKeys().map((k) => [k, recall("local", k)]);
  localKeys().forEach((k) => store("local", k));
  settings.rebuild();
  pricesChanged();
  settingsView.paint();
  toast("Cleared the saved records, the exchange rate and the price display in this browser.", {
    type: "success", detail: "Your login and theme are kept.", action: "Undo", onAction: () => {
      saved.forEach(([k, v]) => { if (v !== null) store("local", k, v); });
      settings.rebuild();
      pricesChanged();
      settingsView.paint();
    },
  });
}

/* ======================= wiring ======================= */
fillIcons();
settingsView.mount();
$("#loginBtn").addEventListener("click", () => login());
$("#reloadBtn").addEventListener("click", () => location.reload());
$("#refreshBtn").addEventListener("click", () => load({ quiet: true, manual: true }));
function browseAll() { bar.clear(); S.browse = true; bar.setReady(true); runSearch(); }
$("#browseAll").addEventListener("click", browseAll);
$("#qexact").addEventListener("click", () => {
  S.userExact = !S.userExact;
  S.autoExact = false;
  S.exact = S.userExact;
  paintExact();
  runSearch({ keepOpen: true });
});
$("#qhelp").addEventListener("click", () => $("#help").showModal());
$("#helpClose").addEventListener("click", () => $("#help").close());
$("#help").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });   // backdrop
$("#themeSeg").addEventListener("click", () => setTimeout(updateUrl));
// The tabs: in-page tabs over one result list (arrow keys move between them).
const tabs = $$(".qtab");
for (const t of tabs) {
  t.addEventListener("click", () => {
    S.tab = t.dataset.tab;
    drawList();
    updateUrl();
  });
  t.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(t);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1 + tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = tabs[to % tabs.length];
    next.focus();
    next.click();
  });
}
document.addEventListener("keydown", (e) => {
  const typing = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
  if (e.key === "/" && !typing && S.view === "search" && !document.querySelector("dialog[open]") && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    bar.focus();
    return;
  }
  if (e.key === "Escape" && S.view === "search" && S.open && !document.querySelector("dialog[open]") && !filters.isOpen()) closeRecord();
});
// A click outside the open record closes it (as on the old page). Clicks on a card (they open or switch
// records), a group's header, a toast, the filter panel, a menu or a dialog don't count.
document.addEventListener("click", (e) => {
  if (S.view !== "search" || !S.open) return;
  if (!e.target.isConnected || document.querySelector("dialog[open]") || filters.isOpen()) return;
  if (e.target.closest("#detail, a.result, .recent-card, .rgroup > summary, .toasts, .popover, .ctx-menu, .filter-backdrop")) return;
  if (String(getSelection() || "").trim()) return;   // ending a text selection isn't a click outside
  closeRecord();
});
onAnyService(() => {
  paintBlock();
  if (S.view === "busy") {
    $("#busyMsg").textContent = larkService.status.state === "waking"
      ? "Logging you in… Waking up the connection service, which can take up to a minute." : "Logging you in…";
  }
});
addEventListener("hashchange", onRoute);
addEventListener("popstate", onRoute);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  // Back after a long while: refresh quietly (results on screen aren't moved: see load()).
  if (S.rows && !S.loading && Date.now() - S.loadedAt > RULES.staleAfterMs) load({ quiet: true });
});
auth.startClock(() => { renderHeader(); settingsView.tick(); });

(async function init() {
  const params = new URLSearchParams(location.search);
  if (params.has("code") || params.has("error")) {
    S.view = "busy";
    render();
    const res = await auth.handleRedirect();   // strips ?code first, wakes the proxy, swaps the code once
    const saved = recall("session", KEY.view);
    store("session", KEY.view, undefined);
    if (typeof saved === "string" && saved.startsWith("?")) history.replaceState(null, "", `${location.pathname}${saved}${location.hash}`);
    if (!res.ok) S.loginNote = res.message;
  } else {
    if (!location.hash) history.replaceState(null, "", `${location.pathname}${location.search}#/`);
  }
  settings.takeUrlChoices(new URLSearchParams(location.search));
  applyUrlState();
  if (auth.currentToken()) {
    auth.loadUser().then((u) => { S.user = u; renderHeader(); if (S.view === "settings") settingsView.paint(); })
      .catch(() => {});   // no name or picture is fine; a dead login already ended the session (net.js)
  } else if (auth.hadSession() && !S.loginNote) {
    S.loginNote = "Your login ended after about 2 hours. Log in again to keep going.";
    auth.clearSession();
  }
  larkService.wake();
  onRoute();
  updateUrl();   // tidies the address (an old ?debugkey= goes, for one)
})();
document.documentElement.dataset.booted = "";   // started: the boot watchdog in index.html stands down
