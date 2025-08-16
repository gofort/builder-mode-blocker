// Builder Mode — DNR-backed dynamic blocking
const STORAGE_KEY = "blockedList";

// Normalize user input to a bare domain like "youtube.com"
function normalizeDomain(input) {
    if (!input) return null;
    input = input.trim();

    // Try URL parsing first
    try {
        if (!/^https?:\/\//i.test(input)) {
            // Add a scheme to help URL parsing
            input = "https://" + input;
        }
        const u = new URL(input);
        return stripWww(u.hostname.toLowerCase());
    } catch {
        // Fallback: treat as a hostname-like string
        // Remove protocol remnants, paths, wildcards, spaces
        let host = input
            .replace(/^https?:\/\//i, "")
            .replace(/\/.*$/, "")
            .replace(/^\*\.?/, "")
            .toLowerCase()
            .trim();
        if (!host || /[\s]/.test(host)) return null;
        return stripWww(host);
    }
}

function stripWww(host) {
    return host.replace(/^www\./, "");
}

async function getDomainsFromStorage() {
    const obj = await chrome.storage.sync.get(STORAGE_KEY);
    const raw = Array.isArray(obj[STORAGE_KEY]) ? obj[STORAGE_KEY] : [];
    // Normalize, dedupe, and filter out empties
    const set = new Set();
    for (const item of raw) {
        const d = normalizeDomain(item);
        if (d) set.add(d);
    }
    return Array.from(set);
}

function buildRulesFromDomains(domains) {
    // Each rule redirects main-frame navigations matching domain (and subdomains)
    // to our local "blocked.html".
    // Using urlFilter "||domain^" matches domain + subdomains.
    let id = 1;
    return domains.map((domain) => ({
        id: id++,
        priority: 1,
        action: {
            type: "redirect",
            redirect: { extensionPath: "/blocked.html" }
        },
        condition: {
            urlFilter: `||${domain}^`,
            resourceTypes: ["main_frame"]
        }
    }));
}

async function syncDynamicRules() {
    const domains = await getDomainsFromStorage();
    const rules = buildRulesFromDomains(domains);

    // Remove all existing dynamic rules, then add current set
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = existing.map((r) => r.id);

    // Update in one shot
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: removeIds,
        addRules: rules
    });
}

// Keep rules in sync on install/startup and whenever the list changes
chrome.runtime.onInstalled.addListener(() => { syncDynamicRules(); });
chrome.runtime.onStartup.addListener(() => { syncDynamicRules(); });

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes[STORAGE_KEY]) {
        syncDynamicRules();
    }
});
