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

        if (exact) return exactSubstring(query, tab, limit);

        const { phrases, excludes, remainder } = parseQuery(query);
        const fields = TAB_FIELD_NAMES[tab];

        // Only exclusions, no positive terms → all rows minus excluded
        if (!remainder && phrases.length === 0 && excludes.length > 0) {
            const out = [];
            for (let i = 0; i < rawData.length && out.length < limit; i++) {
                if (!rowContainsExcludes(rawData[i], excludes, fields)) {
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
                    (excludes.length === 0 || !rowContainsExcludes(rawData[i], excludes, fields))) {
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

    return { init, search, isReady, getAll, getHeaders };
})();
