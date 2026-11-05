/* The config and the check tools. Offline: node --test tests/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importMapFiles, findSecrets } from "../tools/check-shell.mjs";
import { parseEnv } from "./lark-node.mjs";
import { APP, SERVICES, LARK, RULES } from "../js/config.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("config: the name, key, version, Lark app and rules the standard asks for", () => {
  assert.deepEqual([APP.name, APP.key, APP.env], ["Suppliers", "suppliers", "live"]);
  assert.match(APP.version, /^\d+\.\d+\.\d+$/);
  assert.equal(LARK.appId, "cli_aab0716138b8ded3");
  assert.equal(LARK.scopes, "bitable:app");
  assert.equal(LARK.tzOffsetMinutes, 480);
  assert.equal(SERVICES.lark.service, "lark-cors-proxy");
  assert.equal(RULES.exchangeRate, 57);
  assert.deepEqual(RULES.defaultStatuses, ["Approved"]);
});

test("the shell tools read what they check", () => {
  assert.deepEqual(importMapFiles(`var files = ["js/a.js", "js/vendor/b.js"];`), ["js/a.js", "js/vendor/b.js"]);
  // (built from pieces, so this file doesn't look like it holds a secret itself)
  assert.deepEqual(findSecrets(`const app${"_"}secret = "${"abcdefgh".repeat(2)}1234";`), ["a secret assigned to a name"]);
  assert.deepEqual(findSecrets(`"debug${"K"}ey": "abc"`), ["the old page's debug password"]);
  assert.deepEqual(findSecrets("LARK_APP_SECRET=\n"), []);
  assert.deepEqual(findSecrets("nothing here"), []);
  assert.deepEqual(parseEnv("# c\nLARK_APP_ID=cli_x\nexport LARK_APP_SECRET='s'\n"), { LARK_APP_ID: "cli_x", LARK_APP_SECRET: "s" });
});

test("the page, the manifest and the dev server agree on the name, port and icon", () => {
  const html = read("index.html");
  assert.match(html, /<title>Suppliers · Mineski<\/title>/);
  assert.match(html, /img\/suppliers-icon\.svg/);
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.name, "Suppliers");
  assert.deepEqual(manifest.icons.map((i) => i.src), ["img/suppliers-icon-180.png", "img/suppliers-icon-512.png", "img/suppliers-icon.svg"]);
  assert.match(read("tools/serve.py"), /^PORT = 9125\b/m);
  const launch = JSON.parse(read(".claude/launch.json"));
  assert.equal(launch.configurations[0].port, 9125);
  const pkg = JSON.parse(read("package.json"));
  for (const s of ["serve", "test", "check:live", "check:proxy", "check:shell", "preview:fixture"]) assert.ok(pkg.scripts[s], s);
  assert.ok(!pkg.dependencies && !pkg.devDependencies, "no dependencies");
  assert.doesNotMatch(read("README.md"), /Procurement Database/);
});
