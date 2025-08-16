# Builder Mode — Site Blocker (Chrome MV3)

Block distracting sites you configure and gently redirect yourself to a focused reminder: **“Stop procrastinating and build stuff.”**  
Built on Manifest V3 with **Declarative Net Request** for fast, pre-load blocking and a clean **Options** UI for editing the blocklist.

---

## Features

- **True pre-load blocking** using Declarative Net Request (DNR) — pages are redirected *before* they render.
- **One-click editing** of your blocklist via the Options page.
- **Subdomain coverage** automatically (e.g., adding `youtube.com` also blocks `m.youtube.com`).
- **Syncs across Chrome** profiles via `chrome.storage.sync`.
- **Works in Incognito** (enable in extension details).

---

## How it works

- Your blocklist is stored under `chrome.storage.sync` as simple domain strings.
- On install/startup or when you edit the list, the extension builds **dynamic DNR rules** that match `||domain^` for each entry and **redirects** main-frame navigations to `blocked.html` (the focus page).
- The focus page offers two actions: **Edit Blocklist** and **Go Back**.

> Note: Chrome enforces a per‑extension cap on **dynamic DNR rules**. For typical personal use, this is more than sufficient. If you ever approach the cap, consolidate entries or consider static rules as an advanced optimization.

---

## Folder structure

```
builder-mode-blocker/
├─ manifest.json
├─ background.js
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
2. Navigate to a blocked site — you’ll land on the **Builder Mode** page instead.
3. Use **Edit Blocklist** to adjust entries or **Go Back** to return to the previous page.

### Matching rules

- Enter **domains**, not full URLs. Examples:
  - ✅ `reddit.com` → blocks `www.reddit.com`, `old.reddit.com`, etc.
  - ❌ `https://reddit.com/r/all` → the path is ignored; keep just `reddit.com`.
- Internal/system pages such as `chrome://…` and some special pages are not interceptable.

---

## Permissions

- `storage`: Save and sync your blocklist.
- `declarativeNetRequest`: Create dynamic blocking/redirect rules.
- `host_permissions: "<all_urls>"`: Allow rules to match navigations anywhere.

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

- **Page still loads:** ensure the domain is listed without protocol/path; confirm the extension is enabled; verify you’re not on an internal `chrome://` page.
- **Doesn’t apply in Incognito:** enable “Allow in incognito” in the extension’s details.
- **Text is unreadable (white on white):** the included `blocked.css` sets explicit text colors and a dark‑mode variant—make sure you’re using the shipped stylesheet.

---

## Development notes

- Dynamic rules are rebuilt whenever `chrome.storage.onChanged` fires for the blocklist key.
- Normalization trims input, strips `www.`, and treats strings as hostnames; see `normalizeDomain()` in both `background.js` and `options.js` for parity.
- If you extend the storage schema, keep background/options in sync and bump the version as needed.

---

## License

MIT — do whatever you want, no warranty. Consider keeping attribution in the README.

---

## Credits

Inspired by the simplicity of MV3 **Declarative Net Request** and a desire to stay in **Builder Mode**.
