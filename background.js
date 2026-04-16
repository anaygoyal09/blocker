const BLOCKED_PAGE = "blocked.html";
const STORAGE_KEY = "blockedSites";
const SETTINGS_KEY = "blockingSettings";
const LIMITS_KEY = "siteLimits";
const USAGE_KEY = "siteUsage";
const DEFAULT_BLOCKED_SITES = ["youtube.com", "x.com"];
const LIMIT_ALARM = "site-limit-check";
const CATEGORY_DEFINITIONS = [
  {
    id: "social-media",
    label: "Social media",
    hostnameKeywords: [
      "facebook",
      "instagram",
      "tiktok",
      "snapchat",
      "reddit",
      "discord",
      "x.com",
      "twitter",
      "threads",
      "pinterest",
      "linkedin"
    ],
    signalKeywords: [
      "social media",
      "followers",
      "following",
      "for you",
      "timeline",
      "feed",
      "reels",
      "shorts",
      "stories",
      "trending posts"
    ]
  },
  {
    id: "games",
    label: "Games",
    hostnameKeywords: [
      "crazygames",
      "poki",
      "steam",
      "epicgames",
      "roblox",
      "miniclip",
      "ign"
    ],
    signalKeywords: [
      "play now",
      "browser game",
      "multiplayer",
      "arcade game",
      "free online game",
      "walkthrough",
      "fps",
      "rpg",
      "battle royale",
      "game guide"
    ]
  },
  {
    id: "adult",
    label: "18+ / adult",
    hostnameKeywords: ["porn", "xxx", "hentai", "adult"],
    signalKeywords: [
      "18+",
      "nsfw",
      "adult videos",
      "explicit",
      "cam girls",
      "live sex",
      "porn videos",
      "xxx videos"
    ]
  },
  {
    id: "shopping",
    label: "Shopping",
    hostnameKeywords: [
      "amazon",
      "ebay",
      "etsy",
      "walmart",
      "target",
      "aliexpress",
      "bestbuy"
    ],
    signalKeywords: [
      "add to cart",
      "buy now",
      "free shipping",
      "checkout",
      "wishlist",
      "deals",
      "sale ends"
    ]
  },
  {
    id: "video-streaming",
    label: "Video streaming",
    hostnameKeywords: ["youtube", "netflix", "hulu", "twitch", "disneyplus", "primevideo"],
    signalKeywords: [
      "watch now",
      "full episode",
      "live stream",
      "streaming now",
      "recommended videos"
    ]
  }
];
const DEFAULT_SETTINGS = {
  scanOpenPages: true,
  scanGoogleSearches: false,
  enabledCategoryIds: ["social-media", "games", "adult"]
};
let activeSession = null;

