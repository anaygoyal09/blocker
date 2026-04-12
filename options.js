const STORAGE_KEY = "blockedSites";
const SETTINGS_KEY = "blockingSettings";

const form = document.getElementById("site-form");
const siteInput = document.getElementById("site-input");
const siteList = document.getElementById("site-list");
const status = document.getElementById("status");
const emptyState = document.getElementById("empty-state");
const countBadge = document.getElementById("count-badge");
const scanOpenPagesInput = document.getElementById("scan-open-pages");
const scanGoogleSearchesInput = document.getElementById("scan-google-searches");
const categoryList = document.getElementById("category-list");

const { blockingSettings, categories } = await chrome.runtime.sendMessage({
  type: "getBlockingSettings"
});

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

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === "sync" && changes[STORAGE_KEY]) {
    await render();
  }

  if (areaName === "sync" && changes[SETTINGS_KEY]) {
    Object.assign(blockingSettings, changes[SETTINGS_KEY].newValue ?? {});
    renderCategoryControls();
  }
});

async function render() {
  const blockedSites = await getBlockedSites();
  siteList.innerHTML = "";
  countBadge.textContent = `${blockedSites.length} ${blockedSites.length === 1 ? "site" : "sites"}`;
  emptyState.hidden = blockedSites.length > 0;

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

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
