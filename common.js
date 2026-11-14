// Shared by background.js, options.js and content.js
const BLOCKED_KEY = "blockedList";
const POOL_KEY = "poolList";
const POOL_WORKDAY_MINUTES_KEY = "poolWorkdayMinutes";
const POOL_FREE_DAY_MINUTES_KEY = "poolFreeDayMinutes";
const POOL_USAGE_KEY = "poolUsage"; // chrome.storage.local: { dayStart, usedMs }
const POOL_OPENS_KEY = "poolOpens"; // chrome.storage.local: { dayStart, today: {entry: n} }
const POOL_GRACES_KEY = "poolGraces"; // chrome.storage.local: { dayStart, today: {entry: n} }
const WEEKEND_USAGE_KEY = "weekendUsage"; // chrome.storage.local: { dayStart, usedMs }
const DEFAULT_WORKDAY_MINUTES = 7;
const DEFAULT_FREE_DAY_MINUTES = 30;
const MAX_GRACES_PER_DAY = 2;
const WEEKEND_MINUTES = 15;

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

// Regex form of "||entry^" for DNR. The match is the whole URL, so a
// redirect can carry it with "\0". Case-insensitive. The optional group
// is a subdomain or user info before the host.
function entryRegex(entry) {
    const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `^https?://([^/?#]*[.@])?${escaped}([^a-zA-Z0-9_\\-.%@].*)?$`;
}

// The pool resets every day at local midnight
function currentDayStart(now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function nextReset(now) {
    const d = new Date(currentDayStart(now));
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

// Easter Sunday in the Gregorian calendar (Meeus/Jones/Butcher)
function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

// Polish public holidays (dni ustawowo wolne od pracy)
function isPolishHoliday(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const fixed = [
        [1, 1], // New Year's Day
        [1, 6], // Epiphany
        [5, 1], // Labour Day
        [5, 3], // Constitution Day
        [8, 15], // Assumption
        [11, 1], // All Saints' Day
        [11, 11], // Independence Day
        [12, 25], // Christmas Day
        [12, 26] // Second day of Christmas
    ];
    if (year >= 2025) fixed.push([12, 24]); // Christmas Eve, since 2025
    if (fixed.some(([m, d]) => m === month && d === day)) return true;
    const easter = easterSunday(year);
    const dayOfYear = (d) => Math.round((d - new Date(year, 0, 1)) / 86400000);
    const offset = dayOfYear(new Date(year, month - 1, day)) - dayOfYear(easter);
    // Easter Sunday, Easter Monday, Pentecost Sunday, Corpus Christi
    return [0, 1, 49, 60].includes(offset);
}

// A free day is a Saturday, a Sunday, or a Polish public holiday
function isFreeDay(now) {
    const d = new Date(now);
    const weekday = d.getDay();
    return weekday === 0 || weekday === 6 || isPolishHoliday(d);
}

// The pool limit for the day, from the synced settings
function poolLimitMs(settings, now) {
    const minutes = isFreeDay(now)
        ? settings?.[POOL_FREE_DAY_MINUTES_KEY] ?? DEFAULT_FREE_DAY_MINUTES
        : settings?.[POOL_WORKDAY_MINUTES_KEY] ?? DEFAULT_WORKDAY_MINUTES;
    return minutes * 60 * 1000;
}

// On a free day, the blocked sites share WEEKEND_MINUTES; else they stay blocked
function weekendLimitMs(now) {
    return isFreeDay(now) ? WEEKEND_MINUTES * 60 * 1000 : 0;
}

// Opens from an earlier day count as zero
function opensNow(opens, now) {
    const dayStart = currentDayStart(now);
    const sameDay = opens?.dayStart === dayStart;
    return { dayStart, today: sameDay ? opens.today || {} : {} };
}

// Graces from an earlier day count as zero
function gracesNow(graces, now) {
    const dayStart = currentDayStart(now);
    const sameDay = graces?.dayStart === dayStart;
    return { dayStart, today: sameDay ? graces.today || {} : {} };
}

// Usage from an earlier day counts as zero
function usedMsNow(usage, now) {
    if (!usage || usage.dayStart !== currentDayStart(now)) return 0;
    return usage.usedMs || 0;
}

function formatMs(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
