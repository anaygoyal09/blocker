const STORAGE_KEY = "blockedSites";

const form = document.getElementById("site-form");
const siteInput = document.getElementById("site-input");
const siteList = document.getElementById("site-list");
const status = document.getElementById("status");
const emptyState = document.getElementById("empty-state");
const countBadge = document.getElementById("count-badge");

await render();

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

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