chrome.runtime.onInstalled.addListener(async () => {
  const {
    [STORAGE_KEY]: blockedSites,
    [SETTINGS_KEY]: blockingSettings,
    [LIMITS_KEY]: siteLimits,
    [USAGE_KEY]: siteUsage
  } = await chrome.storage.sync.get([STORAGE_KEY, SETTINGS_KEY, LIMITS_KEY, USAGE_KEY]);

  if (!Array.isArray(blockedSites)) {
    await chrome.storage.sync.set({
      [STORAGE_KEY]: DEFAULT_BLOCKED_SITES
    });
  }

  if (!isValidSettings(blockingSettings)) {
    await chrome.storage.sync.set({
      [SETTINGS_KEY]: DEFAULT_SETTINGS
    });
  }

  if (!isValidLimits(siteLimits)) {
    await chrome.storage.sync.set({
      [LIMITS_KEY]: []
    });
  }

  if (!isValidUsage(siteUsage)) {
    await chrome.storage.sync.set({
      [USAGE_KEY]: {}
    });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await clearLimitAlarm();
  activeSession = null;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) {
    return;
  }

  const currentUrl = changeInfo.url;

  if (isExtensionPage(currentUrl)) {
    if (tab?.id && activeSession?.tabId === tab.id) {
      await stopActiveSession();
    }
    return;
  }

  const settings = await getBlockingSettings();
  const blockedSites = await getBlockedSites();
  const matchedSite = findBlockedMatch(currentUrl, blockedSites);
  const limitMatch = await getExceededLimitMatch(currentUrl);

  if (limitMatch) {
    if (activeSession?.tabId === tabId) {
      await stopActiveSession();
    }
    await redirectTab(tabId, currentUrl, {
      type: "limit",
      value: limitMatch.site,
      label: limitMatch.site,
      source: "daily-limit"
    });
    return;
  }

  if (!matchedSite) {
    const categoryMatch = classifyUrl(currentUrl, settings);

    if (categoryMatch) {
      if (activeSession?.tabId === tabId) {
        await stopActiveSession();
      }
      await redirectTab(tabId, currentUrl, {
        type: "category",
        value: categoryMatch.id,
        label: categoryMatch.label,
        source: categoryMatch.source
      });
    }

    if (tab?.active) {
      await syncActiveSession(tabId);
    }

    return;
  }

  if (activeSession?.tabId === tabId) {
    await stopActiveSession();
  }
  await redirectTab(tabId, currentUrl, {
    type: "site",
    value: matchedSite,
    label: matchedSite,
    source: "manual-list"
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await syncActiveSession(tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await stopActiveSession();
    return;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  await syncActiveSession(activeTab?.id ?? null);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (activeSession?.tabId === tabId) {
    await stopActiveSession();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== LIMIT_ALARM) {
    return;
  }

  await enforceActiveLimit();
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

  if (message?.type === "getBlockingSettings") {
    Promise.all([getBlockingSettings(), Promise.resolve(CATEGORY_DEFINITIONS)]).then(
      ([blockingSettings, categories]) => sendResponse({ blockingSettings, categories })
    );
    return true;
  }

  if (message?.type === "getSiteLimits") {
    Promise.all([getSiteLimits(), getSiteUsage()]).then(([siteLimits, siteUsage]) =>
      sendResponse({ siteLimits, siteUsage })
    );
    return true;
  }

  if (message?.type === "pageContentScan") {
    handlePageContentScan(message.page, _sender).then((result) => sendResponse(result));
    return true;
  }

  return false;
});

async function getBlockedSites() {
  const { [STORAGE_KEY]: blockedSites = [] } = await chrome.storage.sync.get(STORAGE_KEY);
  return blockedSites.filter(Boolean);
}

async function getSiteLimits() {
  const { [LIMITS_KEY]: siteLimits = [] } = await chrome.storage.sync.get(LIMITS_KEY);
  return Array.isArray(siteLimits)
    ? siteLimits
        .map((entry) => ({
          site: normalizeSite(entry?.site ?? ""),
          limitMinutes: Number(entry?.limitMinutes ?? 0)
        }))
        .filter((entry) => entry.site && Number.isFinite(entry.limitMinutes) && entry.limitMinutes > 0)
    : [];
}

async function getSiteUsage() {
  const { [USAGE_KEY]: siteUsage = {} } = await chrome.storage.sync.get(USAGE_KEY);
  return isValidUsage(siteUsage) ? siteUsage : {};
}

async function getBlockingSettings() {
  const { [SETTINGS_KEY]: storedSettings } = await chrome.storage.sync.get(SETTINGS_KEY);
  return mergeSettings(storedSettings);
}

function isExtensionPage(url) {
  return url.startsWith(chrome.runtime.getURL(""));
}

async function handlePageContentScan(page, sender) {
  if (!page?.url || !sender.tab?.id || sender.tab.url !== page.url) {
    return { blocked: false };
  }

  if (isExtensionPage(page.url)) {
    return { blocked: false };
  }

  const settings = await getBlockingSettings();

  if (!settings.scanOpenPages) {
    return { blocked: false };
  }

  const limitMatch = await getExceededLimitMatch(page.url);

  if (limitMatch) {
    await redirectTab(sender.tab.id, page.url, {
      type: "limit",
      value: limitMatch.site,
      label: limitMatch.site,
      source: "daily-limit"
    });
    return { blocked: true };
  }

  const siteMatch = findBlockedMatch(page.url, await getBlockedSites());

  if (siteMatch) {
    await redirectTab(sender.tab.id, page.url, {
      type: "site",
      value: siteMatch,
      label: siteMatch,
      source: "manual-list"
    });
    return { blocked: true };
  }

  const categoryMatch = classifyPage(page, settings);

  if (!categoryMatch) {
    return { blocked: false };
  }

  await redirectTab(sender.tab.id, page.url, {
    type: "category",
    value: categoryMatch.id,
    label: categoryMatch.label,
    source: categoryMatch.source
  });

  return { blocked: true };
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

async function getExceededLimitMatch(url) {
  const hostname = getHostname(url);

  if (!hostname) {
    return null;
  }

  const [siteLimits, siteUsage] = await Promise.all([getSiteLimits(), getSiteUsage()]);
  const matchedLimit = findLimitMatch(hostname, siteLimits);

  if (!matchedLimit) {
    return null;
  }

  const todayUsageMs = Number(siteUsage[getTodayUsageKey()]?.[matchedLimit.site] ?? 0);
  const limitMs = matchedLimit.limitMinutes * 60 * 1000;

  if (todayUsageMs >= limitMs) {
    return matchedLimit;
  }

  return null;
}

async function syncActiveSession(tabId) {
  await stopActiveSession();

  if (!tabId) {
    return;
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);

  if (!tab?.active || !tab.url || isExtensionPage(tab.url)) {
    return;
  }

  const hostname = getHostname(tab.url);

  if (!hostname) {
    return;
  }

  const siteLimits = await getSiteLimits();
  const matchedLimit = findLimitMatch(hostname, siteLimits);

  if (!matchedLimit) {
    await clearLimitAlarm();
    return;
  }

  const siteUsage = await getSiteUsage();
  const todayUsageMs = Number(siteUsage[getTodayUsageKey()]?.[matchedLimit.site] ?? 0);
  const limitMs = matchedLimit.limitMinutes * 60 * 1000;

  if (todayUsageMs >= limitMs) {
    await redirectTab(tab.id, tab.url, {
      type: "limit",
      value: matchedLimit.site,
      label: matchedLimit.site,
      source: "daily-limit"
    });
    return;
  }

  activeSession = {
    tabId: tab.id,
    site: matchedLimit.site,
    url: tab.url,
    startedAt: Date.now()
  };

  const remainingMs = Math.max(limitMs - todayUsageMs, 1000);
  await chrome.alarms.create(LIMIT_ALARM, {
    when: Date.now() + remainingMs
  });
}

async function stopActiveSession() {
  if (!activeSession) {
    await clearLimitAlarm();
    return;
  }

  const elapsedMs = Math.max(0, Date.now() - activeSession.startedAt);

  if (elapsedMs > 0) {
    await addUsage(activeSession.site, elapsedMs);
  }

  activeSession = null;
  await clearLimitAlarm();
}

async function enforceActiveLimit() {
  if (!activeSession) {
    return;
  }

  const session = activeSession;
  await stopActiveSession();

  const tab = await chrome.tabs.get(session.tabId).catch(() => null);

  if (!tab?.id || !tab.url) {
    return;
  }

  const limitMatch = await getExceededLimitMatch(tab.url);

  if (!limitMatch) {
    await syncActiveSession(tab.id);
    return;
  }

  await redirectTab(tab.id, tab.url, {
    type: "limit",
    value: limitMatch.site,
    label: limitMatch.site,
    source: "daily-limit"
  });
}

async function addUsage(site, elapsedMs) {
  const siteUsage = await getSiteUsage();
  const key = getTodayUsageKey();
  const usageForDay = { ...(siteUsage[key] ?? {}) };
  usageForDay[site] = Number(usageForDay[site] ?? 0) + elapsedMs;
  siteUsage[key] = usageForDay;
  await chrome.storage.sync.set({ [USAGE_KEY]: siteUsage });
}

function getTodayUsageKey() {
  return new Date().toISOString().slice(0, 10);
}

function findLimitMatch(hostname, siteLimits) {
  for (const entry of siteLimits) {
    if (hostname === entry.site || hostname.endsWith(`.${entry.site}`)) {
      return entry;
    }
  }

  return null;
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function classifyUrl(url, settings) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  if (settings.scanGoogleSearches && isGoogleSearch(parsed)) {
    const searchMatch = classifySearchQuery(parsed.searchParams.get("q") ?? "", settings);

    if (searchMatch) {
      return {
        ...searchMatch,
        source: "google-search"
      };
    }
  }

  if (!settings.scanOpenPages) {
    return null;
  }

  for (const category of getEnabledCategories(settings)) {
    const hostnameMatched = category.hostnameKeywords.some((keyword) =>
      hostname.includes(keyword)
    );
    const pathMatched = category.signalKeywords.some((keyword) => pathname.includes(keyword));

    if (hostnameMatched || pathMatched) {
      return {
        id: category.id,
        label: category.label,
        source: hostnameMatched ? "hostname" : "url-pattern"
      };
    }
  }

  return null;
}

function classifyPage(page, settings) {
  const categoryMatches = scoreCategories(page, settings);

  if (!categoryMatches.length) {
    return null;
  }

  const [bestMatch] = categoryMatches;

  if (bestMatch.score < 3) {
    return null;
  }

  return {
    id: bestMatch.id,
    label: bestMatch.label,
    source: "page-scan"
  };
}

function classifySearchQuery(query, settings) {
  const haystack = query.trim().toLowerCase();

  if (!haystack) {
    return null;
  }

  for (const category of getEnabledCategories(settings)) {
    const score = category.signalKeywords.reduce(
      (total, keyword) => total + (haystack.includes(keyword) ? 2 : 0),
      0
    );

    if (score >= 2 || category.hostnameKeywords.some((keyword) => haystack.includes(keyword))) {
      return {
        id: category.id,
        label: category.label
      };
    }
  }

  return null;
}

function scoreCategories(page, settings) {
  const normalizedUrl = safeLower(page.url);
  const signals = [
    safeLower(page.title),
    safeLower(page.metaDescription),
    safeLower(page.metaKeywords),
    safeLower(page.heading),
    safeLower(page.textSample)
  ];

  const matches = [];

  for (const category of getEnabledCategories(settings)) {
    let score = 0;

    for (const keyword of category.hostnameKeywords) {
      if (normalizedUrl.includes(keyword)) {
        score += 3;
      }
    }

    for (const keyword of category.signalKeywords) {
      for (const signal of signals) {
        if (signal.includes(keyword)) {
          score += signal === signals[4] ? 1 : 2;
        }
      }
    }

    if (score > 0) {
      matches.push({
        id: category.id,
        label: category.label,
        score
      });
    }
  }

  return matches.sort((left, right) => right.score - left.score);
}

function getEnabledCategories(settings) {
  const enabledIds = new Set(settings.enabledCategoryIds);
  return CATEGORY_DEFINITIONS.filter((category) => enabledIds.has(category.id));
}

function isGoogleSearch(parsedUrl) {
  return (
    parsedUrl.hostname.toLowerCase().includes("google.") &&
    parsedUrl.pathname.toLowerCase() === "/search"
  );
}

async function redirectTab(tabId, currentUrl, reason) {
  const redirectUrl = chrome.runtime.getURL(
    `${BLOCKED_PAGE}?url=${encodeURIComponent(currentUrl)}&reasonType=${encodeURIComponent(
      reason.type
    )}&reasonValue=${encodeURIComponent(reason.value)}&reasonLabel=${encodeURIComponent(
      reason.label
    )}&source=${encodeURIComponent(reason.source)}`
  );

  await chrome.tabs.update(tabId, { url: redirectUrl });
}

async function clearLimitAlarm() {
  await chrome.alarms.clear(LIMIT_ALARM);
}

function mergeSettings(settings) {
  const normalized = isValidSettings(settings) ? settings : {};
  const enabledIds = Array.isArray(normalized.enabledCategoryIds)
    ? normalized.enabledCategoryIds.filter((id) =>
        CATEGORY_DEFINITIONS.some((category) => category.id === id)
      )
    : DEFAULT_SETTINGS.enabledCategoryIds;

  return {
    scanOpenPages:
      typeof normalized.scanOpenPages === "boolean"
        ? normalized.scanOpenPages
        : DEFAULT_SETTINGS.scanOpenPages,
    scanGoogleSearches:
      typeof normalized.scanGoogleSearches === "boolean"
        ? normalized.scanGoogleSearches
        : DEFAULT_SETTINGS.scanGoogleSearches,
    enabledCategoryIds: enabledIds
  };
}

function isValidSettings(settings) {
  return Boolean(settings && typeof settings === "object");
}

function isValidLimits(siteLimits) {
  return Array.isArray(siteLimits);
}

function isValidUsage(siteUsage) {
  return Boolean(siteUsage && typeof siteUsage === "object" && !Array.isArray(siteUsage));
}

function safeLower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}
