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

  // The line item service (anthropic-ce, the Line Items tab): made-up lines from tests/lines-fixture.json.
  var lx = null;
  var linesFixture = function () {
    return lx || (lx = realFetch("tests/lines-fixture.json?v=" + Date.now()).then(function (r) { return r.json(); }));
  };
  var ceAnswer = async function (url) {
    var lf = await linesFixture();
    var u = new URL(url);
    if (u.pathname === "/" || u.pathname === "") {
      return reply({ service: "anthropic-ce", version: "1.2.0", cors: { allow_headers: ["Content-Type", "Authorization"] },
        lines: { available: true, built: "2026-11-12T00:00:00Z", rows: lf.rows.length, page_limit: 2000 } }, 120);
    }
    if (u.pathname === "/lines") {
      var after = Number(u.searchParams.get("after") || 0), limit = Math.min(Number(u.searchParams.get("limit") || 1000), 50);
      var page = lf.rows.slice(after, after + limit);   // rowids are 1-based positions; 50 a page here so the progress shows
      var more = after + limit < lf.rows.length;
      return reply({ columns: lf.columns, rows: page, next: more ? after + limit : null,
        dataset: { built: "2026-11-12T00:00:00Z", rows: lf.rows.length } }, 200);
    }
    return reply({ error: { code: "not_found", message: "preview mode: not answered" } }, 50);
  };

  window.fetch = async function (input, init) {
    var url = typeof input === "string" ? input : input.url;
    if (/anthropic-ce[^/]*\.workers\.dev|127\.0\.0\.1:8002/.test(url)) return ceAnswer(url);
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
    if (t[1] === "tblEmWYOXoAF70uf" && t[3] === "/search") {   // the Universe: made-up CE links for the sample lines' projects
      var lf = await linesFixture(), ci = lf.columns.indexOf("project_code"), seen = {};
      var items = lf.rows.map(function (r) { return r[ci]; }).filter(function (c) { return c && !seen[c] && (seen[c] = 1); })
        .map(function (c, i) { return { record_id: "recU" + i, fields: { "Project Code": [{ text: c, type: "text" }],
          "Internal CE (Sheet)": { link: "https://docs.google.com/spreadsheets/d/PREVIEW-SAMPLE-" + c + "/edit", text: "CE " + c } } }; });
      return reply({ code: 0, data: { items: items, has_more: false, page_token: "", total: items.length } }, 200);
    }
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
