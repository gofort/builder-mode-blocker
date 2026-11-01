// One add/remove UI per list; "otherKey" keeps an entry out of both lists
function setupList(section, key, otherKey, otherName) {
    const $list = section.querySelector(".list");
    const $input = section.querySelector(".entryInput");
    const $form = section.querySelector(".addForm");
    const $status = section.querySelector(".status");
    const $clearAll = section.querySelector(".clearAll");

    function render(list) {
        $list.innerHTML = "";
        list.forEach((entry, idx) => {
            const li = document.createElement("li");
            const span = document.createElement("span");
            span.className = "domain";
            span.textContent = entry;

            const btn = document.createElement("button");
            btn.className = "remove";
            btn.textContent = "Remove";
            btn.addEventListener("click", async () => {
                const next = list.filter((_, i) => i !== idx);
                await chrome.storage.sync.set({ [key]: next });
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
        const entry = normalizeEntry($input.value);
        if (!entry) { flash("Invalid entry"); return; }
        const { [key]: list = [], [otherKey]: other = [] } = await chrome.storage.sync.get([key, otherKey]);
        if (list.includes(entry)) { flash("Already added"); return; }
        if (other.includes(entry)) { flash(`Already in ${otherName}`); return; }
        const next = [...list, entry].sort();
        await chrome.storage.sync.set({ [key]: next });
        $input.value = "";
        flash("Added");
        render(next);
    });

    $clearAll.addEventListener("click", async () => {
        await chrome.storage.sync.set({ [key]: [] });
        flash("Cleared");
        render([]);
    });

    chrome.storage.sync.get(key).then(({ [key]: list = [] }) => render(list));
}

setupList(document.getElementById("blockedSection"), BLOCKED_KEY, POOL_KEY, "Time pool");
setupList(document.getElementById("poolSection"), POOL_KEY, BLOCKED_KEY, "Blocked");

const $poolUsage = document.getElementById("poolUsage");
const MINUTE_INPUTS = {
    [POOL_WORKDAY_MINUTES_KEY]: document.getElementById("poolWorkdayMinutes"),
    [POOL_FREE_DAY_MINUTES_KEY]: document.getElementById("poolFreeDayMinutes")
};

async function renderPoolUsage() {
    const settings = await chrome.storage.sync.get(Object.keys(MINUTE_INPUTS));
    const { [POOL_USAGE_KEY]: usage } = await chrome.storage.local.get(POOL_USAGE_KEY);
    const now = Date.now();
    MINUTE_INPUTS[POOL_WORKDAY_MINUTES_KEY].value = settings[POOL_WORKDAY_MINUTES_KEY] ?? DEFAULT_WORKDAY_MINUTES;
    MINUTE_INPUTS[POOL_FREE_DAY_MINUTES_KEY].value = settings[POOL_FREE_DAY_MINUTES_KEY] ?? DEFAULT_FREE_DAY_MINUTES;
    const day = isFreeDay(now) ? "a free day" : "a working day";
    $poolUsage.textContent =
        `Today is ${day}. Used ${formatMs(usedMsNow(usage, now))} of ${formatMs(poolLimitMs(settings, now))}. Resets at midnight.`;
}

for (const [key, $input] of Object.entries(MINUTE_INPUTS)) {
    $input.addEventListener("change", async () => {
        const minutes = Math.max(0, Math.floor(Number($input.value) || 0));
        await chrome.storage.sync.set({ [key]: minutes });
    });
}

chrome.storage.onChanged.addListener((changes) => {
    if (changes[POOL_WORKDAY_MINUTES_KEY] || changes[POOL_FREE_DAY_MINUTES_KEY] || changes[POOL_USAGE_KEY]) {
        renderPoolUsage();
    }
});

renderPoolUsage();
