// Builder Mode — DNR-backed dynamic blocking
importScripts("common.js");

const RESET_ALARM = "poolReset";
const BLOCKED_PAGE = "/blocked.html";
const POOL_BLOCKED_PAGE = "/blocked.html?reason=pool";
const TAB_SITE_PREFIX = "tabSite:";

// Run storage read-modify-write and rule updates one at a time
let queue = Promise.resolve();
function serial(fn) {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
}

async function getEntries(key) {
    const obj = await chrome.storage.sync.get(key);
    const raw = Array.isArray(obj[key]) ? obj[key] : [];
    // Normalize, dedupe, and filter out empties
    const set = new Set();
    for (const item of raw) {
        const d = normalizeEntry(item);
        if (d) set.add(d);
    }
    return Array.from(set);
}

async function getPoolLimitMs() {
    const { [POOL_MINUTES_KEY]: minutes = DEFAULT_POOL_MINUTES } =
        await chrome.storage.sync.get(POOL_MINUTES_KEY);
    return minutes * 60 * 1000;
}

async function getPoolUsage() {
    const now = Date.now();
    const { [POOL_USAGE_KEY]: usage } = await chrome.storage.local.get(POOL_USAGE_KEY);
    return { periodStart: currentPeriodStart(now), usedMs: usedMsNow(usage, now) };
}

async function isPoolEmpty() {
    const [usage, limitMs] = await Promise.all([getPoolUsage(), getPoolLimitMs()]);
    return usage.usedMs >= limitMs;
}

function buildRules(entries, firstId, extensionPath) {
    // Each rule redirects main-frame navigations matching the entry (and subdomains)
    // to our local "blocked.html".
    // urlFilter "||entry^" matches domain + subdomains; "^" ends the last path segment.
    let id = firstId;
    return entries.map((entry) => ({
        id: id++,
        priority: 1,
        action: {
            type: "redirect",
            redirect: { extensionPath }
        },
        condition: {
            urlFilter: `||${entry}^`,
            resourceTypes: ["main_frame"]
        }
    }));
}

function syncDynamicRules() {
    return serial(async () => {
        const blocked = await getEntries(BLOCKED_KEY);
        // Pool entries are blocked only when the pool is empty
        const pool = (await isPoolEmpty()) ? await getEntries(POOL_KEY) : [];
        const rules = [
            ...buildRules(blocked, 1, BLOCKED_PAGE),
            ...buildRules(pool, blocked.length + 1, POOL_BLOCKED_PAGE)
        ];

        // Remove all existing dynamic rules, then add current set
        const existing = await chrome.declarativeNetRequest.getDynamicRules();
        const removeIds = existing.map((r) => r.id);

        // Update in one shot
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: removeIds,
            addRules: rules
        });
    });
}

async function resetPool() {
    await chrome.storage.local.set({
        [POOL_USAGE_KEY]: { periodStart: currentPeriodStart(Date.now()), usedMs: 0 }
    });
    await syncDynamicRules();
    scheduleReset();
}

function scheduleReset() {
    chrome.alarms.create(RESET_ALARM, { when: nextReset(Date.now()) });
}

// chrome.storage.session holds the pool entry each tab shows, so a reload
// or a navigation inside the site is not a new open
function tabSiteKey(tabId) {
    return TAB_SITE_PREFIX + tabId;
}

// A tab opens a pool site when it arrives from another site or a new tab
function trackTabSite(tabId, entry) {
    return serial(async () => {
        const key = tabSiteKey(tabId);
        const { [key]: last = null } = await chrome.storage.session.get(key);
        if (entry === last) return;
        if (!entry) return chrome.storage.session.remove(key);
        await chrome.storage.session.set({ [key]: entry });
        const { [POOL_OPENS_KEY]: stored } = await chrome.storage.local.get(POOL_OPENS_KEY);
        const opens = opensNow(stored, Date.now());
        opens.today[entry] = (opens.today[entry] || 0) + 1;
        opens.week[entry] = (opens.week[entry] || 0) + 1;
        await chrome.storage.local.set({ [POOL_OPENS_KEY]: opens });
    });
}

// Tabs that already show a pool site (restored, or open before a reload
// of the extension) are not new opens
function seedTabSites() {
    return serial(async () => {
        const pool = await getEntries(POOL_KEY);
        const items = {};
        for (const tab of await chrome.tabs.query({})) {
            let url;
            try { url = new URL(tab.url); } catch { continue; }
            const entry = matchingEntry(url, pool);
            if (entry) items[tabSiteKey(tab.id)] = entry;
        }
        await chrome.storage.session.set(items);
    });
}

function init() {
    syncDynamicRules();
    scheduleReset();
    seedTabSites();
}

// Keep rules in sync on install/startup and whenever the lists change
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RESET_ALARM) resetPool();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && (changes[BLOCKED_KEY] || changes[POOL_KEY] || changes[POOL_MINUTES_KEY])) {
        syncDynamicRules();
    }
});

// content.js sends one tick per second while a pool site has focus
chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type !== "tick" || !sender.tab) return;
    serial(async () => {
        const usage = await getPoolUsage();
        const limitMs = await getPoolLimitMs();
        if (usage.usedMs < limitMs) {
            usage.usedMs += 1000;
            await chrome.storage.local.set({ [POOL_USAGE_KEY]: usage });
        }
        return usage.usedMs >= limitMs;
    }).then((empty) => {
        if (!empty) return;
        syncDynamicRules();
        chrome.tabs.update(sender.tab.id, { url: chrome.runtime.getURL(POOL_BLOCKED_PAGE) });
    });
});

// Single-page apps (e.g. Facebook) change the URL with the History API.
// DNR sees no request then, so check the new tab URL here.
// Every URL change also feeds the open counter.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (!changeInfo.url) return;
    let url;
    try { url = new URL(changeInfo.url); } catch { return; }
    if (!/^https?:$/.test(url.protocol)) return trackTabSite(tabId, null);
    let page = null;
    let poolEntry = null;
    if (matchingEntry(url, await getEntries(BLOCKED_KEY))) page = BLOCKED_PAGE;
    else poolEntry = matchingEntry(url, await getEntries(POOL_KEY));
    // A blocked attempt is not an open
    if (poolEntry && (await isPoolEmpty())) {
        page = POOL_BLOCKED_PAGE;
        poolEntry = null;
    }
    trackTabSite(tabId, poolEntry);
    if (page) chrome.tabs.update(tabId, { url: chrome.runtime.getURL(page) });
});

chrome.tabs.onRemoved.addListener((tabId) => trackTabSite(tabId, null));
