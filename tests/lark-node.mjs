/* Lark access for the Node live check (adapted from Polaris): an app (tenant) token from Lark
   itself, then direct HTTPS calls (CORS only applies to browsers). It gives the same
   `call(method, url, body, opts)` shape the page uses, so tables.js runs unchanged.

   Nothing goes through the connection service: the app secret stays on this computer.
   Put it in the environment, or in a file named .env in the suppliers folder (git-ignored;
   copy .env.example):

     LARK_APP_ID=cli_...        (optional: js/config.js has the app's id)
     LARK_APP_SECRET=...        (from the Lark developer console, Credentials & Basic Info) */

import { readFileSync } from "node:fs";
import { LARK } from "../js/config.js";

/* KEY=value lines -> { KEY: "value" }. Blank lines and # comments are skipped; one pair of quotes is removed. */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/* The app's credentials: the environment first, then .env. Throws a plain sentence if the secret is missing. */
export function credentials(env = process.env, file = new URL("../.env", import.meta.url)) {
  let saved = {};
  try { saved = parseEnv(readFileSync(file, "utf8")); } catch (e) { /* no .env: the environment must have it */ }
  const secret = env.LARK_APP_SECRET || saved.LARK_APP_SECRET;
  if (!secret) {
    throw new Error("LARK_APP_SECRET isn't set. Put it in the environment or in a .env file in the suppliers folder (see .env.example).");
  }
  return { appId: env.LARK_APP_ID || saved.LARK_APP_ID || LARK.appId, appSecret: secret };
}

/* A tenant token straight from Lark. */
export async function tenantToken(creds = credentials()) {
  const res = await fetch(`${LARK.api}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: creds.appId, app_secret: creds.appSecret }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.code !== 0 || !j.tenant_access_token) throw new Error(`Couldn't get a tenant token: Lark said ${j.msg || `HTTP ${res.status}`} (code ${j.code}).`);
  return j.tenant_access_token;
}

/* call(method, url, body) straight to Lark with the token; throws with .json on a Lark error. */
export function makeCall(token) {
  return async function call(method, url, body) {
    const init = { method, headers: { Authorization: `Bearer ${token}` } };
    if (method !== "GET") {
      init.headers["Content-Type"] = "application/json; charset=utf-8";
      init.body = JSON.stringify(body || {});
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}, not JSON: ${text.slice(0, 300)}`); }
    if (Number(j.code) !== 0) {
      const e = new Error(`Lark ${j.code}: ${j.msg}`);
      e.json = j;
      throw e;
    }
    return j;
  };
}
