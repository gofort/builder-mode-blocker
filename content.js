// Builder Mode — time pool ticker and badge on pool sites
(() => {
    let poolList = [];
    let limitMs = DEFAULT_POOL_MINUTES * 60 * 1000;
    let usage = null;
    let badge = null;

    function onPoolSite() {
        const url = new URL(location.href);
        return poolList.some((entry) => matchesEntry(url, entry));
    }

    function render(show) {
        if (!show) {
            if (badge) badge.host.style.display = "none";
            return;
        }
        if (!badge) {
            // Shadow root keeps the page CSS out of the badge
            const host = document.createElement("div");
            host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none;";
            const root = host.attachShadow({ mode: "closed" });
            const el = document.createElement("div");
            el.style.cssText = "font:600 13px/1 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;" +
                "color:#fff;background:rgba(15,23,42,.85);padding:8px 10px;border-radius:8px;" +
                "box-shadow:0 4px 12px rgba(0,0,0,.25);font-variant-numeric:tabular-nums;";
            root.appendChild(el);
            document.documentElement.appendChild(host);
            badge = { host, el };
        }
        const left = limitMs - usedMsNow(usage, Date.now());
        badge.el.textContent = `Pool ${formatMs(left)} left`;
        badge.host.style.display = "";
    }

    function tick() {
        const show = onPoolSite();
        render(show);
        if (show && document.visibilityState === "visible" && document.hasFocus()) {
            // Fails after the extension reloads; stop then
            chrome.runtime.sendMessage({ type: "tick" }).catch(() => clearInterval(timer));
        }
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "sync" && changes[POOL_KEY]) poolList = changes[POOL_KEY].newValue || [];
        if (areaName === "sync" && changes[POOL_MINUTES_KEY]) {
            limitMs = (changes[POOL_MINUTES_KEY].newValue ?? DEFAULT_POOL_MINUTES) * 60 * 1000;
        }
        if (areaName === "local" && changes[POOL_USAGE_KEY]) usage = changes[POOL_USAGE_KEY].newValue;
    });

    let timer = null;
    Promise.all([
        chrome.storage.sync.get([POOL_KEY, POOL_MINUTES_KEY]),
        chrome.storage.local.get(POOL_USAGE_KEY)
    ]).then(([sync, local]) => {
        poolList = sync[POOL_KEY] || [];
        limitMs = (sync[POOL_MINUTES_KEY] ?? DEFAULT_POOL_MINUTES) * 60 * 1000;
        usage = local[POOL_USAGE_KEY];
        tick();
        timer = setInterval(tick, 1000);
    });
})();
