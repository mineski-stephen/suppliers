/* Asks the connection service (the shared Lark proxy) who it is: npm run check:proxy
     GET /       its name and version ("no version yet" until the proxy reports one)
     OPTIONS     whether a page may send an Authorization header to it
     endpoints   fails while it still lists a public /token (anyone could get an app token)
   Run it before publishing a page that raises SERVICES.lark.min in js/config.js.
   Read-only: it sends no token and changes nothing. A sleeping Render service is given up to
   3 minutes to wake. Add --url <address> to check another one (a local proxy).
   (Adapted from Polaris's tools/check-proxy.mjs, with Fetch's /token check.) */

import { pathToFileURL } from "node:url";
import { SERVICES } from "../js/config.js";
import { incompatible } from "../js/errors.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* GET / until the service answers JSON, or the time is up. Resolves { res, info } or null. */
async function ask(base, { budgetMs = 180000, say = console.log } = {}) {
  const until = Date.now() + budgetMs;
  let wait = 2000;
  for (;;) {
    try {
      const res = await fetch(`${base}/`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      const info = await res.json().catch(() => null);
      if (res.ok && info) return { res, info };
      say(`  … answered HTTP ${res.status}${info ? "" : " (not JSON)"}, waiting`);
    } catch (e) {
      say(`  … no answer yet (${e.name === "TimeoutError" ? "timed out" : e.message})`);
    }
    if (Date.now() > until) return null;
    await sleep(wait);
    wait = Math.min(wait * 1.6, 15000);
  }
}

export async function checkProxy(base, expect = SERVICES.lark, say = console.log) {
  base = base.replace(/\/+$/, "");
  say(`Connection service: ${base}`);
  const got = await ask(base, { say });
  if (!got) { say("  ✗ no answer for 3 minutes"); return 1; }
  if (got.info.service !== expect.service) { say(`  ✗ that isn't the ${expect.service} (it says "${got.info.service}")`); return 1; }
  const v = String(got.info.version || "");
  say(`  ✓ ${expect.service}, ${v ? `version ${v}` : "no version yet"}${got.info.commit ? `, commit ${got.info.commit}` : ""}`);
  let failures = 0;
  const problem = incompatible(got.info, expect);
  if (problem) { say(`  ✗ out of date (${problem}). Ask the admin to redeploy it.`); failures++; }
  else if (expect.min && v) say(`  ✓ at least ${expect.min}`);
  if (got.info.endpoints && /\/token\b/.test(JSON.stringify(got.info.endpoints))) {
    say("  ✗ it still lists a public /token endpoint (anyone who can reach it can get an app token). Ask the admin to remove it.");
    failures++;
  }
  if (got.info.origin_restricted === false || got.info.origin_restricted === undefined) {
    say("  · it doesn't say it checks which web pages use it (ALLOWED_ORIGINS)");
  } else say("  ✓ only the allowed web pages may use it (ALLOWED_ORIGINS is set)");
  try {
    const pre = await fetch(`${base}/proxy?url=${encodeURIComponent("https://open.larksuite.com/open-apis/authen/v1/user_info")}`, {
      method: "OPTIONS", headers: { Origin: "http://127.0.0.1:9125", "Access-Control-Request-Method": "GET",
                                    "Access-Control-Request-Headers": expect.headers.join(",").toLowerCase() },
      signal: AbortSignal.timeout(20000),
    });
    const allowed = (pre.headers.get("access-control-allow-headers") || "").toLowerCase();
    const lacking = expect.headers.filter((h) => allowed !== "*" && !allowed.includes(h.toLowerCase()));
    if (lacking.length) { say(`  ✗ a page can't send ${lacking.join(", ")} to it (allowed: ${allowed || "none listed"})`); failures++; }
    else say(`  ✓ ${expect.headers.join(", ")} allowed for pages`);
  } catch (e) {
    say(`  · couldn't check the preflight (${e.message})`);
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--url");
  const bases = i >= 0 && process.argv[i + 1] ? [process.argv[i + 1]] : SERVICES.lark.urls;   // every address, in order
  let failures = 0;
  for (const base of bases) failures += await checkProxy(base);
  console.log(failures ? "\nThe connection service needs attention." : "\nThe connection service looks fine ✓");
  process.exitCode = failures ? 1 : 0;
}
