/*
 * Lark (Bitable) live data source.
 *
 * Reads the procurement table through the Lark Open API and converts the
 * response into the same row shape the app already gets from the encrypted
 * spreadsheet, so nothing downstream has to care where the data came from.
 *
 * A CORS proxy is required: open.larksuite.com does not send
 * Access-Control-Allow-Origin, so a browser cannot call it directly. The proxy
 * also holds the app credentials, which therefore never reach the page.
 *   GET  {proxy}/token              -> { app_access_token }
 *   POST {proxy}/proxy?url=<larkUrl> -> relays to Lark with our Bearer token
 */
const Lark = (() => {
    const TOKEN_PATH = "/token";
    const PROXY_PATH = "/proxy?url=";
    const LARK_HOST = "https://open.larksuite.com";

    const PAGE_SIZE = 500;      // Lark's documented maximum
    const MAX_PAGES = 200;      // runaway guard (~100k records); never silent
    const PAGE_DELAY_MS = 120;  // stay clear of Lark's rate limits

    // Records carry epoch milliseconds; the historical spreadsheet stored
    // Asia/Manila wall-clock time. Verified against the existing database:
    // every date field (including the date-only payment date, which lands
    // exactly on midnight) matches at UTC+8.
    const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

    // Column order mirrors the spreadsheet the app was built against.
    // "Esports Business Unit" has no counterpart in the Lark table; it is kept
    // as an empty column so the detail pane's field list stays intact.
    const COLUMNS = [
        "Request No.",
        "Status",
        "Approval process",
        "Submitted at",
        "Completed at",
        "Requester",
        "Initiator department",
        "Current assignee",
        "Approval steps",
        "Cost Type",
        "Business Unit",
        "Project Name",
        "Project Code",
        "Project Manager",
        "Associated Procurement Request",
        "Talents required",
        "Charged to",
        "Are Particulars overbudget?",
        "Particulars_Item",
        "Particulars_Quantity",
        "Particulars_Unit Price",
        "Particulars_Unit Price-Currency",
        "Particulars_Price",
        "Particulars_Attachment",
        "Supplier Details_Form of Payment",
        "Supplier Details_Account Name",
        "Supplier Details_Account Number",
        "Supplier Details_Bank Name",
        "Supplier Details_Business/Home Address",
        "Supplier Details_Payment Date",
        "Supplier Details_Terms",
        "Supplier Details_Attachment",
        "SourceID",
        "Supplier Details_Supplier Name",
        "Esports Business Unit",
        "Budget/Terms",
        "Requester1",
    ];

    // Fields Lark returns as { link, text } — each also yields a "<name>_URL"
    // column, matching how the spreadsheet converter split HYPERLINK formulas.
    const LINK_COLUMNS = new Set([
        "Request No.",
        "Particulars_Attachment",
        "Supplier Details_Attachment",
    ]);

    // Epoch-millisecond fields
    const DATE_COLUMNS = new Set([
        "Submitted at",
        "Completed at",
        "Supplier Details_Payment Date",
    ]);

    function pad(n) { return n < 10 ? "0" + n : String(n); }

    // "YYYY-MM-DD HH:MM:SS" at UTC+8. Built from UTC getters on a shifted
    // timestamp so the result does not depend on the viewer's own time zone.
    function formatDate(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return "";
        const d = new Date(n + TZ_OFFSET_MS);
        return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate())
            + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
    }

    // Flatten one Lark field value to the plain string the app expects.
    // Lark shapes seen in this table: string, number, [{type:"text",text}],
    // ["plain"], [{name,en_name,email,…}] (person), {link,text} (url).
    function cellText(v) {
        if (v == null) return "";
        if (typeof v === "string") return v;
        if (typeof v === "number" || typeof v === "boolean") return String(v);
        if (Array.isArray(v)) {
            return v.map(e => {
                if (e == null) return "";
                if (typeof e === "string" || typeof e === "number") return String(e);
                if (typeof e !== "object") return "";
                // text cell / person cell / anything with a usable label
                return e.text || e.name || e.en_name || e.email || "";
            }).filter(Boolean).join(", ");
        }
        if (typeof v === "object") return v.text || v.name || "";
        return "";
    }

    // Lark record -> one row keyed exactly like the spreadsheet's columns.
    function recordToRow(fields) {
        const row = {};
        for (const col of COLUMNS) {
            const raw = fields[col];
            if (LINK_COLUMNS.has(col)) {
                const isObj = raw && typeof raw === "object" && !Array.isArray(raw);
                row[col] = isObj ? (raw.text || "") : cellText(raw);
                row[col + "_URL"] = isObj ? (raw.link || "") : "";
            } else if (DATE_COLUMNS.has(col)) {
                row[col] = formatDate(raw);
            } else {
                row[col] = cellText(raw);
            }
        }
        return row;
    }

    // Header list with the "_URL" companions inserted after their parent,
    // matching the order the spreadsheet converter produced.
    function buildHeaders() {
        const out = [];
        for (const col of COLUMNS) {
            out.push(col);
            if (LINK_COLUMNS.has(col)) out.push(col + "_URL");
        }
        return out;
    }

    // Shaped like PapaParse output so it can flow through the app's existing
    // data path unchanged.
    function toParseResult(items) {
        return {
            data: items.map(it => recordToRow(it.fields || {})),
            meta: { fields: buildHeaders() },
        };
    }

    function proxyBase(config) {
        const base = (config && config.larkProxy) || "";
        return base.replace(/\/+$/, "");
    }

    function isConfigured(config) {
        return !!(config && config.larkProxy && config.larkAppToken && config.larkTableId);
    }

    async function getToken(config) {
        const resp = await fetch(proxyBase(config) + TOKEN_PATH);
        const json = await resp.json().catch(() => null);
        if (!json) throw new Error("Token endpoint did not return JSON");
        // Lark reports failures in the body, so the HTTP status alone is not enough.
        if (json.code !== 0 || !json.app_access_token) {
            throw new Error("Token request failed: " + (json.msg || "code " + json.code));
        }
        return json.app_access_token;
    }

    function searchUrl(config, pageToken) {
        let url = LARK_HOST + "/open-apis/bitable/v1/apps/" + config.larkAppToken
            + "/tables/" + config.larkTableId + "/records/search?page_size=" + PAGE_SIZE;
        if (pageToken) url += "&page_token=" + encodeURIComponent(pageToken);
        return url;
    }

    /*
     * Pull every record by following Lark's cursor.
     *
     * The request count is deliberately not derived from data.total: that would
     * need an extra round trip and total can change mid-run, so a fixed count
     * could silently drop late arrivals. has_more is authoritative.
     *
     * onProgress({ page, records, total }) is called after each page.
     * Resolves { result, meta } where meta records how the run ended, so a
     * short read is reported rather than passed off as complete.
     */
    async function fetchAll(config, onProgress) {
        if (!isConfigured(config)) throw new Error("Lark is not configured");

        const token = await getToken(config);
        const base = proxyBase(config);
        const items = [];
        let pageToken = "", pages = 0, total = null, hasMore = true, stoppedEarly = null;

        while (hasMore && pages < MAX_PAGES) {
            const target = searchUrl(config, pageToken);
            const resp = await fetch(base + PROXY_PATH + encodeURIComponent(target), {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
                body: "{}",
            });

            const text = await resp.text();
            let json = null;
            try { json = JSON.parse(text); } catch { /* handled below */ }

            if (!json) {
                if (pages === 0) throw new Error("Lark response was not JSON (HTTP " + resp.status + ")");
                stoppedEarly = "a response was not JSON";
                break;
            }
            if (json.code !== 0) {
                const detail = "Lark error " + json.code + (json.msg ? " (" + json.msg + ")" : "");
                if (pages === 0) throw new Error(detail);
                stoppedEarly = detail + " on page " + (pages + 1);
                break;
            }

            const d = json.data || {};
            if (Array.isArray(d.items)) items.push(...d.items);
            if (typeof d.total === "number") total = d.total;
            hasMore = !!d.has_more;
            pageToken = d.page_token || "";
            pages++;

            if (onProgress) onProgress({ page: pages, records: items.length, total });

            if (hasMore && !pageToken) {
                stoppedEarly = "has_more was set but no page_token was returned";
                break;
            }
            if (hasMore) await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
        }

        if (hasMore && !stoppedEarly && pages >= MAX_PAGES) {
            stoppedEarly = "hit the " + MAX_PAGES + "-page safety cap";
        }

        const meta = {
            pages,
            records: items.length,
            totalReported: total,
            complete: !hasMore && !stoppedEarly,
            stoppedEarly,
        };
        // A completed run whose count differs from Lark's total usually means the
        // table was edited while paging. Surface it instead of hiding it.
        if (meta.complete && total !== null && items.length !== total) {
            meta.countMismatch = "collected " + items.length + " of " + total + " reported";
        }

        return { result: toParseResult(items), meta };
    }

    return { fetchAll, toParseResult, isConfigured, COLUMNS, formatDate, cellText };
})();
