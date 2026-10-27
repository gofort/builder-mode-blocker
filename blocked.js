if (new URLSearchParams(location.search).get("reason") === "pool") {
    document.getElementById("reason").textContent =
        "Your time pool is used up. It resets on Sunday at 23:00.";

    // The blocked URL is the last parameter, raw; the hash is its own
    const at = location.search.indexOf("&url=");
    const url = at === -1 ? null : location.search.slice(at + 5) + location.hash;
    if (url) {
        const btn = document.getElementById("grace");
        chrome.runtime.sendMessage({ type: "graceState", url }).then((state) => {
            if (state?.available) btn.hidden = false;
        });
        btn.addEventListener("click", () => {
            btn.disabled = true;
            // On success the background navigates this tab to the site
            chrome.runtime.sendMessage({ type: "grace", url }).then((reply) => {
                if (!reply?.ok) btn.hidden = true;
            });
        });
    }
}

document.getElementById("openOptions").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
});

document.getElementById("goBack").addEventListener("click", () => {
    // Try to go back; if not possible, open a neutral new tab
    if (history.length > 1) history.back();
    else chrome.tabs && chrome.tabs.create ? chrome.tabs.create({ url: "chrome://newtab" }) : null;
});
