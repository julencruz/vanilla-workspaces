const PINNED_ENSURE_COOLDOWN_MS = 4000;
const lastEnsure = new Map();

function normalizePinnedUrl(value) {
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function pinnedKey(url) {
  try {
    return normalizedUrl(url);
  } catch {
    return url;
  }
}

const ensureQueues = new Map();

function ensurePinnedTabs(windowId, options = {}) {
  const run = (ensureQueues.get(windowId) || Promise.resolve()).then(() => runEnsurePinnedTabs(windowId, options));
  const settled = run.catch(error => console.error("ensurePinnedTabs failed", error));
  ensureQueues.set(windowId, settled);
  return settled;
}

async function runEnsurePinnedTabs(windowId, { force = false }) {
  const current = await state();
  if (!current.pinnedTabs.length) {
    return;
  }
  const now = Date.now();
  if (!force && now - (lastEnsure.get(windowId) || 0) < PINNED_ENSURE_COOLDOWN_MS) {
    return;
  }
  lastEnsure.set(windowId, now);

  const tabs = await browser.tabs.query({ windowId });
  const claimedTabs = new Set();
  for (const entry of current.pinnedTabs) {
    const key = pinnedKey(entry.url);
    const matching = tabs.filter(tab => tab.url && !claimedTabs.has(tab.id) && pinnedEntryMatchesUrl(entry, tab.url));
    const existing = matching.find(tab => tab.pinned) || matching[0];
    if (existing) {
      claimedTabs.add(existing.id);
      if (!existing.pinned) {
        await browser.tabs.update(existing.id, { pinned: true }).catch(() => {});
      }
      continue;
    }
    const created = await browser.tabs.create({ windowId, url: entry.url, active: false, pinned: true })
      .catch(error => console.error("could not create pinned tab", entry.url, error));
    if (created) {
      tabs.push(created);
    }
  }
}

async function ensurePinnedTabsEverywhere(options) {
  for (const { id, type } of await browser.windows.getAll()) {
    if (type === "normal") {
      await ensurePinnedTabs(id, options);
    }
  }
}

async function addPinnedTab(current, rawUrl) {
  const url = normalizePinnedUrl(rawUrl.trim());
  if (!url) {
    return null;
  }
  if (!current.pinnedTabs.some(entry => pinnedKey(entry.url) === pinnedKey(url))) {
    current.pinnedTabs.push({ id: crypto.randomUUID(), url, matchMode: "url" });
    await save(current);
  }
  await ensurePinnedTabsEverywhere({ force: true });
  return { ok: true };
}

async function setPinnedMatchMode(current, id, matchMode) {
  if (!["url", "site"].includes(matchMode)) {
    return { ok: false };
  }
  const entry = current.pinnedTabs.find(candidate => candidate.id === id);
  if (!entry) {
    return { ok: false };
  }
  entry.matchMode = matchMode;
  await save(current);
  await ensurePinnedTabsEverywhere({ force: true });
  return { ok: true };
}

async function removePinnedTab(current, id) {
  current.pinnedTabs = current.pinnedTabs.filter(entry => entry.id !== id);
  await save(current);
  return { ok: true };
}
