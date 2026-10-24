if (new URLSearchParams(location.search).get("reason") === "pool") {
    document.getElementById("reason").textContent =
        "Your time pool is used up. It resets on Sunday at 23:00.";
}

document.getElementById("openOptions").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
});

document.getElementById("goBack").addEventListener("click", () => {
    // Try to go back; if not possible, open a neutral new tab
    if (history.length > 1) history.back();
    else chrome.tabs && chrome.tabs.create ? chrome.tabs.create({ url: "chrome://newtab" }) : null;
});
