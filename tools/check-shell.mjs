/* Checks the page's shell, offline: npm run check:shell   (adapted from Polaris's tools/check-shell.mjs)
     1. index.html's import map lists every js/**.js (and nothing that isn't there), and every
        import inside js/ points at a listed module
     2. the shared files are byte-identical to the design language's: js/ui.js, js/icons.js,
        css/mineski-base.css, css/theme.css (= themes/suppliers.css), and tools/serve.py (apart from PORT)
     3. the page: boot watchdog, main#main, the referrer and CSP metas, and a CSP that lets the page
        talk only to itself, the connection service and this computer
     4. APP.version matches the newest CHANGELOG.md entry, and the top bar shows it (#appVersion)
     5. node --check passes on every module, tool and test
     6. no secret-shaped string in any file that would be published, no em dash in the page, its
        scripts, styles or docs, and no data files (.enc, .xlsx, .csv) in the folder
   Exits 1 if anything fails. */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, relative, sep, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const posix = (p) => p.split(sep).join("/");

/* The module list in index.html's loader script: var files = ["js/a.js", …]. */
export function importMapFiles(html) {
  const m = html.match(/var files = \[([\s\S]*?)\]/);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
}

/* Secret-shaped strings: what an API key, an app secret or a Lark token looks like. */
const SECRETS = [
  [/AIza[0-9A-Za-z_-]{35}/, "a Google API key (AIza…)"],
  [/\b(?:app_secret|client_secret|api[_-]?key|secret)["']?\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i, "a secret assigned to a name"],
  [/\bLARK_APP_SECRET[ \t]*=[ \t]*[^\s#"']{8,}/, "LARK_APP_SECRET with a value"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\bsk-[A-Za-z0-9]{20,}/, "an API key (sk-…)"],
  [/\b[ut]-[A-Za-z0-9_-]{36,}/, "a Lark access token (u-… or t-…)"],
  [/"debugKey"\s*:\s*"[^"]+"/, "the old page's debug password"],
];
export function findSecrets(text) {
  return SECRETS.filter(([re]) => re.test(text)).map(([, what]) => what);
}

const md5 = (file) => createHash("md5").update(readFileSync(file)).digest("hex");
const walk = (dir, skip) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  if (skip(p, name)) return [];
  return statSync(p).isDirectory() ? walk(p, skip) : [p];
});
const SKIP_DIRS = [".git", "node_modules", ".claude", "__pycache__"];

/* Where the design language is: next to the tool in the workspace, or the copy under .claude/skills. */
function skillDir() {
  const candidates = [process.env.DESIGN_REF,
    join(ROOT, "..", "design-ref", "mineski-design-language"),
    join(ROOT, ".claude", "skills", "mineski-design-language")].filter(Boolean);
  return candidates.find((d) => existsSync(join(d, "assets", "ui.js")));
}

function run() {
  let failures = 0;
  const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; return cond; };
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const mods = walk(join(ROOT, "js"), (p, n) => SKIP_DIRS.includes(n)).filter((f) => f.endsWith(".js")).map((f) => posix(relative(ROOT, f))).sort();

  console.log("Import map");
  const listed = importMapFiles(html);
  const unlisted = mods.filter((f) => !listed.includes(f)), ghosts = listed.filter((f) => !mods.includes(f));
  ok(!unlisted.length, unlisted.length ? `not in the import map: ${unlisted.join(", ")}` : `all ${mods.length} modules are listed`);
  ok(!ghosts.length, ghosts.length ? `listed but missing: ${ghosts.join(", ")}` : "nothing listed that isn't there");
  const stray = [];
  for (const f of mods) {
    for (const m of readFileSync(join(ROOT, f), "utf8").matchAll(/(?:from|import)\s*["'](\.\.?\/[\w\-./]+\.js)["']/g)) {
      const target = posix(relative(ROOT, resolve(dirname(join(ROOT, f)), m[1])));
      if (!listed.includes(target)) stray.push(`${f} → ${m[1]}`);
    }
  }
  ok(!stray.length, stray.length ? `imports of unlisted modules: ${stray.join(", ")}` : "every import points at a listed module");

  console.log("Shared files");
  const skill = skillDir();
  if (ok(!!skill, "design language found")) {
    for (const [mine, theirs] of [["js/ui.js", "assets/ui.js"], ["js/icons.js", "assets/icons.js"], ["css/mineski-base.css", "assets/mineski-base.css"],
                                  ["css/theme.css", "assets/themes/suppliers.css"]]) {
      ok(existsSync(join(skill, theirs)) && md5(join(ROOT, mine)) === md5(join(skill, theirs)), `${mine} is identical to the design language's ${theirs}`);
    }
    const noPort = (t) => t.replace(/\r\n/g, "\n").replace(/^PORT = .*$/m, "PORT = …");
    const mineServe = readFileSync(join(ROOT, "tools", "serve.py"), "utf8");
    ok(noPort(mineServe) === noPort(readFileSync(join(skill, "tools", "serve.py"), "utf8")), "tools/serve.py is the design language's, with only PORT changed");
    ok(/^PORT = 9125\b/m.test(mineServe), "tools/serve.py serves Suppliers' registered port, 9125");
  }

  console.log("Page");
  ok(/setTimeout\(function \(\) \{\s*if \(document\.documentElement\.hasAttribute\("data-booted"\)\)/.test(html) && /couldn\\u2019t start|couldn’t start|couldn't start/.test(html), "boot watchdog is in index.html");
  ok(/dataset\.booted\s*=/.test(readFileSync(join(ROOT, "js", "app.js"), "utf8")), "app.js tells the watchdog it started");
  ok(/<main[^>]*\bid="main"/.test(html), "main#main");
  ok(/<meta name="referrer" content="strict-origin-when-cross-origin">/.test(html), "referrer meta");
  const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
  if (ok(!!csp, "CSP meta")) {
    const connect = ((csp.match(/connect-src ([^;]+)/) || [])[1] || "").trim().split(/\s+/);
    const config = readFileSync(join(ROOT, "js", "config.js"), "utf8");
    const proxy = (config.match(/lark:\s*\{\s*url:\s*"([^"]+)"/) || [])[1] || "";
    ok(/default-src 'self'/.test(csp), "CSP default-src is 'self'");
    ok(connect.every((s) => s === "'self'" || s === proxy || s === "http://127.0.0.1:*"),
       `connect-src lists only 'self', ${proxy || "the proxy"} and http://127.0.0.1:* (has: ${connect.join(" ")})`);
    ok(!/cdn\.|jsdelivr|unpkg/.test(csp) && !/<script[^>]+src="https?:/.test(html), "no script from a CDN");
  }
  ok(/<title>Suppliers · Mineski<\/title>/.test(html), "the title is “Suppliers · Mineski”");

  console.log("Version");
  const version = (readFileSync(join(ROOT, "js", "config.js"), "utf8").match(/\bversion:\s*"(\d+\.\d+\.\d+)"/) || [])[1];
  const logged = existsSync(join(ROOT, "CHANGELOG.md")) && (readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").match(/^## (\d+\.\d+\.\d+)/m) || [])[1];
  if (ok(!!version, version ? `APP.version is ${version}` : "APP.version (x.y.z) is in js/config.js")) {
    ok(logged === version, logged ? (logged === version ? "CHANGELOG.md's newest entry matches it" : `CHANGELOG.md's newest entry is ${logged}, not ${version}`)
                                  : "CHANGELOG.md has a \"## x.y.z\" entry");
  }
  ok(/id="appVersion"/.test(html), "the top bar shows the version (#appVersion)");

  console.log("Syntax");
  const tools = readdirSync(join(ROOT, "tools")).filter((f) => f.endsWith(".mjs")).map((f) => `tools/${f}`);
  const tests = readdirSync(join(ROOT, "tests")).filter((f) => /\.(m?js)$/.test(f)).map((f) => `tests/${f}`);
  let bad = 0;
  for (const f of [...mods, ...tools, ...tests]) {
    // stdio "inherit": a syntax error prints straight to the terminal
    const r = spawnSync(process.execPath, ["--check", join(ROOT, f)], { stdio: "inherit" });
    if (r.status !== 0) { bad++; ok(false, `${f} has a syntax error`); }
  }
  if (!bad) ok(true, `node --check passes on ${mods.length + tools.length + tests.length} files`);

  console.log("Secrets, copy and data");
  const skip = (p, name) => SKIP_DIRS.includes(name) || (/^\.env(\.|$)/.test(name) && name !== ".env.example");
  const files = walk(ROOT, skip);
  const text = files.filter((p) => /\.(js|mjs|css|html|md|json|py|webmanifest|svg|yml|yaml|txt|example)$/.test(p));
  let found = 0;
  for (const p of text) {
    const hits = findSecrets(readFileSync(p, "utf8"));
    if (hits.length) { found++; ok(false, `${posix(relative(ROOT, p))} looks like it holds ${hits.join(", ")}`); }
  }
  if (!found) ok(true, `no secrets in ${text.length} files`);
  const own = [...mods.filter((f) => !/^js\/(ui|icons)\.js$|^js\/vendor\//.test(f)), "index.html", "css/app.css", "README.md", "CHANGELOG.md", "manifest.webmanifest"];
  const dashed = own.filter((f) => existsSync(join(ROOT, f)) && /—/.test(readFileSync(join(ROOT, f), "utf8")));
  ok(!dashed.length, dashed.length ? `an em dash in ${dashed.join(", ")} (house voice: a hyphen, a colon or a new sentence)` : "no em dash in the page, its scripts, styles or docs");
  const data = files.filter((p) => /\.(enc|xlsx|xlsm|xls|csv|pem|key)$/i.test(p)).map((p) => posix(relative(ROOT, p)));
  ok(!data.length, data.length ? `data or key files in the folder (never publish these): ${data.join(", ")}` : "no data files (.enc, .xlsx, .csv) or keys in the folder");
  const fixture = join(ROOT, "tests", "fixture.json");
  ok(!existsSync(fixture) || /Made-up sample data/.test(readFileSync(fixture, "utf8").slice(0, 300)), "tests/fixture.json is the made-up sample (npm run preview:fixture)");

  console.log(failures ? `\n${failures} problem(s) found.` : "\nThe shell checks out ✓");
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = run() ? 1 : 0;
