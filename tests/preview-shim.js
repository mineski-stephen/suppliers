/* Preview mode, for checking Suppliers' screens without a Lark login (adapted from Polaris).
   Loaded by index.html only on 127.0.0.1 / localhost with ?preview (see its <head>).

   Suppliers runs unchanged, but every call to the connection service is answered here from
   tests/fixture.json: MADE-UP records (npm run preview:fixture). Nothing is sent to Lark, and a
   badge says so on screen. The fake login lives under its own keys (mineski.preview.auth.*, see
   js/session.js), so it never replaces a real one.
   Records come back 150 at a time, a little slowly, so the loader's stages and counts show. */
(function () {
  "use strict";
  var realFetch = window.fetch.bind(window);
  var fx = null;
  var fixture = function () {
    return fx || (fx = realFetch("tests/fixture.json?v=" + Date.now()).then(function (r) { return r.json(); }));
  };
  window.MINESKI_PREVIEW = true;   // js/session.js keeps this login under mineski.preview.auth.*
  localStorage.setItem("mineski.preview.auth.user", JSON.stringify({ name: "Preview Mode", avatar: "", email: "" }));   // the name first: other tabs read it when the token's change reaches them
  localStorage.setItem("mineski.preview.auth.token", JSON.stringify({
    access_token: "preview-only", scope: "bitable:app", expires_at: Date.now() + 95 * 60000,
  }));

  var PAGE = 150;
  var reply = function (obj, ms) {
    return new Promise(function (res) {
      setTimeout(function () {
        res(new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } }));
      }, ms === undefined ? 250 : ms);
    });
  };

  window.fetch = async function (input, init) {
    var url = typeof input === "string" ? input : input.url;
    if (/(onrender\.com|workers\.dev)\/?$/.test(url) || (/:\d+\/$/.test(url) && !/127\.0\.0\.1:9125\/$/.test(url))) {
      return reply({ service: "lark-cors-proxy", version: "2.0.0" }, 120);   // what the real proxy calls itself
    }
    var m = url.match(/\/proxy\?url=([^&]+)/);
    if (!m) return realFetch(input, init);
    var target = decodeURIComponent(m[1]);
    var body = init && init.body ? JSON.parse(init.body) : {};
    var f = await fixture();
    if (/\/authen\/v1\/authorize/.test(target)) return new Response("<html>preview</html>", { status: 200 });
    if (/\/authen\/v1\/user_info/.test(target)) return reply({ code: 0, data: { name: "Preview Mode" } });
    var t = target.match(/\/tables\/(tbl[A-Za-z0-9]+)\/(fields|records)(\/[a-z_]+)?/);
    if (!t) return reply({ code: 99999, msg: "preview mode: no answer for " + target });
    if (t[2] === "fields") return reply({ code: 0, data: { items: f.fields, has_more: false, total: f.fields.length } });
    if (t[3] === "/search") {
      var names = body.field_names;
      var start = Number((target.match(/[?&]page_token=(\d+)/) || [])[1] || 0);
      var page = f.records.slice(start, start + PAGE).map(function (r) {
        var fl = {};
        for (var n in r.fields) if (!names || names.indexOf(n) >= 0) fl[n] = r.fields[n];
        return { record_id: r.record_id, fields: fl };
      });
      var more = start + PAGE < f.records.length;
      return reply({ code: 0, data: { items: page, has_more: more, page_token: more ? String(start + PAGE) : "", total: f.records.length } }, 300);
    }
    return reply({ code: 99999, msg: "preview mode: Suppliers only reads, so nothing else is answered (" + target + ")" });
  };

  document.addEventListener("DOMContentLoaded", function () {
    var b = document.createElement("div");
    b.className = "override-badge";   // the top bar's red override badge (theme tokens), pinned bottom-left
    b.textContent = "Preview mode: sample data, nothing is sent anywhere";
    b.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:200;box-shadow:var(--shadow-md);pointer-events:none";
    document.body.appendChild(b);
  });
})();
