/*
 * Settings: per-browser preferences layered over config.js.
 *
 *   config.js defaults  <-  saved in this browser  <-  ?lark= (local page only, per tab)
 *
 * Personal choices (the exchange rate, how prices are shown) work everywhere. The
 * connection service address can only be overridden on a local page: the Lark proxy
 * receives people's login tokens, so a hosted page always uses the real one. Every
 * active override is listed by cfg().overrides and shown as a red badge in the top bar.
 *
 * cfg() is rebuilt whenever settings change, so modules call it at use time rather than
 * keeping a copy. The theme has its own key (suppliers.theme, ui.js initTheme).
 */
import { APP, SERVICES, RULES, tableLinks } from "./config.js";
import { parseBaseLink } from "./tables.js";
import { store, recall } from "./ui.js";

const KEY = "suppliers.settings";
export const SHOW_CHOICES = ["", "PHP", "USD"];   // "" = each price in its own currency

const isLocalHost = (name) => /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(name);
const isLocal = (u) => { try { return isLocalHost(new URL(u).hostname); } catch (_) { return false; } };
/** https, or http on this computer. */
export const isServiceUrl = (u) => {
  try { const x = new URL(u); return x.protocol === "https:" || (x.protocol === "http:" && isLocal(u)); } catch (_) { return false; }
};
export const localPage = isLocalHost(location.hostname);

const read = () => recall("local", KEY) || {};

/** The table link in force, parsed once ({ app, table, view, url }), or the reason it can't be used. */
function configTable() {
  const link = tableLinks().procurement;
  if (!link) return { error: `There's no procurement table link for the ${APP.env} copy in js/config.js.` };
  try { return parseBaseLink(link); } catch (e) { return { error: `The procurement table link in js/config.js doesn't work: ${e.message}` }; }
}
const table = configTable();

let current;
const listeners = new Set();
/** The configuration in force: { larkUrls, ceUrls, table, overrides: ["…"] }. larkUrls are tried in order;
 *  an override replaces the whole list with one address. */
export const cfg = () => current;
/** Subscribe to saved-settings changes. Returns the unsubscribe function. */
export const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function rebuild() {
  const s = localPage ? read() : {};
  const c = { larkUrls: [...SERVICES.lark.urls], ceUrls: [...SERVICES.ce.urls], table, overrides: [] };
  if (s.larkUrl && isServiceUrl(s.larkUrl)) { c.larkUrls = [s.larkUrl]; c.overrides.push("Connection service address (Settings)"); }
  if (localPage) {   // testing override, per tab
    const q = new URLSearchParams(location.search);
    if (q.has("reset")) store("session", "suppliers.override.lark", undefined);
    if (q.get("lark") && isServiceUrl(q.get("lark"))) store("session", "suppliers.override.lark", q.get("lark"));
    const v = recall("session", "suppliers.override.lark");
    if (v && isServiceUrl(v)) { c.larkUrls = [v]; c.overrides.push("Connection service address (page link)"); }
    if (q.has("reset")) store("session", "suppliers.override.ce", undefined);
    if (q.get("ce") && isServiceUrl(q.get("ce"))) store("session", "suppliers.override.ce", q.get("ce"));
    const ce = recall("session", "suppliers.override.ce");
    if (ce && isServiceUrl(ce)) { c.ceUrls = [ce]; c.overrides.push("Line item service address (page link)"); }
  }
  if (APP.env !== "live") c.overrides.push(`Environment: ${APP.env}`);
  c.larkUrls = c.larkUrls.map((u) => String(u || "").replace(/\/+$/, "")).filter(Boolean);
  c.ceUrls = c.ceUrls.map((u) => String(u || "").replace(/\/+$/, "")).filter(Boolean);
  current = c;
}

/** Save a change ({ key: value }, "" or null removes it). */
export function set(patch) {
  const next = Object.assign(read(), patch);
  Object.keys(next).forEach((k) => (next[k] == null || next[k] === "") && delete next[k]);
  const ok = store("local", KEY, next);
  rebuild();
  listeners.forEach((fn) => fn(patch));
  return ok;
}

// ---- personal choices -----------------------------------------------------------
/** PHP per 1 USD: the saved one if it's a positive number, else the default. */
export function exchangeRate() {
  const r = Number(read().exchangeRate);
  return r > 0 && Number.isFinite(r) ? r : RULES.exchangeRate;
}
/** How prices are shown: "" (each in its own currency), "PHP" or "USD". */
export function showPrices() {
  const s = read().showPrices;
  return SHOW_CHOICES.includes(s) ? s : "";
}

/** ?exchangerate= and ?showprice= in a shared link become this browser's choice (as before). */
export function takeUrlChoices(params) {
  const patch = {};
  const r = parseFloat(params.get("exchangerate"));
  if (r > 0 && Number.isFinite(r)) patch.exchangeRate = r;
  const s = String(params.get("showprice") || "").toLowerCase();
  const show = { default: "", php: "PHP", usd: "USD" };
  if (s in show) patch.showPrices = show[s] || null;
  if (Object.keys(patch).length) set(patch);
}

export { read as get };

rebuild();
