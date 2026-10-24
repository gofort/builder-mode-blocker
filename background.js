// Builder Mode — DNR-backed dynamic blocking
importScripts("common.js");

const RESET_ALARM = "poolReset";
const BLOCKED_PAGE = "/blocked.html";
const POOL_BLOCKED_PAGE = "/blocked.html?reason=pool";

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

function init() {
    syncDynamicRules();
    scheduleReset();
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
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (!changeInfo.url) return;
    let url;
    try { url = new URL(changeInfo.url); } catch { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    const matches = (entries) => entries.some((entry) => matchesEntry(url, entry));
    let page = null;
    if (matches(await getEntries(BLOCKED_KEY))) page = BLOCKED_PAGE;
    else if (matches(await getEntries(POOL_KEY)) && (await isPoolEmpty())) page = POOL_BLOCKED_PAGE;
    if (page) chrome.tabs.update(tabId, { url: chrome.runtime.getURL(page) });
});
