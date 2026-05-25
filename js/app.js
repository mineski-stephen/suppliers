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
    let userExact = false;
    let autoExact = false;
    let carouselRAF = null;
    let carouselAutoSpeed = 0.5;
    let carouselVelocity = 0;
    let carouselDragging = false;
    let carouselDragStartX = 0;
    let carouselLastX = 0;
    let carouselLastTime = 0;
    let carouselPaused = false;
    let carouselDidDrag = false;
    let currentSort = null;
    let statusFilters = new Set(["Approved"]);
    let outsourceMode = null; // null | "only" | "hide"
    let currencyFilter = null; // null | "PHP" | "USD"
    let groupBy = null;
    let cachedResults = null;
    let cachedQuery = "";
    let exchangeRate = 57;
    let currencyDisplay = null; // null | "PHP" | "USD"
    let currentDetailItem = null;
    let godmodeActive = false;
    let godmodeString = "godmode";

    const REQUIRED_COLUMNS = ["Request No.", "Status", "Particulars_Item", "Supplier Details_Supplier Name", "Project Name"];

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    async function loadConfig() {
        try {
            const resp = await fetch("config.json");
            config = await resp.json();
        } catch (e) {
            console.error("Failed to load config.json:", e);
            config = {};
        }
        document.title = config.appName || "Procurement Database";
        $("#app-title").textContent = config.appName || "Procurement Database";
        if (config.godmodeKey) {
            try { godmodeString = atob(config.godmodeKey); } catch {}
        }
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
        const cancelBtn = $("#modal-cancel");
        const spinner = $("#modal-spinner");
        const progEl = $("#modal-progress");

        errEl.textContent = opts.error || "";
        errEl.style.display = opts.error ? "block" : "none";
        infoEl.textContent = opts.info || "";
        infoEl.style.display = opts.info ? "block" : "none";
        passInput.value = opts.prefill || "";
        submitBtn.disabled = false;
        spinner.style.display = "none";
        cancelBtn.style.display = opts.showCancel ? "" : "none";

        const showProgress = opts.progress !== undefined;
        progEl.classList.toggle("visible", showProgress);
        if (showProgress) updateProgress(opts.progress);

        if (opts.hideInput || showProgress) {
            passInput.style.display = "none";
            $("#modal-btn-row").style.display = "none";
        } else {
            passInput.style.display = "";
            $("#modal-btn-row").style.display = "";
        }

        modal.classList.add("visible");
        overlay.classList.add("visible");

        if (showProgress) return Promise.resolve();

        return new Promise((resolve) => {
            const cleanup = () => {
                submitBtn.removeEventListener("click", handler);
                passInput.removeEventListener("keydown", keyHandler);
                cancelBtn.removeEventListener("click", cancelHandler);
            };
            const handler = (e) => {
                e.preventDefault();
                submitBtn.disabled = true;
                spinner.style.display = "inline-block";
                cleanup();
                resolve(passInput.value);
            };
            const cancelHandler = () => {
                cleanup();
                resolve(null);
            };
            const keyHandler = (e) => {
                if (e.key === "Enter") handler(e);
                if (e.key === "Escape" && opts.showCancel) cancelHandler();
            };
            submitBtn.addEventListener("click", handler);
            passInput.addEventListener("keydown", keyHandler);
            cancelBtn.addEventListener("click", cancelHandler);
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
        renderCarousel();
        console.log("%c🔑 Hint: Type \"%s\" in the search box and press Enter for full database access.", "color: #4dabf7; font-style: italic;", godmodeString);
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

    // --- Carousel (infinite smooth scroll + drag physics) ---
    function buildCarouselCard(item) {
        const reqNo = item["Request No."] || "";
        const particular = item["Particulars_Item"] || "N/A";
        const supplier = item["Supplier Details_Supplier Name"] || item["Supplier Details_Account Name"] || "";
        const project = item["Project Name"] || "";
        const price = item["Particulars_Price"] || "";
        const currency = item["Particulars_Unit Price-Currency"] || "PHP";
        const date = item["Submitted at"] || "";
        const dateFormatted = date ? date.split(" ")[0] : "";
        const priceFormatted = price ? Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";

        const card = document.createElement("div");
        card.className = "carousel-card";
        card.innerHTML = `
            <div class="carousel-reqno">${esc(reqNo)}</div>
            <div class="carousel-particular">${esc(particular)}</div>
            <div class="carousel-supplier">${esc(supplier)}</div>
            ${project ? `<div class="carousel-project">${esc(project)}</div>` : ""}
            <div class="carousel-footer">
                <span class="carousel-price">${priceFormatted ? esc(currency) + " " + priceFormatted : ""}</span>
                <span class="carousel-date">${esc(dateFormatted)}</span>
            </div>
        `;
        card.addEventListener("click", () => {
            if (!carouselDidDrag) openDetail({ item }, -1);
        });
        return card;
    }

    // Virtual-rotation carousel: cards rotate in a ring.
    // When a card exits one side, it's moved to the other side.
    // No cloning, no scrollLeft snapping — seamless infinite loop.
    let carouselItems = [];      // data items in order
    let carouselOffset = 0;      // fractional px offset (drives translateX)
    const CARD_W = 200;
    const CARD_GAP = 12;
    const CARD_STEP = CARD_W + CARD_GAP; // 212px per card slot

    function renderCarousel() {
        const sorted = db.slice().sort((a, b) => {
            return new Date(b["Submitted at"] || 0) - new Date(a["Submitted at"] || 0);
        }).slice(0, 10);

        if (sorted.length === 0) return;
        carouselItems = sorted;

        const container = $("#recent-carousel");
        container.innerHTML = "";

        // Build one card per item
        sorted.forEach(item => container.appendChild(buildCarouselCard(item)));

        carouselOffset = 0;
        layoutCarousel();
        showCarousel();
        initCarouselDrag();
    }

    // Position all cards via translateX based on carouselOffset
    function layoutCarousel() {
        const container = $("#recent-carousel");
        if (!container) return;
        const cards = container.children;
        const n = cards.length;
        if (n === 0) return;
        const totalRing = n * CARD_STEP;
        const viewW = container.parentElement.clientWidth || container.clientWidth || 680;

        for (let i = 0; i < n; i++) {
            // Raw position for this slot
            let x = i * CARD_STEP + carouselOffset;
            // Wrap into ring: keep within [-CARD_STEP, totalRing - CARD_STEP)
            x = ((x % totalRing) + totalRing) % totalRing;
            // Shift so cards that wrap appear on the left side too
            if (x > totalRing - CARD_STEP) x -= totalRing;
            cards[i].style.transform = `translateX(${x}px)`;
            // Hide cards fully off-screen (perf)
            cards[i].style.visibility = (x < -CARD_STEP || x > viewW + CARD_STEP) ? "hidden" : "";
        }
    }

    function showCarousel() {
        const el = $("#recent-carousel-container");
        if (!el || db.length === 0) return;
        el.style.display = "";
        carouselPaused = false;
        startCarouselLoop();
    }

    function hideCarousel() {
        const el = $("#recent-carousel-container");
        if (el) el.style.display = "none";
        stopCarouselLoop();
    }

    function startCarouselLoop() {
        if (carouselRAF) return;

        function tick() {
            if (!carouselPaused && !carouselDragging) {
                if (Math.abs(carouselVelocity) > 0.2) {
                    carouselOffset -= carouselVelocity;
                    carouselVelocity *= 0.95;
                } else {
                    carouselVelocity = 0;
                    carouselOffset -= carouselAutoSpeed;
                }
                layoutCarousel();
            }
            carouselRAF = requestAnimationFrame(tick);
        }
        carouselRAF = requestAnimationFrame(tick);
    }

    function stopCarouselLoop() {
        if (carouselRAF) {
            cancelAnimationFrame(carouselRAF);
            carouselRAF = null;
        }
    }

    function initCarouselDrag() {
        const carousel = $("#recent-carousel");
        if (!carousel) return;
        let dragStartOffset = 0;

        function onPointerDown(e) {
            carouselDragging = true;
            carouselDidDrag = false;
            carouselVelocity = 0;
            carouselDragStartX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
            dragStartOffset = carouselOffset;
            carouselLastX = carouselDragStartX;
            carouselLastTime = performance.now();
            carousel.classList.add("dragging");
        }

        function onPointerMove(e) {
            if (!carouselDragging) return;
            e.preventDefault();
            const x = e.clientX || (e.touches && e.touches[0].clientX) || 0;
            const dx = carouselDragStartX - x;
            if (Math.abs(dx) > 3) carouselDidDrag = true;
            carouselOffset = dragStartOffset - dx;
            layoutCarousel();

            const now = performance.now();
            const dt = now - carouselLastTime;
            if (dt > 0) {
                carouselVelocity = (carouselLastX - x) / dt * 16;
            }
            carouselLastX = x;
            carouselLastTime = now;
        }

        function onPointerUp() {
            if (!carouselDragging) return;
            carouselDragging = false;
            carousel.classList.remove("dragging");
            carouselVelocity = Math.max(-20, Math.min(20, carouselVelocity));
            if (carouselDidDrag) {
                setTimeout(() => { carouselDidDrag = false; }, 300);
            }
        }

        carousel.addEventListener("mousedown", onPointerDown);
        window.addEventListener("mousemove", onPointerMove);
        window.addEventListener("mouseup", onPointerUp);
        carousel.addEventListener("touchstart", onPointerDown, { passive: true });
        carousel.addEventListener("touchmove", onPointerMove, { passive: false });
        carousel.addEventListener("touchend", onPointerUp);
    }

    // --- Auto-Exact Detection ---
    function detectExactPattern(query) {
        if (/^\d{6,}$/.test(query)) return true;
        if (/^\d{4}[A-Z]{2,4}-[A-Z]?\d+$/i.test(query)) return true;
        return false;
    }

    // --- Search UI ---
    function onSearchInput() {
        clearTimeout(searchTimeout);
        if (godmodeActive) {
            const q = $("#search-input").value.trim();
            if (q.toLowerCase() !== godmodeString.toLowerCase()) {
                godmodeActive = false;
            }
        }
        searchTimeout = setTimeout(() => {
            const query = $("#search-input").value.trim();
            if (!query) {
                clearResults();
                return;
            }

            // Auto-exact detection
            const shouldAutoExact = detectExactPattern(query);
            if (shouldAutoExact && !userExact) {
                autoExact = true;
                exactMatch = true;
                $("#exact-toggle").setAttribute("aria-pressed", "true");
            } else if (!shouldAutoExact && autoExact) {
                autoExact = false;
                exactMatch = userExact;
                $("#exact-toggle").setAttribute("aria-pressed", String(exactMatch));
            }

            hideCarousel();
            performSearch(query);
        }, 200);
    }

    async function performSearch(query) {
        const tabs = ["all", "particulars", "suppliers", "projects"];
        const allResults = await Promise.all(
            tabs.map(tab => Search.search(query, { tab, exact: exactMatch, limit: 500 }))
        );

        cachedResults = allResults;
        cachedQuery = query;

        const activeIdx = tabs.indexOf(activeTab);
        const filtered = applyFiltersAndSort(allResults[activeIdx]);
        renderResults(filtered, query);

        // Update badges with filtered counts
        tabs.forEach((tab, i) => {
            const badge = $(`.search-tab[data-tab="${tab}"] .tab-badge`);
            if (!badge) return;
            const count = applyFiltersAndSort(allResults[i]).length;
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = "";
            } else {
                badge.style.display = "none";
            }
        });
    }

    function reapplyFilters() {
        if (!cachedResults) return;
        const tabs = ["all", "particulars", "suppliers", "projects"];
        const activeIdx = tabs.indexOf(activeTab);
        const filtered = applyFiltersAndSort(cachedResults[activeIdx]);
        renderResults(filtered, cachedQuery);

        tabs.forEach((tab, i) => {
            const badge = $(`.search-tab[data-tab="${tab}"] .tab-badge`);
            if (!badge) return;
            const count = applyFiltersAndSort(cachedResults[i]).length;
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = "";
            } else {
                badge.style.display = "none";
            }
        });
    }

    // --- Filters & Sort ---
    function applyFiltersAndSort(results) {
        let filtered = results.slice();

        // Status filter
        if (statusFilters.size > 0 && statusFilters.size < 4) {
            filtered = filtered.filter(r => {
                const status = (r.item["Status"] || "").trim();
                return statusFilters.has(status);
            });
        }

        // Outsource filter
        if (outsourceMode === "hide") {
            filtered = filtered.filter(r => {
                const p = (r.item["Particulars_Item"] || "").toLowerCase();
                return !p.includes("outsource");
            });
        } else if (outsourceMode === "only") {
            filtered = filtered.filter(r => {
                const p = (r.item["Particulars_Item"] || "").toLowerCase();
                return p.includes("outsource");
            });
        }

        // Currency filter
        if (currencyFilter) {
            filtered = filtered.filter(r => {
                const cur = (r.item["Particulars_Unit Price-Currency"] || "PHP").toUpperCase();
                return cur === currencyFilter;
            });
        }

        // Sort
        if (currentSort) {
            const fn = getSortFunction(currentSort);
            filtered.sort(fn);
        }

        return filtered;
    }

    function getSortFunction(key) {
        switch (key) {
            case "date-desc": return (a, b) => new Date(b.item["Submitted at"] || 0) - new Date(a.item["Submitted at"] || 0);
            case "date-asc": return (a, b) => new Date(a.item["Submitted at"] || 0) - new Date(b.item["Submitted at"] || 0);
            case "price-desc": return (a, b) => toPhp(parseFloat(b.item["Particulars_Price"]) || 0, b.item["Particulars_Unit Price-Currency"] || "PHP") - toPhp(parseFloat(a.item["Particulars_Price"]) || 0, a.item["Particulars_Unit Price-Currency"] || "PHP");
            case "price-asc": return (a, b) => toPhp(parseFloat(a.item["Particulars_Price"]) || 0, a.item["Particulars_Unit Price-Currency"] || "PHP") - toPhp(parseFloat(b.item["Particulars_Price"]) || 0, b.item["Particulars_Unit Price-Currency"] || "PHP");
            case "project-asc": return (a, b) => (a.item["Project Code"] || "").localeCompare(b.item["Project Code"] || "");
            case "project-desc": return (a, b) => (b.item["Project Code"] || "").localeCompare(a.item["Project Code"] || "");
            default: return () => 0;
        }
    }

    function updateFilterBadge() {
        const active = currentSort != null ||
            statusFilters.size !== 1 || !statusFilters.has("Approved") ||
            outsourceMode != null ||
            currencyFilter != null ||
            groupBy != null;
        $("#filter-badge").style.display = active ? "" : "none";
    }

    function clearResults() {
        $("#results-list").innerHTML = "";
        $("#results-count").textContent = "";
        closeDetail();
        $("#main-content").classList.remove("has-results");
        selectedIndex = -1;
        $$(".tab-badge").forEach(b => b.style.display = "none");
        cachedResults = null;
        cachedQuery = "";
        showCarousel();
    }

    // --- Outsource Chip ---
    function chipOutsource(html) {
        return html.replace(
            /(<mark>)?(outsourced?)(<\/mark>)?/gi,
            '<span class="outsource-chip">Outsourced</span>'
        );
    }

    // --- Render Results ---
    function renderResults(results, query) {
        const list = $("#results-list");
        list.innerHTML = "";
        window.scrollTo(0, 0);
        selectedIndex = -1;
        closeDetail();

        if (results.length === 0) {
            list.innerHTML = '<div class="no-results">No results found. Try a different search term.</div>';
            $("#results-count").textContent = "0 results";
            return;
        }

        $("#main-content").classList.add("has-results");

        // Grouped rendering
        if (groupBy) {
            renderGroupedResults(results, query);
            return;
        }

        $("#results-count").textContent = `${results.length} result${results.length !== 1 ? "s" : ""}`;

        const fragment = document.createDocumentFragment();
        results.forEach((r, idx) => {
            fragment.appendChild(buildResultCard(r, idx, query));
        });
        list.appendChild(fragment);
    }

    function toPhp(amount, currency) {
        if (!currency || currency === "PHP") return amount;
        if (currency === "USD") return amount * exchangeRate;
        return amount;
    }

    function formatPrice(amount, currency) {
        if (!amount || isNaN(amount)) return "";
        if (currencyDisplay === "PHP") {
            const val = toPhp(amount, currency);
            return "PHP " + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        if (currencyDisplay === "USD") {
            const val = currency === "USD" ? amount : amount / exchangeRate;
            return "USD " + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        const c = currency || "PHP";
        return c + " " + amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function buildResultCard(r, idx, query) {
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
        const unitPriceFmt = unitPrice ? formatPrice(Number(unitPrice), currency) : "";
        const totalPriceFmt = price ? formatPrice(Number(price), currency) : "";
        const dateFormatted = date ? date.split(" ")[0] : "";

        const particularHtml = chipOutsource(highlight(particular, query));

        card.innerHTML = `
            <div class="result-header">
                <span class="result-reqno">${esc(reqNo)}</span>
                <span class="result-status status-${status.toLowerCase().replace(/\s+/g, "-")}">${esc(status)}</span>
            </div>
            <div class="result-particular">${particularHtml}</div>
            <div class="result-meta">
                <span class="result-supplier" title="Supplier">${highlight(supplier, query)}</span>
                ${(unitPriceFmt || totalPriceFmt) ? `<div class="result-pricing">
                    ${unitPriceFmt ? `<div class="result-unit-price">${esc(qty || "1")} x ${unitPriceFmt}</div>` : ""}
                    ${totalPriceFmt ? `<div class="result-total-price">${unitPriceFmt ? "Total " : ""}${totalPriceFmt}</div>` : ""}
                </div>` : ""}
            </div>
            <div class="result-footer">
                ${project ? `<span class="result-project">${highlight(project, query)}</span>` : ""}
                ${dateFormatted ? `<span class="result-date">${esc(dateFormatted)}</span>` : ""}
                ${r.isRelated ? '<span class="result-related-tag">Related</span>' : ""}
            </div>
        `;

        card.style.animationDelay = `${Math.min(idx, 15) * 40}ms`;
        card.addEventListener("click", () => {
            if (selectedIndex === idx) { closeDetail(); return; }
            openDetail(r, idx);
        });
        return card;
    }

    // --- Grouped Results ---
    function renderGroupedResults(results, query) {
        const list = $("#results-list");
        const groups = new Map();

        results.forEach((r, idx) => {
            let key = r.item[groupBy] || "";
            if (!key.trim() && groupBy === "Supplier Details_Supplier Name") {
                key = r.item["Supplier Details_Account Name"] || "";
            }
            key = key.trim() || "Unspecified";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ r, idx });
        });

        $("#results-count").textContent = `${results.length} result${results.length !== 1 ? "s" : ""} in ${groups.size} group${groups.size !== 1 ? "s" : ""}`;

        const fragment = document.createDocumentFragment();
        let globalIdx = 0;

        // Sort groups when price sort is active
        let groupEntries = Array.from(groups.entries());
        function groupSum(items) {
            return items.reduce((s, { r }) => {
                const amt = parseFloat(r.item["Particulars_Price"]) || 0;
                const cur = r.item["Particulars_Unit Price-Currency"] || "PHP";
                return s + toPhp(amt, cur);
            }, 0);
        }

        if (currentSort === "price-desc" || currentSort === "price-asc") {
            groupEntries.sort((a, b) => {
                const sumA = groupSum(a[1]);
                const sumB = groupSum(b[1]);
                return currentSort === "price-desc" ? sumB - sumA : sumA - sumB;
            });
        }

        for (const [name, items] of groupEntries) {
            const totalPhp = groupSum(items);
            const priceStr = totalPhp > 0 ? formatPrice(totalPhp, "PHP") : "";

            const groupEl = document.createElement("div");
            groupEl.className = "result-group";

            const header = document.createElement("div");
            header.className = "result-group-header";
            header.innerHTML = `
                <div class="result-group-left">
                    <svg class="result-group-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                    </svg>
                    <span class="result-group-name">${esc(name)}</span>
                    <span class="result-group-count">(${items.length})</span>
                </div>
                ${priceStr ? `<span class="result-group-sum">${priceStr}</span>` : ""}
            `;

            header.addEventListener("click", () => {
                const wasExpanded = groupEl.classList.contains("expanded");
                groupEl.classList.toggle("expanded");
                // Re-trigger animations on expand by resetting delay from now
                if (!wasExpanded) {
                    const cards = itemsContainer.querySelectorAll(".result-card");
                    cards.forEach((card, i) => {
                        card.style.animation = "none";
                        card.offsetHeight; // force reflow
                        card.style.animation = "";
                        card.style.animationDelay = `${Math.min(i, 15) * 40}ms`;
                    });
                }
            });

            const itemsContainer = document.createElement("div");
            itemsContainer.className = "result-group-items";

            items.forEach(({ r }, localIdx) => {
                const card = buildResultCard(r, globalIdx++, query);
                // Delay set per local position; will be re-applied on expand anyway
                card.style.animationDelay = `${Math.min(localIdx, 15) * 40}ms`;
                itemsContainer.appendChild(card);
            });

            groupEl.appendChild(header);
            groupEl.appendChild(itemsContainer);
            fragment.appendChild(groupEl);
        }

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
        let cleaned = query.replace(/-"[^"]*"/g, "").replace(/(?:^|\s)-\S+/g, "");
        const quotedRe = /"([^"]+)"/g;
        let m;
        while ((m = quotedRe.exec(cleaned)) !== null) terms.push(m[1]);
        const remainder = cleaned.replace(/"[^"]*"/g, "").trim();
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
                    displayVal = !isNaN(num) ? `<strong>${formatPrice(num, curr)}</strong>` : esc(val);
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
        currentDetailItem = item;
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
        currentDetailItem = null;
    }

    // --- Filter Popover ---
    function toggleFilterPopover() {
        const pop = $("#filter-popover");
        const btn = $("#filter-btn");
        const isOpen = pop.style.display !== "none";
        pop.style.display = isOpen ? "none" : "";
        btn.classList.toggle("active", !isOpen);
    }

    function closeFilterPopover() {
        $("#filter-popover").style.display = "none";
        $("#filter-btn").classList.remove("active");
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
                            outRow.push(cell ? (cell.w != null ? cell.w : String(cell.v || "")) : "");
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

    // --- Godmode ---
    async function activateGodmode() {
        clearTimeout(searchTimeout);
        if (!godmodeActive) {
            if (currentPassword) {
                $(".modal-desc").style.display = "none";
                let wrongAttempt = false;
                while (true) {
                    const pass = await showModal({
                        info: "Enter the database password to view all records.",
                        error: wrongAttempt ? "Incorrect password." : "",
                        showCancel: true,
                    });
                    if (pass === null) {
                        $(".modal-desc").style.display = "";
                        hideModal();
                        return;
                    }
                    if (pass === currentPassword) break;
                    wrongAttempt = true;
                    hideModal();
                }
                $(".modal-desc").style.display = "";
                hideModal();
            }
            godmodeActive = true;
        }

        const allItems = db.map(item => ({ item, score: 0 }));
        cachedResults = [allItems, allItems, allItems, allItems];
        cachedQuery = "";

        hideCarousel();
        const filtered = applyFiltersAndSort(allItems);
        renderResults(filtered, "");

        const tabs = ["all", "particulars", "suppliers", "projects"];
        tabs.forEach((tab, i) => {
            const badge = $(`.search-tab[data-tab="${tab}"] .tab-badge`);
            if (!badge) return;
            const count = applyFiltersAndSort(cachedResults[i]).length;
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = "";
            } else {
                badge.style.display = "none";
            }
        });

        $("#main-content").classList.add("has-results");
    }

    // --- Init ---
    function waitForOrama() {
        if (window.Orama) return Promise.resolve();
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

        // Exchange rate
        exchangeRate = parseFloat(localStorage.getItem("exchangeRate")) || config.exchangeRate || 57;
        const savedCurrency = localStorage.getItem("currencyDisplay");
        currencyDisplay = savedCurrency !== null ? (savedCurrency || null) : (config.currencyDisplay || null);
        $("#settings-exchange-rate").value = exchangeRate;
        $$(".currency-option").forEach(btn => {
            btn.classList.toggle("active", (btn.dataset.currency || "") === (currencyDisplay || ""));
            btn.addEventListener("click", () => {
                const val = btn.dataset.currency || null;
                currencyDisplay = val || null;
                localStorage.setItem("currencyDisplay", currencyDisplay || "");
                $$(".currency-option").forEach(b => b.classList.toggle("active", b === btn));
                if (cachedResults) reapplyFilters();
                if (currentDetailItem) {
                    $("#detail-content").innerHTML = buildDetailHtml(currentDetailItem);
                }
            });
        });
        $("#settings-exchange-rate").addEventListener("change", (e) => {
            const val = parseFloat(e.target.value);
            if (val > 0) {
                exchangeRate = val;
                localStorage.setItem("exchangeRate", val);
                if (cachedResults) reapplyFilters();
            }
        });

        // Search
        $("#search-input").addEventListener("input", onSearchInput);
        $("#search-input").addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                $("#search-input").value = "";
                godmodeActive = false;
                clearResults();
            }
            if (e.key === "Enter") {
                const q = $("#search-input").value.trim();
                if (q.toLowerCase() === godmodeString.toLowerCase()) {
                    e.preventDefault();
                    activateGodmode();
                }
            }
        });
        $("#search-clear").addEventListener("click", () => {
            $("#search-input").value = "";
            godmodeActive = false;
            clearResults();
            $("#search-input").focus();
        });

        // Tabs
        $$(".search-tab").forEach(btn => {
            btn.addEventListener("click", () => {
                activeTab = btn.dataset.tab;
                $$(".search-tab").forEach(b => b.classList.toggle("active", b === btn));
                if (cachedResults) {
                    reapplyFilters();
                }
            });
        });

        // Exact match toggle
        $("#exact-toggle").addEventListener("click", () => {
            userExact = !userExact;
            autoExact = false;
            exactMatch = userExact;
            $("#exact-toggle").setAttribute("aria-pressed", String(exactMatch));
            const query = $("#search-input").value.trim();
            if (query) performSearch(query);
        });

        // Filter button
        $("#filter-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            toggleFilterPopover();
        });

        // Sort options
        $$(".filter-option[data-sort]").forEach(btn => {
            btn.addEventListener("click", () => {
                const val = btn.dataset.sort;
                if (currentSort === val) {
                    currentSort = null;
                    btn.classList.remove("active");
                } else {
                    $$(".filter-option[data-sort]").forEach(b => b.classList.remove("active"));
                    currentSort = val;
                    btn.classList.add("active");
                }
                updateFilterBadge();
                if (cachedResults) reapplyFilters();
            });
        });

        // Status checkboxes
        $$(".filter-check input[data-status]").forEach(cb => {
            cb.addEventListener("change", () => {
                if (cb.checked) {
                    statusFilters.add(cb.dataset.status);
                } else {
                    statusFilters.delete(cb.dataset.status);
                    if (statusFilters.size === 0) {
                        statusFilters.add("Approved");
                        $$('.filter-check input[data-status="Approved"]').forEach(c => c.checked = true);
                    }
                }
                updateFilterBadge();
                if (cachedResults) reapplyFilters();
            });
        });

        // Outsource filter (mutually exclusive toggles)
        const outsourceShowOnly = $("#outsource-show-only");
        const outsourceHideAll = $("#outsource-hide-all");
        outsourceShowOnly.addEventListener("change", function () {
            if (this.checked) {
                outsourceMode = "only";
                outsourceHideAll.checked = false;
            } else {
                outsourceMode = null;
            }
            updateFilterBadge();
            if (cachedResults) reapplyFilters();
        });
        outsourceHideAll.addEventListener("change", function () {
            if (this.checked) {
                outsourceMode = "hide";
                outsourceShowOnly.checked = false;
            } else {
                outsourceMode = null;
            }
            updateFilterBadge();
            if (cachedResults) reapplyFilters();
        });

        // Currency filter (mutually exclusive)
        const currFilterPhp = $("#currency-filter-php");
        const currFilterUsd = $("#currency-filter-usd");
        currFilterPhp.addEventListener("change", function () {
            if (this.checked) {
                currencyFilter = "PHP";
                currFilterUsd.checked = false;
            } else {
                currencyFilter = null;
            }
            updateFilterBadge();
            if (cachedResults) reapplyFilters();
        });
        currFilterUsd.addEventListener("change", function () {
            if (this.checked) {
                currencyFilter = "USD";
                currFilterPhp.checked = false;
            } else {
                currencyFilter = null;
            }
            updateFilterBadge();
            if (cachedResults) reapplyFilters();
        });

        // Group by options
        $$(".filter-option[data-group]").forEach(btn => {
            btn.addEventListener("click", () => {
                $$(".filter-option[data-group]").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                groupBy = btn.dataset.group === "none" ? null : btn.dataset.group;
                updateFilterBadge();
                if (cachedResults) reapplyFilters();
            });
        });

        // Close filter popover on outside click
        document.addEventListener("click", (e) => {
            if (!e.target.closest(".filter-popover") && !e.target.closest(".filter-btn")) {
                closeFilterPopover();
            }
        });

        // Copy on click in detail pane
        $("#detail-content").addEventListener("click", (e) => {
            if (e.target.closest("a")) return;
            const target = e.target.closest(".detail-value, .detail-title, .detail-reqno");
            if (!target) return;
            const text = target.textContent.trim();
            if (!text) return;
            navigator.clipboard.writeText(text).then(() => {
                target.classList.add("copy-flash");
                setTimeout(() => target.classList.remove("copy-flash"), 700);

                const badge = document.createElement("div");
                badge.className = "copy-badge";
                badge.textContent = "Copied!";
                badge.style.left = e.clientX + "px";
                badge.style.top = e.clientY + "px";
                document.body.appendChild(badge);
                badge.addEventListener("animationend", () => badge.remove());
            });
        });

        // Detail
        $("#detail-close").addEventListener("click", closeDetail);
        document.addEventListener("click", (e) => {
            if (document.body.classList.contains("detail-open") &&
                !e.target.closest("#detail-panel") &&
                !e.target.closest(".result-card") &&
                !e.target.closest(".carousel-card") &&
                !e.target.closest(".result-group-header")) {
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
