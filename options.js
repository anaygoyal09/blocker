const STORAGE_KEY = "blockedSites";
const SETTINGS_KEY = "blockingSettings";
const LIMITS_KEY = "siteLimits";

const form = document.getElementById("site-form");
const siteInput = document.getElementById("site-input");
const siteList = document.getElementById("site-list");
const limitForm = document.getElementById("limit-form");
const limitSiteInput = document.getElementById("limit-site-input");
const limitMinutesInput = document.getElementById("limit-minutes-input");
const limitList = document.getElementById("limit-list");
const limitsEmptyState = document.getElementById("limits-empty-state");
const limitCountBadge = document.getElementById("limit-count-badge");
const status = document.getElementById("status");
const emptyState = document.getElementById("empty-state");
const countBadge = document.getElementById("count-badge");
const scanOpenPagesInput = document.getElementById("scan-open-pages");
const scanGoogleSearchesInput = document.getElementById("scan-google-searches");
const categoryList = document.getElementById("category-list");

const { blockingSettings, categories } = await loadBlockingSettings();

await render();
renderCategoryControls();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const normalizedSite = normalizeSite(siteInput.value);

  if (!normalizedSite) {
    setStatus("Enter a valid hostname like example.com.");
    return;
  }

  const blockedSites = await getBlockedSites();

  if (blockedSites.includes(normalizedSite)) {
    setStatus(`${normalizedSite} is already blocked.`);
    siteInput.select();
    return;
  }

  const nextSites = [...blockedSites, normalizedSite].sort((left, right) =>
    left.localeCompare(right)
  );

  await chrome.storage.sync.set({ [STORAGE_KEY]: nextSites });
  siteInput.value = "";
  setStatus(`${normalizedSite} will now be interrupted.`);
  await render();
});

limitForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const normalizedSite = normalizeSite(limitSiteInput.value);
  const limitMinutes = Number.parseInt(limitMinutesInput.value, 10);

  if (!normalizedSite) {
    setStatus("Enter a valid hostname for the limit, like youtube.com.");
    return;
  }

  if (!Number.isFinite(limitMinutes) || limitMinutes <= 0) {
    setStatus("Enter a daily limit above 0 minutes.");
    return;
  }

  const siteLimits = await getSiteLimits();
  const nextLimits = siteLimits.filter((entry) => entry.site !== normalizedSite);
  nextLimits.push({ site: normalizedSite, limitMinutes });
  nextLimits.sort((left, right) => left.site.localeCompare(right.site));

  await chrome.storage.sync.set({ [LIMITS_KEY]: nextLimits });
  limitSiteInput.value = "";
  limitMinutesInput.value = "";
  setStatus(`${normalizedSite} is now limited to ${limitMinutes} minutes per day.`);
  await render();
});

scanOpenPagesInput.addEventListener("change", async () => {
  const nextSettings = {
    ...blockingSettings,
    scanOpenPages: scanOpenPagesInput.checked
  };
  await saveBlockingSettings(nextSettings);
});

scanGoogleSearchesInput.addEventListener("change", async () => {
  const nextSettings = {
    ...blockingSettings,
    scanGoogleSearches: scanGoogleSearchesInput.checked
  };
  await saveBlockingSettings(nextSettings);
});

categoryList.addEventListener("change", async (event) => {
  const input = event.target.closest("input[data-category-id]");

  if (!input) {
    return;
  }

  const categoryId = input.dataset.categoryId;
  const nextEnabledIds = new Set(blockingSettings.enabledCategoryIds);

  if (input.checked) {
    nextEnabledIds.add(categoryId);
  } else {
    nextEnabledIds.delete(categoryId);
  }

  await saveBlockingSettings({
    ...blockingSettings,
    enabledCategoryIds: [...nextEnabledIds]
  });
});

siteList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-site]");

  if (!button) {
    return;
  }

  const siteToRemove = button.dataset.site;
  const blockedSites = await getBlockedSites();
  const nextSites = blockedSites.filter((site) => site !== siteToRemove);

  await chrome.storage.sync.set({ [STORAGE_KEY]: nextSites });
  setStatus(`${siteToRemove} was removed from your block list.`);
  await render();
});

limitList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-limit-site]");

  if (!button) {
    return;
  }

  const siteToRemove = button.dataset.limitSite;
  const siteLimits = await getSiteLimits();
  const nextLimits = siteLimits.filter((entry) => entry.site !== siteToRemove);

  await chrome.storage.sync.set({ [LIMITS_KEY]: nextLimits });
  setStatus(`${siteToRemove} no longer has a daily limit.`);
  await render();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === "sync" && changes[STORAGE_KEY]) {
    await render();
  }

  if (areaName === "sync" && changes[LIMITS_KEY]) {
    await render();
  }

  if (areaName === "sync" && changes[SETTINGS_KEY]) {
    Object.assign(blockingSettings, changes[SETTINGS_KEY].newValue ?? {});
    renderCategoryControls();
  }
});

