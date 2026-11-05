/*
 * Errors as facts, and the words for them. Pure (no DOM, no network), so the Node
 * tests run the exact code the page runs.
 *
 * Network code throws LarkError(message, { network, timedOut, status, json, raw, deadToken }).
 * describe() turns one into one plain sentence at display time: network facts first, then
 * the shared Lark code table (Polaris's BY_CODE), then what's left. Suppliers only reads, so
 * there are no write outcomes ("uncertain") to explain. Never a raw code alone, and never
 * developer instructions (script names) for the people using the page.
 */

export class LarkError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra); }
}

/** Lark codes meaning the login itself is no good (expired, revoked, malformed). One shared set. */
export const DEAD_TOKEN_CODES = [20005, 99991661, 99991663, 99991668, 99991671, 99991677];
export const isDeadToken = (err) => !!(err && (err.deadToken
  || (err.json && DEAD_TOKEN_CODES.includes(Number(err.json.code)))));

const LOGIN_FAILED = "The connection service couldn't complete the login. Try again; if it keeps happening, tell the admin.";
const CODE_EXPIRED = "That login code expired or was already used. Log in again.";
const NO_BASE = (o) => `${o.app} is pointed at a Base that doesn't exist. Tell the tool owner.`;
const NO_TABLE = (o) => `${o.app} is pointed at a table that doesn't exist. Tell the tool owner.`;
const GONE = "That row isn't in Lark any more. Refresh to see the latest.";
const TOO_MANY = "Lark is getting too many requests. Wait a moment and try again.";

/* Code → sentence. Every mapped code is listed here, so the tests can check them all. */
const BY_CODE = new Map();
const map = (codes, say) => codes.forEach((c) => BY_CODE.set(c, say));
map([20001, 20002, 20063], () => LOGIN_FAILED);
map([20003, 20004, 20065], () => CODE_EXPIRED);
map([20049], () => "The login check failed, probably because it started in another tab. Log in again here.");
map([20071], () => "Lark sent the login back to a different address. Log in again from this page.");
map([20010], () => "Your Lark account isn't allowed to use this app yet. Ask the app admin to add you.");
map([20029], (o) => `This address${o.redirect ? ` (${o.redirect})` : ""} isn't registered on the Lark app.`);
map(DEAD_TOKEN_CODES, () => "Your login has ended. Log in again.");
map([99991679], (o, j) => {
  const need = ((j.error && j.error.permission_violations) || []).map((v) => v && v.subject).filter(Boolean).join(", ");
  return `Your login is missing a permission ${o.app} needs${need ? ` (${need})` : ""}. Log out, then log in again.`;
});
// Suppliers only reads, so these say "open", not "edit".
map([91403], () => "Lark says your account can't open the procurement Base. Ask its owner to give you access.");
map([1254302], () => "Your account isn't allowed to read the procurement table (its permissions are restricted). Ask the Base owner.");
map([91402, 1254003, 1254040], NO_BASE);
map([1254004, 1254041], NO_TABLE);
map([1254045], (o, j) => `A column ${o.app} needs doesn't exist: ${j.msg || "unknown"}. Tell the tool owner.`);
map([1254006, 1254043], () => GONE);
map([1254290, 99991400], () => TOO_MANY);
map([1254291], () => "Someone else is changing this table right now. Try again in a moment.");
export const MAPPED_CODES = [...BY_CODE.keys()];

/** Turn a failure into one plain sentence: what happened, and what to do.
 *  ctx: { app, host (the Lark proxy), blocked: [hosts], redirect (this page's address), origin (this page's origin) } */
export function describe(err, ctx = {}) {
  const o = { app: "Suppliers", host: "", blocked: [], ...ctx };
  if (!err) return "Something went wrong. Try again.";
  if (err.userMessage) return err.userMessage;
  if (err.deadToken) return "Your login has ended. Log in again.";
  if (o.blocked && o.blocked.length) {
    return `Your browser is blocking ${o.blocked.join(" and ")}, probably an ad blocker or privacy extension. ` +
           "Allow that site (or pause the blocker on this page), then reload.";
  }
  if (err.outdated) return `The connection service is out of date${err.detail ? ` (${err.detail})` : ""}. Ask the admin to redeploy it.`;
  if (err.network) {
    return `${o.app} can't reach its connection service${o.host ? ` (${o.host})` : ""}. ` +
           "It may still be waking up; try again in a moment.";
  }
  const j = err.json || {};
  // The proxy's own answers (no Lark code): this page's address isn't on its allow-list, or it's too old.
  if (j.code === undefined && /origin not allowed/i.test(String(j.error || ""))) {
    return `This address${o.origin ? ` (${o.origin})` : ""} isn't allowed to use the Lark connection yet. Ask the admin to add it to the connection service.`;
  }
  if (j.code === undefined && j.error === "not found") {
    return "The connection service doesn't support logging in yet. Ask the admin to update it.";
  }
  const code = Number(j.code);
  if (BY_CODE.has(code)) return BY_CODE.get(code)(o, j);
  if (/syncTable|ConnectorSyncTable/i.test(j.msg || "")) return "This table is synced from elsewhere, and Lark won't hand it over right now. Try again in a moment.";
  if (err.raw !== undefined) return `The connection service answered with an error (HTTP ${err.status}). Try again in a moment.`;
  if (err.json) {
    const msg = j.error_description || j.msg || j.message || j.error || err.message;
    return `Lark said: ${msg}${Number.isNaN(code) ? "" : ` (code ${code})`}`;
  }
  return err.message || "Something went wrong. Try again.";
}

// ---- service versions -------------------------------------------------------------
/** True when version `a` is at least `b` (dotted numbers; anything missing counts as 0). */
export function versionAtLeast(a, b) {
  const x = String(a || "").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const y = String(b || "").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return true;
}

/** Does what a service's GET / reported fit what the page needs? def: { min, headers }.
 *  Returns "" when fine, else the reason, e.g. "v1.3.0, needs 1.4.0". A service that doesn't
 *  report a version or its CORS headers (yet) is given the benefit of the doubt. */
export function incompatible(info, def) {
  const version = String((info && info.version) || "");
  if (def.min && version && !versionAtLeast(version, def.min)) return `v${version.replace(/^v/i, "")}, needs ${def.min}`;
  const allowed = info && info.cors && Array.isArray(info.cors.allow_headers) ? info.cors.allow_headers.map((h) => String(h).toLowerCase()) : null;
  if (allowed) {
    const lacking = (def.headers || []).filter((h) => !allowed.includes(h.toLowerCase()));
    if (lacking.length) return `${version ? `v${version.replace(/^v/i, "")}, ` : ""}doesn't allow ${lacking.join(", ")}`;
  }
  return "";
}
