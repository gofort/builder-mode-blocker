const STORAGE_KEY = "blockedList";
const $list = document.getElementById("list");
const $input = document.getElementById("domainInput");
const $form = document.getElementById("addForm");
const $status = document.getElementById("status");
const $clearAll = document.getElementById("clearAll");

// Keep normalization consistent with background
function normalizeDomain(input) {
    if (!input) return null;
    input = input.trim();
    try {
        if (!/^https?:\/\//i.test(input)) input = "https://" + input;
        const u = new URL(input);
        return stripWww(u.hostname.toLowerCase());
    } catch {
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
function stripWww(host) { return host.replace(/^www\./, ""); }

async function loadList() {
    const { [STORAGE_KEY]: list = [] } = await chrome.storage.sync.get(STORAGE_KEY);
    render(list);
}

function render(list) {
    $list.innerHTML = "";
    list.forEach((domain, idx) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.className = "domain";
        span.textContent = domain;

        const btn = document.createElement("button");
        btn.className = "remove";
        btn.textContent = "Remove";
        btn.addEventListener("click", async () => {
            const next = list.filter((_, i) => i !== idx);
            await chrome.storage.sync.set({ [STORAGE_KEY]: next });
            flash("Removed");
            render(next);
        });

        li.appendChild(span);
        li.appendChild(btn);
        $list.appendChild(li);
    });
}

function flash(text) {
    $status.textContent = text;
    setTimeout(() => { $status.textContent = ""; }, 1200);
}

$form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const domain = normalizeDomain($input.value);
    if (!domain) { flash("Invalid domain"); return; }
    const { [STORAGE_KEY]: list = [] } = await chrome.storage.sync.get(STORAGE_KEY);
    if (list.includes(domain)) { flash("Already added"); return; }
    const next = [...list, domain].sort();
    await chrome.storage.sync.set({ [STORAGE_KEY]: next });
    $input.value = "";
    flash("Added");
    render(next);
});

$clearAll.addEventListener("click", async () => {
    await chrome.storage.sync.set({ [STORAGE_KEY]: [] });
    flash("Cleared");
    render([]);
});

loadList();
