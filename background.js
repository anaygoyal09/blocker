const BLOCKED_PAGE = "blocked.html";
const STORAGE_KEY = "blockedSites";
const SETTINGS_KEY = "blockingSettings";
const DEFAULT_BLOCKED_SITES = ["youtube.com", "x.com"];
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

chrome.runtime.onInstalled.addListener(async () => {
  const { [STORAGE_KEY]: blockedSites, [SETTINGS_KEY]: blockingSettings } =
    await chrome.storage.sync.get([STORAGE_KEY, SETTINGS_KEY]);

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
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) {
    return;
  }

  const currentUrl = changeInfo.url;

  if (isExtensionPage(currentUrl)) {
    return;
  }

  const settings = await getBlockingSettings();
  const blockedSites = await getBlockedSites();
  const matchedSite = findBlockedMatch(currentUrl, blockedSites);

  if (!matchedSite) {
    const categoryMatch = classifyUrl(currentUrl, settings);

    if (categoryMatch) {
      await redirectTab(tabId, currentUrl, {
        type: "category",
        value: categoryMatch.id,
        label: categoryMatch.label,
        source: categoryMatch.source
      });
    }

    return;
  }

  await redirectTab(tabId, currentUrl, {
    type: "site",
    value: matchedSite,
    label: matchedSite,
    source: "manual-list"
  });
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

function safeLower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}
