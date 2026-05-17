const App = (() => {
    let config = {};
    let currentPassword = "";
    let db = [];
    let headers = [];
    let selectedIndex = -1;
    let searchTimeout = null;
    let detailTimeout = null;
    let activeTab = "all";
    let exactMatch = false;

    const REQUIRED_COLUMNS = ["Request No.", "Status", "Particulars_Item", "Supplier Details_Supplier Name", "Project Name"];

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    async function loadConfig() {
        const resp = await fetch("config.json");
        config = await resp.json();
        document.title = config.appName || "Procurement Database";
        $("#app-title").textContent = config.appName || "Procurement Database";
    }

    function getDebugPassword() {
        if (config.debugKey) {
            try { return atob(config.debugKey); } catch { return ""; }
        }
        return "";
    }

    // --- Modal ---
    function showModal(opts = {}) {
        const modal = $("#password-modal");
        const overlay = $("#modal-overlay");
        const errEl = $("#modal-error");
        const infoEl = $("#modal-info");
        const passInput = $("#modal-password");
        const submitBtn = $("#modal-submit");
        const spinner = $("#modal-spinner");
        const progEl = $("#modal-progress");

        errEl.textContent = opts.error || "";
        errEl.style.display = opts.error ? "block" : "none";
        infoEl.textContent = opts.info || "";
        infoEl.style.display = opts.info ? "block" : "none";
        passInput.value = opts.prefill || "";
        submitBtn.disabled = false;
        spinner.style.display = "none";

        const showProgress = opts.progress !== undefined;
        progEl.classList.toggle("visible", showProgress);
        if (showProgress) updateProgress(opts.progress);

        if (opts.hideInput || showProgress) {
            passInput.style.display = "none";
            submitBtn.style.display = "none";
        } else {
            passInput.style.display = "";
            submitBtn.style.display = "";
        }

        modal.classList.add("visible");
        overlay.classList.add("visible");

        if (showProgress) return Promise.resolve();

        return new Promise((resolve) => {
            const handler = (e) => {
                e.preventDefault();
                submitBtn.disabled = true;
                spinner.style.display = "inline-block";
                submitBtn.removeEventListener("click", handler);
                passInput.removeEventListener("keydown", keyHandler);
                resolve(passInput.value);
            };
            const keyHandler = (e) => {
                if (e.key === "Enter") handler(e);
            };
            submitBtn.addEventListener("click", handler);
            passInput.addEventListener("keydown", keyHandler);
            if (!opts.hideInput) passInput.focus();
            if (opts.autoSubmit && opts.prefill) {
                setTimeout(() => handler(new Event("click")), 300);
            }
        });
    }

    function updateProgress(p) {
        const pct = Math.max(0, Math.min(100, Math.round((p || 0) * 100)));
        $("#modal-progress-bar").style.width = pct + "%";
        $("#modal-progress-label").textContent = pct + "%";
    }

    function hideModal() {
        $("#password-modal").classList.remove("visible");
        $("#modal-overlay").classList.remove("visible");
    }

    function showEncryptOffer() {
        const modal = $("#encrypt-offer-modal");
        const overlay = $("#modal-overlay");
        modal.classList.add("visible");
        overlay.classList.add("visible");

        return new Promise((resolve) => {
            $("#encrypt-offer-yes").onclick = () => {
                modal.classList.remove("visible");
                overlay.classList.remove("visible");
                resolve(true);
            };
            $("#encrypt-offer-no").onclick = () => {
                modal.classList.remove("visible");
                overlay.classList.remove("visible");
                resolve(false);
            };
        });
    }

    // --- Database Loading ---
    async function fetchDatabase(filename) {
        const resp = await fetch("data/" + filename);
        if (!resp.ok) throw new Error("NOT_FOUND");
        return resp.arrayBuffer();
    }

    function parseCSV(csvText) {
        const results = Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: false,
        });
        return results;
    }

    function parseXLSXBuffer(buffer) {
        const wb = XLSX.read(buffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const csv = XLSX.utils.sheet_to_csv(ws);
        return parseCSV(csv);
    }

    function isCSVContent(text) {
        const firstLine = text.split("\n")[0];
        return firstLine.includes(",") && firstLine.includes("Request No.");
    }

    async function loadEncrypted(buffer, password) {
        const decrypted = await Crypto.decrypt(buffer, password);
        if (isCSVContent(decrypted)) {
            return parseCSV(decrypted);
        }
        const enc = new TextEncoder();
        return parseXLSXBuffer(enc.encode(decrypted));
    }

    async function loadUnencrypted(buffer, filename) {
        if (filename.endsWith(".csv")) {
            const text = new TextDecoder().decode(buffer);
            return parseCSV(text);
        }
        return parseXLSXBuffer(new Uint8Array(buffer));
    }

    async function initDatabase() {
        const dbFile = config.database;
        if (!dbFile) {
            showModal({ error: "No database configured in config.json.", hideInput: true });
            return;
        }

        const isEncrypted = dbFile.endsWith(".enc");
        let buffer;

        try {
            buffer = await fetchDatabase(dbFile);
        } catch (e) {
            showModal({ error: "Database file not found: " + dbFile, hideInput: true });
            return;
        }

        if (isEncrypted) {
            const debugPass = getDebugPassword();
            let attempts = 0;
            while (attempts < 3) {
                const pass = await showModal({
                    error: attempts > 0 ? "Incorrect password. Please try again." : "",
                    info: attempts === 0 ? "Enter the password to decrypt the database." : "",
                    prefill: (attempts === 0 && debugPass) ? debugPass : "",
                    autoSubmit: (attempts === 0 && !!debugPass),
                });
                try {
                    const result = await loadEncrypted(buffer, pass);
                    currentPassword = pass;
                    hideModal();
                    await onDataLoaded(result);
                    return;
                } catch {
                    attempts++;
                }
            }
            showModal({ error: "Too many failed attempts.", hideInput: true });
        } else {
            const result = await loadUnencrypted(buffer, dbFile);
            await onDataLoaded(result);
        }
    }

    function downloadBlob(blob, filename) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    async function onDataLoaded(result) {
        headers = result.meta.fields;
        const missing = REQUIRED_COLUMNS.filter(c => !headers.includes(c));
        if (missing.length > 0) {
            showModal({ error: "Invalid database format. Missing columns: " + missing.join(", "), hideInput: true });
            return;
        }
        db = result.data.filter(row => {
            return Object.values(row).some(v => v && v.trim && v.trim() !== "");
        });

        showModal({ info: "Building search index (downloading embedding model on first load)...", progress: 0 });
        try {
            await Search.init(db, headers, (p) => updateProgress(p));
            hideModal();
        } catch (e) {
            console.error("Search index build failed:", e);
            showModal({ error: "Failed to build search index: " + e.message, hideInput: true });
            return;
        }

        $("#main-content").classList.add("loaded");
        $("#search-input").focus();
        updateStats();
    }

    function updateStats() {
        const uniqueSuppliers = new Set(db.map(r => r["Supplier Details_Supplier Name"] || r["Supplier Details_Account Name"]).filter(Boolean));
        $("#stat-records").textContent = db.length.toLocaleString();
        $("#stat-suppliers").textContent = uniqueSuppliers.size.toLocaleString();

        let latest = null;
        for (const row of db) {
            for (const col of ["Submitted at", "Completed at"]) {
                const val = row[col];
                if (!val) continue;
                const d = new Date(val);
                if (!isNaN(d.getTime()) && (!latest || d > latest)) latest = d;
            }
        }
        if (latest) {
            const section = $("#settings-db-section");
            section.style.display = "";
            $("#settings-db-date").textContent = "Last updated: " + latest.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
        }
    }

    // --- Search UI ---
    function onSearchInput() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const query = $("#search-input").value.trim();
            if (!query) {
                clearResults();
                return;
            }
            performSearch(query);
        }, 200);
    }

    async function performSearch(query) {
        const tabs = ["all", "particulars", "suppliers", "projects"];
        const allResults = await Promise.all(
            tabs.map(tab => Search.search(query, { tab, exact: exactMatch, limit: 500 }))
        );
        const activeIdx = tabs.indexOf(activeTab);
        renderResults(allResults[activeIdx], query);

        tabs.forEach((tab, i) => {
            const badge = $(`.search-tab[data-tab="${tab}"] .tab-badge`);
            if (!badge) return;
            const count = allResults[i].length;
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = "";
            } else {
                badge.style.display = "none";
            }
        });
    }

    function clearResults() {
        $("#results-list").innerHTML = "";
        $("#results-count").textContent = "";
        closeDetail();
        $("#main-content").classList.remove("has-results");
        selectedIndex = -1;
        $$(".tab-badge").forEach(b => b.style.display = "none");
    }

    function renderResults(results, query) {
        const list = $("#results-list");
        list.innerHTML = "";
        selectedIndex = -1;
        closeDetail();

        if (results.length === 0) {
            list.innerHTML = '<div class="no-results">No results found. Try a different search term.</div>';
            $("#results-count").textContent = "0 results";
            return;
        }

        $("#results-count").textContent = `${results.length} result${results.length !== 1 ? "s" : ""}`;
        $("#main-content").classList.add("has-results");

        const fragment = document.createDocumentFragment();
        results.forEach((r, idx) => {
            const item = r.item;
            const card = document.createElement("div");
            card.className = "result-card" + (r.isRelated ? " related" : "");
            card.dataset.index = idx;

            const reqNo = item["Request No."] || "N/A";
            const particular = item["Particulars_Item"] || "N/A";
            const supplier = item["Supplier Details_Supplier Name"] || item["Supplier Details_Account Name"] || "N/A";
            const project = item["Project Name"] || "";
            const price = item["Particulars_Price"] || "";
            const currency = item["Particulars_Unit Price-Currency"] || "PHP";
            const status = item["Status"] || "";
            const date = item["Submitted at"] || "";

            const qty = item["Particulars_Quantity"] || "";
            const unitPrice = item["Particulars_Unit Price"] || "";
            const unitPriceFormatted = unitPrice ? Number(unitPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
            const priceFormatted = price ? Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
            const dateFormatted = date ? date.split(" ")[0] : "";

            card.innerHTML = `
                <div class="result-header">
                    <span class="result-reqno">${esc(reqNo)}</span>
                    <span class="result-status status-${status.toLowerCase().replace(/\s+/g, "-")}">${esc(status)}</span>
                </div>
                <div class="result-particular">${highlight(particular, query)}</div>
                <div class="result-meta">
                    <span class="result-supplier" title="Supplier">${highlight(supplier, query)}</span>
                    ${(unitPriceFormatted || priceFormatted) ? `<div class="result-pricing">
                        ${unitPriceFormatted ? `<div class="result-unit-price">${esc(qty || "1")} x ${esc(currency)} ${unitPriceFormatted}</div>` : ""}
                        ${priceFormatted ? `<div class="result-total-price">${unitPriceFormatted ? "Total " : ""}${esc(currency)} ${priceFormatted}</div>` : ""}
                    </div>` : ""}
                </div>
                <div class="result-footer">
                    ${project ? `<span class="result-project">${highlight(project, query)}</span>` : ""}
                    ${dateFormatted ? `<span class="result-date">${esc(dateFormatted)}</span>` : ""}
                    ${r.isRelated ? '<span class="result-related-tag">Related</span>' : ""}
                </div>
            `;

            card.style.animationDelay = `${Math.min(idx, 15) * 40}ms`;
            card.addEventListener("click", () => openDetail(r, idx));
            fragment.appendChild(card);
        });
        list.appendChild(fragment);
    }

    function esc(str) {
        const d = document.createElement("div");
        d.textContent = str;
        return d.innerHTML;
    }

    function highlight(text, query) {
        if (!query) return esc(text);
        const escaped = esc(text);
        const terms = [];
        const quotedRe = /"([^"]+)"/g;
        let m;
        while ((m = quotedRe.exec(query)) !== null) terms.push(m[1]);
        const remainder = query.replace(/"[^"]*"/g, "").trim();
        if (remainder) remainder.split(/\s+/).filter(Boolean).forEach(w => terms.push(w));
        if (!terms.length) return escaped;
        let result = escaped;
        for (const term of terms) {
            const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
            result = result.replace(re, "<mark>$1</mark>");
        }
        return result;
    }

    // --- Detail View ---
    function buildDetailHtml(item) {
        const DISPLAY_GROUPS = [
            {
                title: "Particulars",
                fields: ["Particulars_Item", "Particulars_Quantity", "Particulars_Unit Price",
                         "Particulars_Unit Price-Currency", "Particulars_Price", "Particulars_Attachment"]
            },
            {
                title: "Project Details",
                fields: ["Cost Type", "Business Unit", "Project Name", "Project Code",
                         "Project Manager", "Esports Business Unit", "Budget/Terms",
                         "Associated Procurement Request", "Talents required", "Charged to",
                         "Are Particulars overbudget?"]
            },
            {
                title: "Request Information",
                fields: ["Request No.", "Approval process", "Submitted at", "Completed at",
                         "Requester", "Initiator department", "Current assignee"]
            },
            {
                title: "Supplier Details",
                fields: ["Supplier Details_Supplier Name", "Supplier Details_Form of Payment",
                         "Supplier Details_Account Name", "Supplier Details_Account Number",
                         "Supplier Details_Bank Name", "Supplier Details_Business/Home Address",
                         "Supplier Details_Payment Date", "Supplier Details_Terms",
                         "Supplier Details_Attachment"]
            }
        ];

        const URL_FIELDS = {
            "Request No.": "Request No._URL",
            "Particulars_Attachment": "Particulars_Attachment_URL",
            "Supplier Details_Attachment": "Supplier Details_Attachment_URL",
        };

        let html = '<div class="detail-scroll">';

        const particular = item["Particulars_Item"] || "N/A";
        const reqNo = item["Request No."] || "N/A";
        const reqUrl = item["Request No._URL"];
        const status = item["Status"] || "";
        const statusClass = status.toLowerCase().replace(/\s+/g, "-");
        html += `<div class="detail-title">${esc(particular)}</div>`;
        html += `<div class="detail-reqno-line"><span class="detail-reqno">${reqUrl ? `<a href="${esc(reqUrl)}" target="_blank" rel="noopener">${esc(reqNo)}</a>` : esc(reqNo)}</span>${status ? `<span class="result-status status-${statusClass}">${esc(status)}</span>` : ""}</div>`;

        for (const group of DISPLAY_GROUPS) {
            const fieldHtml = [];
            for (const field of group.fields) {
                const val = item[field];
                if (!val || val === "None" || val.trim() === "") continue;

                const urlKey = URL_FIELDS[field];
                const url = urlKey ? item[urlKey] : null;
                const label = field.replace(/^(Particulars_|Supplier Details_)/, "");

                let displayVal;
                if (url && url.trim()) {
                    displayVal = `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(val)}</a>`;
                } else if (field.includes("Price") || field.includes("Unit Price")) {
                    const num = Number(val);
                    const curr = item["Particulars_Unit Price-Currency"] || "PHP";
                    displayVal = !isNaN(num) ? `<strong>${esc(curr)} ${num.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>` : esc(val);
                } else {
                    displayVal = esc(val);
                }

                fieldHtml.push(`
                    <div class="detail-field">
                        <div class="detail-label">${esc(label)}</div>
                        <div class="detail-value">${displayVal}</div>
                    </div>
                `);
            }
            if (fieldHtml.length > 0) {
                html += `<div class="detail-group"><div class="detail-group-title">${group.title}</div>${fieldHtml.join("")}</div>`;
            }
        }

        html += "</div>";
        return html;
    }

    function openDetail(result, idx) {
        const item = result.item;
        const panel = $("#detail-panel");
        const content = $("#detail-content");
        selectedIndex = idx;

        $$(".result-card").forEach(c => c.classList.remove("selected"));
        const selectedCard = $(`.result-card[data-index="${idx}"]`);
        if (selectedCard) selectedCard.classList.add("selected");

        content.innerHTML = buildDetailHtml(item);
        const scroll = content.querySelector('.detail-scroll');
        scroll.classList.add('skeleton-overlay');

        panel.classList.add("open");
        document.body.classList.add("detail-open");
        panel.scrollTo(0, 0);
        content.scrollTo(0, 0);

        clearTimeout(detailTimeout);
        detailTimeout = setTimeout(() => {
            scroll.classList.remove('skeleton-overlay');
            scroll.classList.add('detail-fade-in');
        }, 500);
    }

    function closeDetail() {
        clearTimeout(detailTimeout);
        $("#detail-panel").classList.remove("open");
        document.body.classList.remove("detail-open");
        $$(".result-card").forEach(c => c.classList.remove("selected"));
        selectedIndex = -1;
    }

    // --- Settings ---
    function openSettings() {
        $("#settings-panel").classList.add("open");
        $("#settings-overlay").classList.add("visible");
        const debugPass = getDebugPassword();
        if (debugPass) $("#settings-enc-password").value = debugPass;
    }

    function closeSettings() {
        $("#settings-panel").classList.remove("open");
        $("#settings-overlay").classList.remove("visible");
    }

    function setTheme(theme) {
        localStorage.setItem("theme", theme);
        applyTheme(theme);
        $$(".theme-option").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.theme === theme);
        });
    }

    function applyTheme(theme) {
        const root = document.documentElement;
        root.removeAttribute("data-theme");
        if (theme === "system") {
            const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            root.setAttribute("data-theme", prefersDark ? "dark" : "light");
        } else {
            root.setAttribute("data-theme", theme);
        }
    }

    async function handleEncryptFile() {
        const fileInput = $("#settings-enc-file");
        const passInput = $("#settings-enc-password");
        const statusEl = $("#settings-enc-status");

        if (!fileInput.files.length) {
            statusEl.textContent = "Please select a file.";
            statusEl.className = "enc-status error";
            return;
        }

        const file = fileInput.files[0];
        const password = passInput.value || getDebugPassword();
        if (!password) {
            statusEl.textContent = "Please enter a password.";
            statusEl.className = "enc-status error";
            return;
        }

        statusEl.textContent = "Processing...";
        statusEl.className = "enc-status info";

        try {
            const buffer = await file.arrayBuffer();
            let csvText;

            if (file.name.endsWith(".xlsx") || file.name.endsWith(".xlsm")) {
                const wb = XLSX.read(buffer, { type: "array", cellFormula: true });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const range = XLSX.utils.decode_range(ws["!ref"]);
                if (range.e.r < 1) throw new Error("Empty spreadsheet");

                const hdrs = [];
                for (let c = range.s.c; c <= range.e.c; c++) {
                    const addr = XLSX.utils.encode_cell({ r: 0, c });
                    const cell = ws[addr];
                    hdrs.push(cell ? String(cell.v || "") : "Column_" + c);
                }

                const HYPERLINK_NAMES = ["Request No.", "Particulars_Attachment", "Supplier Details_Attachment"];
                const hyperlinkCols = new Set();
                hdrs.forEach((h, i) => { if (HYPERLINK_NAMES.includes(h)) hyperlinkCols.add(i); });

                const expandedHeaders = [];
                hdrs.forEach((h, i) => {
                    expandedHeaders.push(h);
                    if (hyperlinkCols.has(i)) expandedHeaders.push(h + "_URL");
                });

                const HYPERLINK_RE = /HYPERLINK\("([^"]*)",\s*"([^"]*)"\)/i;
                const rows = [expandedHeaders];
                for (let r = 1; r <= range.e.r; r++) {
                    const outRow = [];
                    for (let c = range.s.c; c <= range.e.c; c++) {
                        const addr = XLSX.utils.encode_cell({ r, c });
                        const cell = ws[addr];
                        if (hyperlinkCols.has(c)) {
                            let text = cell ? String(cell.v || "") : "";
                            let url = "";
                            if (cell && cell.f) {
                                const m = cell.f.match(HYPERLINK_RE);
                                if (m) { text = m[2]; url = m[1]; }
                            } else if (cell && cell.l && cell.l.Target) {
                                url = cell.l.Target;
                            }
                            outRow.push(text);
                            outRow.push(url);
                        } else {
                            outRow.push(cell ? String(cell.v || "") : "");
                        }
                    }
                    rows.push(outRow);
                }
                csvText = Papa.unparse(rows);
            } else {
                csvText = new TextDecoder().decode(buffer);
            }

            const encrypted = await Crypto.encrypt(csvText, password);
            const outName = file.name.replace(/\.(xlsx|xlsm|csv)$/i, ".enc");
            downloadBlob(new Blob([encrypted]), outName);

            statusEl.textContent = `Encrypted successfully! Download: ${outName}`;
            statusEl.className = "enc-status success";
        } catch (e) {
            statusEl.textContent = "Error: " + e.message;
            statusEl.className = "enc-status error";
        }
    }

    // --- Init ---
    function waitForOrama() {
        if (window.Orama && window.OramaPluginEmbeddings) return Promise.resolve();
        return new Promise(resolve => {
            window.addEventListener("orama-ready", () => resolve(), { once: true });
        });
    }

    async function init() {
        await loadConfig();

        const savedTheme = localStorage.getItem("theme") || config.theme || "system";
        applyTheme(savedTheme);

        // Theme buttons
        $$(".theme-option").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.theme === savedTheme);
            btn.addEventListener("click", () => setTheme(btn.dataset.theme));
        });

        // Search
        $("#search-input").addEventListener("input", onSearchInput);
        $("#search-input").addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                $("#search-input").value = "";
                clearResults();
            }
        });
        $("#search-clear").addEventListener("click", () => {
            $("#search-input").value = "";
            clearResults();
            $("#search-input").focus();
        });

        // Tabs
        $$(".search-tab").forEach(btn => {
            btn.addEventListener("click", () => {
                activeTab = btn.dataset.tab;
                $$(".search-tab").forEach(b => b.classList.toggle("active", b === btn));
                const query = $("#search-input").value.trim();
                if (query) performSearch(query);
            });
        });

        // Exact match toggle
        $("#exact-toggle").addEventListener("click", () => {
            exactMatch = !exactMatch;
            $("#exact-toggle").setAttribute("aria-pressed", exactMatch);
            const query = $("#search-input").value.trim();
            if (query) performSearch(query);
        });

        // Detail
        $("#detail-close").addEventListener("click", closeDetail);
        document.addEventListener("click", (e) => {
            if (document.body.classList.contains("detail-open") &&
                !e.target.closest("#detail-panel") &&
                !e.target.closest(".result-card")) {
                closeDetail();
            }
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeDetail();
        });

        // Settings
        $("#settings-btn").addEventListener("click", openSettings);
        $("#settings-close").addEventListener("click", closeSettings);
        $("#settings-overlay").addEventListener("click", closeSettings);
        $("#settings-enc-btn").addEventListener("click", handleEncryptFile);

        // File input proxy
        $("#settings-enc-file-btn").addEventListener("click", () => {
            $("#settings-enc-file").click();
        });
        $("#settings-enc-file").addEventListener("change", () => {
            const file = $("#settings-enc-file").files[0];
            $("#settings-enc-file-name").textContent = file ? file.name : "No file chosen";
        });

        // System theme change listener
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
            if ((localStorage.getItem("theme") || config.theme || "system") === "system") applyTheme("system");
        });

        // Load database (wait for Orama ESM to load first)
        await waitForOrama();
        await initDatabase();
    }

    document.addEventListener("DOMContentLoaded", init);

    return { init };
})();