async function render() {
  const [blockedSites, siteLimits, siteUsage] = await Promise.all([
    getBlockedSites(),
    getSiteLimits(),
    getSiteUsage()
  ]);
  siteList.innerHTML = "";
  limitList.innerHTML = "";
  countBadge.textContent = `${blockedSites.length} ${blockedSites.length === 1 ? "site" : "sites"}`;
  limitCountBadge.textContent = `${siteLimits.length} ${siteLimits.length === 1 ? "limit" : "limits"}`;
  emptyState.hidden = blockedSites.length > 0;
  limitsEmptyState.hidden = siteLimits.length > 0;

  for (const site of blockedSites) {
    const item = document.createElement("li");
    item.className = "site-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(site)}</strong>
        <span>Blocks ${escapeHtml(site)} and any subdomain under it.</span>
      </div>
      <button type="button" class="remove-button" data-site="${escapeHtml(site)}">Remove</button>
    `;
    siteList.appendChild(item);
  }

  const todayUsage = siteUsage[getTodayUsageKey()] ?? {};

  for (const entry of siteLimits) {
    const usedMinutes = Math.floor(Number(todayUsage[entry.site] ?? 0) / 60000);
    const item = document.createElement("li");
    item.className = "site-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(entry.site)}</strong>
        <span>${usedMinutes} / ${entry.limitMinutes} minutes used today.</span>
      </div>
      <button type="button" class="remove-button" data-limit-site="${escapeHtml(entry.site)}">Remove</button>
    `;
    limitList.appendChild(item);
  }
}

function renderCategoryControls() {
  scanOpenPagesInput.checked = Boolean(blockingSettings.scanOpenPages);
  scanGoogleSearchesInput.checked = Boolean(blockingSettings.scanGoogleSearches);
  categoryList.innerHTML = "";

  for (const category of categories) {
    const enabled = blockingSettings.enabledCategoryIds.includes(category.id);
    const label = document.createElement("label");
    label.className = "category-card";
    label.innerHTML = `
      <input type="checkbox" data-category-id="${escapeHtml(category.id)}" ${enabled ? "checked" : ""} />
      <div>
        <strong>${escapeHtml(category.label)}</strong>
        <span>Auto-block pages the local classifier thinks fit this category.</span>
      </div>
    `;
    categoryList.appendChild(label);
  }
}

async function getBlockedSites() {
  const { [STORAGE_KEY]: blockedSites = [] } = await chrome.storage.sync.get(STORAGE_KEY);
  return blockedSites.filter(Boolean);
}

async function getSiteLimits() {
  const { [LIMITS_KEY]: siteLimits = [] } = await chrome.storage.sync.get(LIMITS_KEY);
  return Array.isArray(siteLimits) ? siteLimits.filter((entry) => entry?.site) : [];
}

async function getSiteUsage() {
  const { siteUsage = {} } = await chrome.storage.sync.get("siteUsage");
  return siteUsage && typeof siteUsage === "object" && !Array.isArray(siteUsage) ? siteUsage : {};
}

async function loadBlockingSettings() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "getBlockingSettings"
    });

    if (response?.blockingSettings && Array.isArray(response?.categories)) {
      return response;
    }
  } catch {
    // Fall through to safe defaults so the options page remains usable.
  }

  return {
    blockingSettings: {
      scanOpenPages: true,
      scanGoogleSearches: false,
      enabledCategoryIds: ["social-media", "games", "adult"]
    },
    categories: [
      { id: "social-media", label: "Social media" },
      { id: "games", label: "Games" },
      { id: "adult", label: "18+ / adult" },
      { id: "shopping", label: "Shopping" },
      { id: "video-streaming", label: "Video streaming" }
    ]
  };
}

function normalizeSite(input) {
  const trimmed = input.trim().toLowerCase();

  if (!trimmed) {
    return "";
  }

  try {
    const maybeUrl = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return new URL(maybeUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function setStatus(message) {
  status.textContent = message;
}

async function saveBlockingSettings(nextSettings) {
  Object.assign(blockingSettings, nextSettings);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: blockingSettings });
  renderCategoryControls();
  setStatus("Smart blocking settings updated.");
}

function getTodayUsageKey() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
