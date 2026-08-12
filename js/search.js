const Search = (() => {
    let oramaDb = null;
    let rawData = [];
    let headers = [];
    let ready = false;

    const STATUS_PRIORITY = { "approved": 0, "under review": 1, "rejected": 2, "recalled": 3 };

    const SCHEMA_FIELDS = {
        requestNo: "Request No.",
        status: "Status",
        requester: "Requester",
        project: "Project Name",
        projectCode: "Project Code",
        particular: "Particulars_Item",
        supplier: "Supplier Details_Supplier Name",
        accountName: "Supplier Details_Account Name",
        costType: "Cost Type",
        chargedTo: "Charged to",
    };

    const TAB_PROPERTIES = {
        all: undefined,
        particulars: ["particular"],
        suppliers: ["supplier", "accountName"],
        projects: ["project", "projectCode"],
    };

    const TAB_FIELD_NAMES = {
        all: null,
        particulars: ["Particulars_Item"],
        suppliers: ["Supplier Details_Supplier Name", "Supplier Details_Account Name"],
        projects: ["Project Name", "Project Code"],
    };

    // Slash-filter tokens: field:'value' (contains) or field:"value" (exact)
    const FILTER_FIELDS = {
        particular_item: "Particulars_Item",
        business_unit: "Business Unit",
        project_name: "Project Name",
        project_code: "Project Code",
        project_manager: "Project Manager",
        supplier_account_name: "Supplier Details_Account Name",
    };

    const SCHEMA = {
        requestNo: "string",
        status: "string",
        requester: "string",
        project: "string",
        projectCode: "string",
        particular: "string",
        supplier: "string",
        accountName: "string",
        costType: "string",
        chargedTo: "string",
        rowIdx: "number",
    };

    function mapRow(row, idx) {
        const out = { rowIdx: idx };
        for (const [key, col] of Object.entries(SCHEMA_FIELDS)) {
            out[key] = String(row[col] || "");
        }
        return out;
    }

    function statusPrioritySort(a, b) {
        const scoreDiff = (a.score || 0) - (b.score || 0);
        if (Math.abs(scoreDiff) > 0.05) return scoreDiff;
        const aPri = STATUS_PRIORITY[(a.item.Status || "").toLowerCase()] ?? 99;
        const bPri = STATUS_PRIORITY[(b.item.Status || "").toLowerCase()] ?? 99;
        return aPri - bPri;
    }

    async function init(data, hdrs, onProgress) {
        rawData = data;
        headers = hdrs;
        ready = false;

        const Orama = window.Orama || window.orama;
        if (!Orama) throw new Error("Orama library not loaded");

        oramaDb = await Orama.create({ schema: SCHEMA });

        const batchSize = 25;
        for (let i = 0; i < data.length; i++) {
            await Orama.insert(oramaDb, mapRow(data[i], i));
            if (i % batchSize === 0 && onProgress) onProgress(i / data.length);
        }
        if (onProgress) onProgress(1);
        ready = true;
    }

    function exactSubstring(query, tab, limit) {
        const q = query.toLowerCase();
        const fields = TAB_FIELD_NAMES[tab];
        const out = [];
        for (let i = 0; i < rawData.length && out.length < limit; i++) {
            const row = rawData[i];
            const targets = fields ? fields.map(f => row[f]) : Object.values(row);
            if (targets.some(v => typeof v === "string" && v.toLowerCase().includes(q))) {
                out.push({ item: row, score: 0 });
            }
        }
        return out.sort(statusPrioritySort);
    }

    // Strip field:'value' / field:"value" tokens out of a query string.
    // Double quotes => exact whole-value match. Single quotes => substring match.
    const FIELD_TOKEN_RE = /([a-z_]+):(['"])(.*?)\2/gi;

    function parseFieldFilters(query) {
        const fieldFilters = [];
        const rest = query.replace(FIELD_TOKEN_RE, (match, name, quote, value) => {
            const column = FILTER_FIELDS[name.toLowerCase()];
            if (!column) return match;   // unknown field → leave as plain text
            fieldFilters.push({ field: name.toLowerCase(), column, value, exact: quote === '"' });
            return " ";
        });
        return { fieldFilters, rest: rest.trim() };
    }

    function rowMatchesFieldFilters(row, fieldFilters) {
        return fieldFilters.every(f => {
            const cell = row[f.column];
            if (typeof cell !== "string") return false;
            if (f.exact) return cell.trim().toLowerCase() === f.value.trim().toLowerCase();
            return cell.toLowerCase().includes(f.value.toLowerCase());
        });
    }

    function parseQuery(query) {
        const phrases = [];
        const excludes = [];
        let q = query.replace(/-"([^"]+)"/g, (_, p) => { excludes.push(p); return ""; });
        q = q.replace(/"([^"]+)"/g, (_, p) => { phrases.push(p); return ""; });
        q = q.replace(/(?:^|\s)-(\S+)/g, (_, w) => { excludes.push(w); return ""; });
        const remainder = q.trim();
        return { phrases, excludes, remainder };
    }

    function rowContainsPhrases(row, phrases, fields) {
        const targets = fields ? fields.map(f => row[f]) : Object.values(row);
        return phrases.every(phrase => {
            const p = phrase.toLowerCase();
            return targets.some(v => typeof v === "string" && v.toLowerCase().includes(p));
        });
    }

    function rowContainsExcludes(row, excludes, fields) {
        const targets = fields ? fields.map(f => row[f]) : Object.values(row);
        return excludes.some(ex => {
            const e = ex.toLowerCase();
            return targets.some(v => typeof v === "string" && v.toLowerCase().includes(e));
        });
    }

    async function search(query, opts = {}) {
        const { tab = "all", exact = false, limit = 500 } = opts;
        if (!query.trim() || !ready) return [];

        // Pull out field:'value' tokens before anything else
        const { fieldFilters, rest } = parseFieldFilters(query);
        const hasFieldFilters = fieldFilters.length > 0;

        // Field filters with no other search text → scan rows directly
        if (hasFieldFilters && !rest) {
            const out = [];
            for (let i = 0; i < rawData.length && out.length < limit; i++) {
                if (rowMatchesFieldFilters(rawData[i], fieldFilters)) {
                    out.push({ item: rawData[i], score: 0 });
                }
            }
            return out.sort(statusPrioritySort);
        }

        // Remaining text drives the search; field filters narrow the result set
        const effectiveQuery = hasFieldFilters ? rest : query;
        const narrow = (results) => hasFieldFilters
            ? results.filter(r => rowMatchesFieldFilters(r.item, fieldFilters))
            : results;

        if (exact) return narrow(exactSubstring(effectiveQuery, tab, limit));

        const { phrases, excludes, remainder } = parseQuery(effectiveQuery);
        const fields = TAB_FIELD_NAMES[tab];

        // Only exclusions, no positive terms → all rows minus excluded
        if (!remainder && phrases.length === 0 && excludes.length > 0) {
            const out = [];
            for (let i = 0; i < rawData.length && out.length < limit; i++) {
                if (!rowContainsExcludes(rawData[i], excludes, fields) &&
                    (!hasFieldFilters || rowMatchesFieldFilters(rawData[i], fieldFilters))) {
                    out.push({ item: rawData[i], score: 0 });
                }
            }
            return out.sort(statusPrioritySort);
        }

        // Only quoted phrases (+ optional exclusions), no free text
        if (phrases.length > 0 && !remainder) {
            const out = [];
            for (let i = 0; i < rawData.length && out.length < limit; i++) {
                if (rowContainsPhrases(rawData[i], phrases, fields) &&
                    (excludes.length === 0 || !rowContainsExcludes(rawData[i], excludes, fields)) &&
                    (!hasFieldFilters || rowMatchesFieldFilters(rawData[i], fieldFilters))) {
                    out.push({ item: rawData[i], score: 0 });
                }
            }
            return out.sort(statusPrioritySort);
        }

        // Hybrid search on remainder
        const searchTerm = remainder;
        const Orama = window.Orama || window.orama;
        const properties = TAB_PROPERTIES[tab];

        const searchOpts = { term: searchTerm, limit, tolerance: 1 };
        if (properties) searchOpts.properties = properties;

        const results = await Orama.search(oramaDb, searchOpts);

        const maxScore = results.hits.reduce((m, h) => Math.max(m, h.score || 0), 1);
        let out = results.hits.map(h => ({
            item: rawData[h.document.rowIdx],
            score: 1 - ((h.score || 0) / maxScore),
        }));

        if (phrases.length > 0) {
            out = out.filter(r => rowContainsPhrases(r.item, phrases, fields));
        }
        if (excludes.length > 0) {
            out = out.filter(r => !rowContainsExcludes(r.item, excludes, fields));
        }
        out = narrow(out);

        const q = searchTerm.toLowerCase();
        const withMatch = [];
        const withoutMatch = [];
        for (const r of out) {
            const vals = Object.values(r.item);
            if (vals.some(v => typeof v === "string" && v.toLowerCase().includes(q))) {
                withMatch.push(r);
            } else {
                withoutMatch.push(r);
            }
        }
        return [...withMatch.sort(statusPrioritySort), ...withoutMatch.sort(statusPrioritySort)];
    }

    function isReady() { return ready; }
    function getAll() { return rawData; }
    function getHeaders() { return headers; }

    function getFilterFields() { return FILTER_FIELDS; }

    // Distinct values for a slash-filter field, for value autocomplete
    function getFieldValues(fieldName, prefix = "", limit = 8) {
        const column = FILTER_FIELDS[fieldName];
        if (!column) return [];
        const p = prefix.toLowerCase();
        const seen = new Set();
        for (const row of rawData) {
            const v = row[column];
            if (typeof v !== "string") continue;
            const t = v.trim();
            if (!t) continue;
            if (p && !t.toLowerCase().includes(p)) continue;
            if (!seen.has(t)) seen.add(t);
            if (seen.size >= limit) break;
        }
        return Array.from(seen);
    }

    return { init, search, isReady, getAll, getHeaders, getFilterFields, getFieldValues, parseFieldFilters };
})();
