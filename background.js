const BLOCKED_PAGE = "blocked.html";
const STORAGE_KEY = "blockedSites";

chrome.runtime.onInstalled.addListener(async () => {
  const { [STORAGE_KEY]: blockedSites } = await chrome.storage.sync.get(STORAGE_KEY);

  if (!Array.isArray(blockedSites)) {
    await chrome.storage.sync.set({
      [STORAGE_KEY]: ["youtube.com", "x.com"]
    });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) {
    return;
  }

  const currentUrl = changeInfo.url;

  if (isExtensionPage(currentUrl)) {
    return;
  }

  const blockedSites = await getBlockedSites();
  const matchedSite = findBlockedMatch(currentUrl, blockedSites);

  if (!matchedSite) {
    return;
  }

  const redirectUrl = chrome.runtime.getURL(
    `${BLOCKED_PAGE}?url=${encodeURIComponent(currentUrl)}&site=${encodeURIComponent(matchedSite)}`
  );

  await chrome.tabs.update(tabId, { url: redirectUrl });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "getBlockedSites") {
    getBlockedSites().then((blockedSites) => sendResponse({ blockedSites }));
    return true;
  }

  if (message?.type === "siteIsBlocked") {
    getBlockedSites().then((blockedSites) => {
      sendResponse({ blocked: Boolean(findBlockedMatch(message.url, blockedSites)) });
    });
    return true;
  }

  return false;
});

async function getBlockedSites() {
  const { [STORAGE_KEY]: blockedSites = [] } = await chrome.storage.sync.get(STORAGE_KEY);
  return blockedSites.filter(Boolean);
}

function isExtensionPage(url) {
  return url.startsWith(chrome.runtime.getURL(""));
}

function findBlockedMatch(url, blockedSites) {
  let hostname;

  try {
    hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }

  for (const entry of blockedSites) {
    const normalizedEntry = normalizeSite(entry);

    if (!normalizedEntry) {
      continue;
    }

    if (hostname === normalizedEntry || hostname.endsWith(`.${normalizedEntry}`)) {
      return normalizedEntry;
    }
  }

  return null;
}

function normalizeSite(input) {
  if (typeof input !== "string") {
    return "";
  }

  const trimmed = input.trim().toLowerCase();

  if (!trimmed) {
    return "";
  }

  try {
    const maybeUrl = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return new URL(maybeUrl).hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "").replace(/\/.*$/, "");
  }
}
