// Builder Mode — DNR-backed dynamic blocking
importScripts("common.js");

const RESET_ALARM = "poolReset";
const BLOCKED_PAGE = "/blocked.html";
const POOL_BLOCKED_PAGE = "/blocked.html?reason=pool";
const TAB_SITE_PREFIX = "tabSite:";
const GRACE_PREFIX = "grace:";
const GRACE_MS = 60 * 1000;

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

// The focus page for an empty pool. The blocked URL is the last parameter,
// raw, so its own query string survives.
function poolBlockedUrl(url) {
    return chrome.runtime.getURL(POOL_BLOCKED_PAGE) + (url ? "&url=" + url : "");
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

function poolCondition(entry) {
    return {
        regexFilter: entryRegex(entry),
        isUrlFilterCaseSensitive: false,
        resourceTypes: ["main_frame"]
    };
}

// Pool rules match with a regex, so the redirect carries the blocked URL
// ("\0" is the whole match) and the focus page can offer a grace minute
function buildPoolRules(entries, firstId) {
    let id = firstId;
    return entries.map((entry) => ({
        id: id++,
        priority: 1,
        action: {
            type: "redirect",
            redirect: { regexSubstitution: poolBlockedUrl("\\0") }
        },
        condition: poolCondition(entry)
    }));
}

function syncDynamicRules() {
    return serial(async () => {
        const blocked = await getEntries(BLOCKED_KEY);
        // Pool entries are blocked only when the pool is empty
        const pool = (await isPoolEmpty()) ? await getEntries(POOL_KEY) : [];
        const rules = [
            ...buildRules(blocked, 1, BLOCKED_PAGE),
            ...buildPoolRules(pool, blocked.length + 1)
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
    await serial(clearGraces);
    await syncDynamicRules();
    scheduleReset();
}

function scheduleReset() {
    chrome.alarms.create(RESET_ALARM, { when: nextReset(Date.now()) });
}

// A grace minute lets one tab through the pool block, once per tab and
// at most MAX_GRACES_PER_DAY times per pool site per day.
// chrome.storage.session holds the ms left per tab: 0 once used up,
// absent when never granted. Session DNR allow rules bound to the tab
// let its navigations through; they go when the grace ends.
function graceKey(tabId) {
    return GRACE_PREFIX + tabId;
}

async function getGrace(tabId) {
    const key = graceKey(tabId);
    const { [key]: ms = null } = await chrome.storage.session.get(key);
    return ms;
}

async function hasGrace(tabId) {
    return (await getGrace(tabId)) > 0;
}

async function removeGraceRules(keep) {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const removeRuleIds = rules.filter(keep).map((r) => r.id);
    if (removeRuleIds.length) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
    }
}

// Not serial: called from inside serial callbacks
async function dropGrace(tabId, used) {
    await removeGraceRules((r) => r.condition.tabIds?.includes(tabId));
    if (used) await chrome.storage.session.set({ [graceKey(tabId)]: 0 });
    else await chrome.storage.session.remove(graceKey(tabId));
}

async function clearGraces() {
    await removeGraceRules(() => true);
    const all = await chrome.storage.session.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(GRACE_PREFIX));
    if (keys.length) await chrome.storage.session.remove(keys);
}

async function getGraces() {
    const { [POOL_GRACES_KEY]: stored } = await chrome.storage.local.get(POOL_GRACES_KEY);
    return gracesNow(stored, Date.now());
}

// A tab may get a grace for a URL when the URL is a pool site, the tab
// had no grace yet, and the site had fewer than MAX_GRACES_PER_DAY today
async function graceCheck(tabId, target) {
    let url;
    try { url = new URL(target); } catch { return null; }
    const pool = await getEntries(POOL_KEY);
    const entry = /^https?:$/.test(url.protocol) ? matchingEntry(url, pool) : null;
    if (!entry || (await getGrace(tabId)) !== null) return null;
    const graces = await getGraces();
    if ((graces.today[entry] || 0) >= MAX_GRACES_PER_DAY) return null;
    return { url, pool, entry, graces };
}

function startGrace(tabId, target) {
    return serial(async () => {
        const check = await graceCheck(tabId, target);
        if (!check) return false;
        const { url, pool, entry, graces } = check;
        const existing = await chrome.declarativeNetRequest.getSessionRules();
        let id = existing.reduce((max, r) => Math.max(max, r.id), 0) + 1;
        const addRules = pool.map((entry) => ({
            id: id++,
            priority: 2,
            action: { type: "allow" },
            condition: { ...poolCondition(entry), tabIds: [tabId] }
        }));
        await chrome.declarativeNetRequest.updateSessionRules({ addRules });
        graces.today[entry] = (graces.today[entry] || 0) + 1;
        await chrome.storage.local.set({ [POOL_GRACES_KEY]: graces });
        await chrome.storage.session.set({ [graceKey(tabId)]: GRACE_MS });
        await chrome.tabs.update(tabId, { url: url.href });
        return true;
    });
}

// One focused second on a pool site: from the grace minute if the tab
// has one, else from the pool
function onTick(tab) {
    return serial(async () => {
        const grace = await getGrace(tab.id);
        if (grace > 0) {
            const left = grace - 1000;
            if (left > 0) {
                await chrome.storage.session.set({ [graceKey(tab.id)]: left });
            } else {
                await dropGrace(tab.id, true);
                chrome.tabs.update(tab.id, { url: poolBlockedUrl(tab.url) });
            }
            return { graceMs: Math.max(left, 0) };
        }
        const usage = await getPoolUsage();
        const limitMs = await getPoolLimitMs();
        if (usage.usedMs < limitMs) {
            usage.usedMs += 1000;
            await chrome.storage.local.set({ [POOL_USAGE_KEY]: usage });
        }
        return { graceMs: null, empty: usage.usedMs >= limitMs };
    }).then((result) => {
        if (result.empty) {
            syncDynamicRules();
            chrome.tabs.update(tab.id, { url: poolBlockedUrl(tab.url) });
        }
        return { graceMs: result.graceMs };
    });
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
    if (areaName !== "sync") return;
    // The allow rules of a grace mirror the pool list; a new list voids them
    if (changes[POOL_KEY]) serial(clearGraces);
    if (changes[BLOCKED_KEY] || changes[POOL_KEY] || changes[POOL_MINUTES_KEY]) {
        syncDynamicRules();
    }
});

// content.js sends one tick per second while a pool site has focus.
// blocked.js asks for, and then starts, the grace minute of its tab.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!sender.tab) return;
    let reply;
    if (msg?.type === "tick") reply = onTick(sender.tab);
    else if (msg?.type === "graceState") {
        reply = graceCheck(sender.tab.id, msg.url).then((ok) => ({ available: !!ok }));
    } else if (msg?.type === "grace") {
        reply = startGrace(sender.tab.id, msg.url).then((ok) => ({ ok }));
    } else return;
    reply.then(sendResponse, () => sendResponse(null));
    return true;
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
    if (matchingEntry(url, await getEntries(BLOCKED_KEY))) {
        page = chrome.runtime.getURL(BLOCKED_PAGE);
    } else {
        poolEntry = matchingEntry(url, await getEntries(POOL_KEY));
    }
    // A blocked attempt is not an open; a grace tab goes through
    if (poolEntry && (await isPoolEmpty()) && !(await hasGrace(tabId))) {
        page = poolBlockedUrl(changeInfo.url);
        poolEntry = null;
    }
    trackTabSite(tabId, poolEntry);
    if (page) chrome.tabs.update(tabId, { url: page });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    trackTabSite(tabId, null);
    serial(() => dropGrace(tabId, false));
});
