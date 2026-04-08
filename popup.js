const STORAGE_KEY = "blockedSites";

const siteStatus = document.getElementById("site-status");
const toggleSite = document.getElementById("toggle-site");
const openSettings = document.getElementById("open-settings");

const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
const activeHostname = getHostname(activeTab?.url ?? "");

if (!activeHostname) {
  siteStatus.textContent = "Open a normal website tab to block or unblock it from here.";
  toggleSite.disabled = true;
  toggleSite.textContent = "Unavailable on this tab";
} else {
  await renderActiveSite();
}

toggleSite.addEventListener("click", async () => {
  if (!activeHostname) {
    return;
  }

  const blockedSites = await getBlockedSites();
  const nextSites = blockedSites.includes(activeHostname)
    ? blockedSites.filter((site) => site !== activeHostname)
    : [...blockedSites, activeHostname].sort((left, right) => left.localeCompare(right));

  await chrome.storage.sync.set({ [STORAGE_KEY]: nextSites });
  await renderActiveSite();
});

openSettings.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
});

async function renderActiveSite() {
  const blockedSites = await getBlockedSites();
  const isBlocked = blockedSites.includes(activeHostname);

  siteStatus.textContent = isBlocked
    ? `${activeHostname} is on your block list and will be interrupted.`
    : `${activeHostname} is not blocked right now.`;

  toggleSite.textContent = isBlocked ? "Unblock this site" : "Block this site";
}

async function getBlockedSites() {
  const { [STORAGE_KEY]: blockedSites = [] } = await chrome.storage.sync.get(STORAGE_KEY);
  return blockedSites.filter(Boolean);
}

function getHostname(url) {
  if (!/^https?:/i.test(url)) {
    return "";
  }

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
