const AUTO_CLOSE_MS = 120 * 60 * 1000;
const UNVISITED_CLOSE_MS = 30 * 60 * 1000;
const MEDIA_SCRIPT_TIMEOUT_MS = 1500;

const CLOCK_KEYS = Object.freeze({
  createdAt: KEYS.createdAt,
  lastActive: KEYS.lastActive,
  pausedAt: KEYS.pausedAt,
});

async function readClock(tabId) {
  const entries = await Promise.all(Object.entries(CLOCK_KEYS).map(async ([field, key]) => [
    field,
    await browser.sessions.getTabValue(tabId, key).catch(() => undefined),
  ]));
  return Object.fromEntries(entries);
}

async function writeClock(tabId, patch) {
  await Promise.all(Object.entries(patch).map(([field, value]) => (
    value == null
      ? browser.sessions.removeTabValue(tabId, CLOCK_KEYS[field])
      : browser.sessions.setTabValue(tabId, CLOCK_KEYS[field], value)
  ).catch(() => {})));
}

function expiryKind(clock, now) {
  if (clock.lastActive) {
    return now - clock.lastActive > AUTO_CLOSE_MS ? "visited" : null;
  }
  return clock.createdAt && now - clock.createdAt > UNVISITED_CLOSE_MS ? "unvisited" : null;
}

async function findExpiredTabs(current, tabs, { workspace, kinds = ["visited", "unvisited"], now = Date.now() } = {}) {
  const expired = [];
  for (const tab of tabs) {
    if (tab.pinned || tab.active || tab.audible || tab.hidden) {
      continue;
    }
    const tabWorkspace = current.tabWorkspaces[tab.id];
    if (!isWorkspace(current, tabWorkspace) || (workspace && tabWorkspace !== workspace)) {
      continue;
    }
    if (isFavoriteUrl(current, tabWorkspace, tab.url)) {
      continue;
    }
    if (kinds.includes(expiryKind(await readClock(tab.id), now))) {
      expired.push(tab);
    }
  }
  return expired;
}

async function closeTabs(tabs) {
  if (tabs.length) {
    await browser.tabs.remove(tabs.map(tab => tab.id));
  }
  return tabs.length;
}

function pauseMediaInPage() {
  const playing = [...document.querySelectorAll("audio,video")].filter(media => !media.paused && !media.ended);
  playing.forEach(media => media.pause());
  globalThis.__vanillaPausedMedia = [...(globalThis.__vanillaPausedMedia || []), ...playing];
}

function resumeMediaInPage() {
  const paused = globalThis.__vanillaPausedMedia || [];
  globalThis.__vanillaPausedMedia = [];
  paused.forEach(media => {
    if (media.isConnected && media.paused && !media.ended) {
      media.play().catch(() => {});
    }
  });
}

function setMediaPlaying(tabId, playing) {
  const run = browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: playing ? resumeMediaInPage : pauseMediaInPage,
  });
  const timeout = new Promise(resolve => setTimeout(resolve, MEDIA_SCRIPT_TIMEOUT_MS));
  return Promise.race([run, timeout]).catch(() => {});
}

async function pauseTab(tab, now) {
  if (tab.hidden || tab.pinned) {
    return;
  }
  await writeClock(tab.id, { pausedAt: now });
  void setMediaPlaying(tab.id, false);
}

async function resumeTab(tab, now) {
  if (!tab.hidden) {
    return;
  }
  const clock = await readClock(tab.id);
  const patch = { pausedAt: null };
  const idleFor = clock.pausedAt ? Math.max(0, now - clock.pausedAt) : null;
  for (const field of ["lastActive", "createdAt"]) {
    if (clock[field]) {
      patch[field] = idleFor === null ? now : clock[field] + idleFor;
    }
  }
  await writeClock(tab.id, patch);
  if (clock.pausedAt) {
    void setMediaPlaying(tab.id, true);
  }
}
