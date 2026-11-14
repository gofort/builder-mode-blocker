# Builder Mode — Site Blocker (Chrome MV3)

Block distracting sites you configure and gently redirect yourself to a focused reminder: **“Stop procrastinating and build stuff.”**  
Built on Manifest V3 with **Declarative Net Request** for fast, pre-load blocking and a clean **Options** UI for editing the blocklist.

---

## Features

- **True pre-load blocking** using Declarative Net Request (DNR) — pages are redirected *before* they render.
- **One-click editing** of your blocklist via the Options page.
- **Subdomain coverage** automatically (e.g., adding `youtube.com` also blocks `m.youtube.com`).
- **Page blocking**: add a path (e.g., `facebook.com/nexta.tv`) to block one page and its subpages.
- **Time pool**: sites such as `linkedin.com` share one daily budget: 7 minutes on a working day, 30 minutes on a free day (Saturday, Sunday, or a Polish public holiday). A badge in the top-right corner shows the time left and how often you opened the site today, e.g. `(3)`.
- **Grace minute**: when the pool is empty, the focus page offers **Give me 1 minute**. The minute belongs to that tab only and is gone when the tab closes. Each site gets at most two per day.
- **Weekend minutes**: on a free day, the blocked sites are open for 15 minutes in total. The badge shows `Weekend 14:59 left`. Then they stay blocked until midnight. There is no setting for this.
- **Syncs across Chrome** profiles via `chrome.storage.sync`.
- **Works in Incognito** (enable in extension details).

---

## How it works

- Your blocklist is stored under `chrome.storage.sync` as strings: a domain, or a domain with a path.
- On install/startup or when you edit the list, the extension builds **dynamic DNR rules** that match `||entry^` for each entry and **redirects** main-frame navigations to `blocked.html` (the focus page).
- Single-page apps change the URL without a request, so DNR does not see it. A `tabs.onUpdated` listener checks these URLs with the same rule.
- Time pool: `content.js` runs on every page. On a pool site, it shows the badge. While the tab is visible and its window has focus, it sends one tick per second to the background, which adds the second to `poolUsage` in `chrome.storage.local`. When the pool is empty, the background adds DNR rules for the pool sites and redirects to `blocked.html?reason=pool`. The limit for the day comes from `poolWorkdayMinutes` or `poolFreeDayMinutes` in `chrome.storage.sync`. A free day is a Saturday, a Sunday, or a Polish public holiday (fixed dates plus Easter Monday and Corpus Christi, computed in `common.js`). A `chrome.alarms` alarm resets the pool every day at local midnight. Open counter: on each tab URL change, the background finds the matching pool entry. If it differs from the entry the tab showed before (kept in `chrome.storage.session`), it adds one open to `poolOpens` in `chrome.storage.local`. Reloads and navigation inside the site are not opens.
- Grace minute: the pool rules redirect with a regex, so the focus page URL carries the blocked URL. The button asks the background for a grace. The background adds session DNR `allow` rules for the pool sites, bound to that tab ID, records 60 s in `chrome.storage.session`, and navigates the tab to the site. Ticks from that tab count down the grace instead of the pool. At zero the allow rules go and the tab lands on the focus page again, without the button. The record stays as "used" until the tab closes, so one tab gets one grace. Each grant also adds one to `poolGraces` in `chrome.storage.local`, per pool entry and day. At two, the button stays hidden for that site until the next day. A pool reset or an edit of the pool list ends all graces.
- Weekend minutes: on a free day, the background adds no DNR rules for the blocked list while `weekendUsage` in `chrome.storage.local` is below 15 minutes. `content.js` shows the badge and sends ticks, as on a pool site. The background finds the list from the tab URL and adds the second to `weekendUsage`. At 15 minutes, the blocked rules come back and the tab goes to the focus page. The midnight alarm syncs the rules, so they go on a free day and come back on a working day.
- The focus page offers two actions: **Edit Blocklist** and **Go Back**. With an empty pool it can also offer **Give me 1 minute**.

> Note: Chrome enforces a per‑extension cap on **dynamic DNR rules**. For typical personal use, this is more than sufficient. If you ever approach the cap, consolidate entries or consider static rules as an advanced optimization.

---

## Folder structure

