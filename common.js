// Shared by background.js, options.js and content.js
const BLOCKED_KEY = "blockedList";
const POOL_KEY = "poolList";
const POOL_MINUTES_KEY = "poolMinutes";
const POOL_USAGE_KEY = "poolUsage"; // chrome.storage.local: { periodStart, usedMs }
const POOL_OPENS_KEY = "poolOpens"; // chrome.storage.local: { periodStart, dayStart, today: {entry: n}, week: {entry: n} }
const DEFAULT_POOL_MINUTES = 10;

// Normalize user input to "youtube.com" or "facebook.com/nexta.tv"
function normalizeEntry(input) {
    if (!input) return null;
    input = input.trim();

    // Try URL parsing first
    try {
        if (!/^https?:\/\//i.test(input)) {
            // Add a scheme to help URL parsing
            input = "https://" + input;
        }
        const u = new URL(input);
        const host = stripWww(u.hostname.toLowerCase());
        // Keep path and query so a single page can be blocked
        const path = u.pathname.replace(/\/+$/, "") + u.search;
        return host + path;
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

// Mirror of the "||entry^" urlFilter, for URLs that DNR does not see
function matchesEntry(url, entry) {
    const slash = entry.indexOf("/");
    const domain = slash === -1 ? entry : entry.slice(0, slash);
    const path = slash === -1 ? "" : entry.slice(slash);
    const host = url.hostname.toLowerCase();
    if (host !== domain && !host.endsWith("." + domain)) return false;
    const rest = (url.pathname + url.search).toLowerCase();
    if (!rest.startsWith(path.toLowerCase())) return false;
    const next = rest.charAt(path.length);
    return next === "" || !/[a-z0-9_\-.%]/i.test(next);
}

function matchingEntry(url, entries) {
    return entries.find((entry) => matchesEntry(url, entry)) || null;
}

// The pool resets every Sunday at 23:00 local time
function currentPeriodStart(now) {
    const d = new Date(now);
    d.setHours(23, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    if (d.getTime() > now) d.setDate(d.getDate() - 7);
    return d.getTime();
}

function nextReset(now) {
    const d = new Date(currentPeriodStart(now));
    d.setDate(d.getDate() + 7);
    return d.getTime();
}

// "Today" starts at local midnight, or at the pool reset if that is later
function currentDayStart(now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return Math.max(d.getTime(), currentPeriodStart(now));
}

// Opens from an earlier day or period count as zero
function opensNow(opens, now) {
    const periodStart = currentPeriodStart(now);
    const dayStart = currentDayStart(now);
    const samePeriod = opens?.periodStart === periodStart;
    return {
        periodStart,
        dayStart,
        today: samePeriod && opens.dayStart === dayStart ? opens.today || {} : {},
        week: samePeriod ? opens.week || {} : {}
    };
}

// Usage from an earlier period counts as zero
function usedMsNow(usage, now) {
    if (!usage || usage.periodStart !== currentPeriodStart(now)) return 0;
    return usage.usedMs || 0;
}

function formatMs(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
