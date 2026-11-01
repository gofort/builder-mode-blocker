// Builder Mode — time pool ticker and badge on pool sites
(() => {
    let poolList = [];
    let settings = {};
    let usage = null;
    let opens = null;
    let graceMs = null; // ms of the grace minute left, from the last tick reply
    let badge = null;

    function render(entry) {
        if (!entry) {
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
        const now = Date.now();
        const time = graceMs === null
            ? `Pool ${formatMs(poolLimitMs(settings, now) - usedMsNow(usage, now))} left`
            : `Extra ${formatMs(graceMs)} left`;
        const { today } = opensNow(opens, now);
        badge.el.textContent = `${time} (${today[entry] || 0})`;
        badge.host.style.display = "";
    }

    function tick() {
        const entry = matchingEntry(new URL(location.href), poolList);
        render(entry);
        if (entry && document.visibilityState === "visible" && document.hasFocus()) {
            chrome.runtime.sendMessage({ type: "tick" })
                .then((reply) => { graceMs = reply?.graceMs ?? null; })
                // Fails after the extension reloads; stop then
                .catch(() => clearInterval(timer));
        }
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "sync" && changes[POOL_KEY]) poolList = changes[POOL_KEY].newValue || [];
        if (areaName === "sync") {
            for (const key of [POOL_WORKDAY_MINUTES_KEY, POOL_FREE_DAY_MINUTES_KEY]) {
                if (changes[key]) settings = { ...settings, [key]: changes[key].newValue };
            }
        }
        if (areaName === "local" && changes[POOL_USAGE_KEY]) usage = changes[POOL_USAGE_KEY].newValue;
        if (areaName === "local" && changes[POOL_OPENS_KEY]) opens = changes[POOL_OPENS_KEY].newValue;
    });

    let timer = null;
    Promise.all([
        chrome.storage.sync.get([POOL_KEY, POOL_WORKDAY_MINUTES_KEY, POOL_FREE_DAY_MINUTES_KEY]),
        chrome.storage.local.get([POOL_USAGE_KEY, POOL_OPENS_KEY])
    ]).then(([sync, local]) => {
        poolList = sync[POOL_KEY] || [];
        settings = sync;
        usage = local[POOL_USAGE_KEY];
        opens = local[POOL_OPENS_KEY];
        tick();
        timer = setInterval(tick, 1000);
    });
})();
