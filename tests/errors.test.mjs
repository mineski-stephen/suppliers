/* describe(err) and the service checks (js/errors.js). Offline: node --test tests/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LarkError, describe, MAPPED_CODES, DEAD_TOKEN_CODES, isDeadToken, versionAtLeast, incompatible } from "../js/errors.js";

const lark = (code, msg = "x", extra = {}) => new LarkError("Lark error", { json: { code, msg, ...extra } });

test("every mapped Lark code has its own plain sentence (no raw code, no em dash)", () => {
  for (const code of MAPPED_CODES) {
    const s = describe(lark(code), { app: "Suppliers", redirect: "http://127.0.0.1:9125/" });
    assert.ok(s && !/Lark said/.test(s), `code ${code}: ${s}`);
    assert.ok(!/—/.test(s), `code ${code} has an em dash`);
    assert.ok(/[.!]$/.test(s), `code ${code} ends a sentence`);
  }
  for (const code of [20005, 99991661, 99991663, 99991668, 99991671, 99991677]) assert.ok(DEAD_TOKEN_CODES.includes(code));
  for (const code of [91403, 1254302, 1254004, 20029, 99991679, 1254290]) assert.ok(MAPPED_CODES.includes(code));
});

test("network facts come first", () => {
  assert.match(describe(new LarkError("x", { network: true }), { host: "proxy.example" }), /can't reach its connection service \(proxy\.example\)/);
  assert.match(describe(new LarkError("x", { network: true }), { blocked: ["proxy.example"] }), /blocking proxy\.example/);
  assert.match(describe(new LarkError("x", { outdated: true, detail: "v1.0.0, needs 1.4.0" })), /out of date \(v1\.0\.0, needs 1\.4\.0\)/);
  assert.equal(describe(new LarkError("x", { deadToken: true })), "Your login has ended. Log in again.");
  assert.match(describe(new LarkError("x", { status: 502, raw: "<html>" })), /HTTP 502/);
});

test("Suppliers only reads: permission messages say 'open', and the proxy's own answers are explained", () => {
  assert.match(describe(lark(91403)), /can't open the procurement Base/);
  assert.match(describe(lark(99991679, "", { error: { permission_violations: [{ subject: "bitable:app" }] } })), /\(bitable:app\)/);
  const origin = new LarkError("x", { status: 403, json: { error: "origin not allowed", message: "…" } });
  assert.match(describe(origin, { origin: "http://127.0.0.1:9125" }), /This address \(http:\/\/127\.0\.0\.1:9125\) isn't allowed to use the Lark connection yet/);
  assert.match(describe(new LarkError("x", { json: { error: "not found" } })), /doesn't support logging in yet/);
  assert.equal(describe(lark(123456, "odd")), "Lark said: odd (code 123456)");
  assert.equal(describe(Object.assign(new Error("x"), { userMessage: "Plain words." })), "Plain words.");
  assert.ok(isDeadToken(lark(99991677)));
  assert.ok(!isDeadToken(lark(91403)));
});

test("service versions and CORS headers", () => {
  assert.ok(versionAtLeast("1.10.0", "1.4.0"));
  assert.ok(!versionAtLeast("1.3.9", "1.4.0"));
  assert.ok(versionAtLeast("v2", "1.9.9"));
  assert.equal(incompatible({ service: "lark-cors-proxy" }, { min: "", headers: ["Authorization"] }), "");
  assert.equal(incompatible({ version: "1.0.0" }, { min: "1.2.0", headers: [] }), "v1.0.0, needs 1.2.0");
  assert.equal(incompatible({ version: "1.2.0", cors: { allow_headers: ["Content-Type"] } }, { min: "1.0.0", headers: ["Authorization"] }), "v1.2.0, doesn't allow Authorization");
});