```
builder-mode-blocker/
├─ manifest.json
├─ icons/         (icon.svg source and PNG sizes)
├─ common.js      (shared helpers and storage keys)
├─ background.js
├─ content.js     (time pool ticker and badge)
├─ options.html
├─ options.css
├─ options.js
├─ blocked.html
├─ blocked.css
└─ blocked.js
```

---

## Installation (Load Unpacked)

1. Clone or download this folder.
2. Open `chrome://extensions` and toggle **Developer mode** (top right).
3. Click **Load unpacked** and select the `builder-mode-blocker/` directory.
4. In the extension card, click **Details → Extension options** to open the blocklist UI.

---

## Usage

1. In **Options**, add domains like:
   - `youtube.com`
   - `x.com`
   - `facebook.com`
   - `facebook.com/nexta.tv` (one page only)
2. Navigate to a blocked site — you’ll land on the **Builder Mode** page instead.
3. Use **Edit Blocklist** to adjust entries or **Go Back** to return to the previous page.

### Time pool

1. In **Options → Time pool**, set the minutes per working day and per free day, and add sites, e.g. `linkedin.com`, `instagram.com`.
2. Time counts only while a pool site is the active tab in the focused window. Background tabs cost nothing.
3. When the pool is empty, the pool sites are blocked until midnight local time.
   The focus page offers **Give me 1 minute**: one minute of focused time for that tab. The badge then shows `Extra 0:42 left`. The minute is gone when the tab closes, and a tab gets it only once. A new tab gets a new minute, but each site gets at most two minutes per day.
4. The site lists and the minutes setting sync across devices. The used time is per device.
5. The badge shows the opens of the site today. An open is a tab that arrives from another site or a new tab. Reloads, navigation inside the site, and blocked attempts do not count.
6. An entry can be in only one list.

### Matching rules

- Enter a **domain** to block the whole site, or a **domain with a path** to block one page. Examples:
  - `reddit.com` → blocks `www.reddit.com`, `old.reddit.com`, etc.
  - `https://www.facebook.com/nexta.tv` → stored as `facebook.com/nexta.tv`; blocks `/nexta.tv` and `/nexta.tv/…` on any Facebook subdomain, but not `/nexta.tvx` or other pages.
- The protocol, `www.`, the trailing `/` and the `#fragment` are removed. The query string is kept.
- Internal/system pages such as `chrome://…` and some special pages are not interceptable.

---

## Permissions

- `storage`: Save and sync your blocklist.
- `declarativeNetRequest`: Create dynamic blocking/redirect rules.
- `alarms`: Reset the time pool every day.
- `host_permissions: "<all_urls>"`: Allow rules to match navigations anywhere, and run the time pool script on pool sites.

No remote servers, analytics, or third‑party requests — everything runs locally in the browser.

---

## Incognito & Profiles

- To enable in Incognito: go to **chrome://extensions → Builder Mode → Details → Allow in incognito**.
- Your blocklist is kept per‑Chrome profile and synced if you’re signed in and sync is enabled.

---

## Customization

- **Change the message/UI:** edit `blocked.html` and `blocked.css`. The default CSS explicitly sets text colors for proper contrast in both light and dark modes.
- **Add a focus timer / Pomodoro:** implement a countdown in `blocked.js`, store an unlock‑until timestamp in `chrome.storage.sync`, and temporarily skip adding rules for selected domains.
- **Snooze button:** add a button on `blocked.html` that removes a domain from rules for N minutes, then re‑adds it via the background’s rule sync.

---

## Troubleshooting

- **Page still loads:** check the stored entry in Options; confirm the extension is enabled; verify you’re not on an internal `chrome://` page.
- **Doesn’t apply in Incognito:** enable “Allow in incognito” in the extension’s details.
- **Text is unreadable (white on white):** the included `blocked.css` sets explicit text colors and a dark‑mode variant—make sure you’re using the shipped stylesheet.

---

## Development notes

- Dynamic rules are rebuilt whenever `chrome.storage.onChanged` fires for the blocklist key.
- Normalization trims input, strips `www.`, and keeps the path and query; see `normalizeEntry()` in `common.js`.
- Storage keys and shared helpers live in `common.js`. The service worker loads it with `importScripts`, the options page and the content script load it first.

---

## License

MIT — do whatever you want, no warranty. Consider keeping attribution in the README.

---

## Credits

Inspired by the simplicity of MV3 **Declarative Net Request** and a desire to stay in **Builder Mode**.
