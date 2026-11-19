const AUTO_CLOSE_ALARM = "auto-close-stale-tabs";
const tabCreationQueues = new Map();

async function initializeTab(current, tab) {
  await assignTab(current, tab.id, await resolveTabWorkspace(current, tab));
  await writeClock(tab.id, { createdAt: Date.now() });
  await save(current);
}

async function collapseStartPages(tab) {
  const current = await state();
  const workspace = current.tabWorkspaces[tab.id];
  const startTabs = (await browser.tabs.query({ windowId: tab.windowId })).filter(candidate =>
    !candidate.pinned && isFirefoxStartPage(candidate.url) && current.tabWorkspaces[candidate.id] === workspace
  );
  if (startTabs.length < 2) {
    return;
  }
  const keep = startTabs.find(candidate => candidate.active) ||
    startTabs.reduce((first, second) => (second.index < first.index ? second : first));
  await closeTabs(startTabs.filter(candidate => candidate.id !== keep.id));
}

function enqueueTabCreation(tab) {
  const previous = tabCreationQueues.get(tab.windowId) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    await switchingTasks.get(tab.windowId)?.catch(() => {});
    await initializeTab(await state(), tab);
    if (isFirefoxStartPage(tab.url)) {
      await collapseStartPages(tab);
    }
  });
  tabCreationQueues.set(tab.windowId, task);
  const release = () => {
    if (tabCreationQueues.get(tab.windowId) === task) {
      tabCreationQueues.delete(tab.windowId);
    }
  };
  task.then(release, release);
  return task;
}

async function restoreTabs() {
  const current = await state();
  const now = Date.now();
  for (const tab of await browser.tabs.query({})) {
    await assignTab(current, tab.id, await resolveTabWorkspace(current, tab));
    const clock = await readClock(tab.id);
    const patch = {};
    if (!clock.createdAt) {
      patch.createdAt = now;
    }
    if (!clock.lastActive && (tab.active || !clock.createdAt)) {
      patch.lastActive = now;
    }
    await writeClock(tab.id, patch);
  }
  for (const { id } of await browser.windows.getAll()) {
    for (const workspace of current.workspaces) {
      const tabId = await browser.sessions.getWindowValue(id, `workspace-active-tab:${workspace}`);
      const key = activeTabKey(id, workspace);
      if (tabId && !current.workspaceActiveTab[key]) {
        current.workspaceActiveTab[key] = tabId;
      }
    }
  }
  await save(current);
}

async function closeExpiredTabs() {
  const current = await state();
  await closeTabs(await findExpiredTabs(current, await browser.tabs.query({})));
}

async function startUp({ reapply }) {
  await restoreTabs();
  await updateWorkspaceMenu();
  await browser.alarms.create(AUTO_CLOSE_ALARM, { periodInMinutes: 1 });
  await ensurePinnedTabsEverywhere();
  const current = await state();
  for (const { id } of await browser.windows.getAll()) {
    const workspace = await activeWorkspaceForWindow(current, id);
    if (reapply) {
      await showWorkspace(workspace, id);
    } else {
      await updateWorkspaceIndicator(current, workspace, id);
    }
  }
}

async function openCommandPalette() {
  const windows = await browser.windows.getAll({ populate: true });
  const open = windows.find(window =>
    window.tabs.some(tab => tab.url && new URL(tab.url).pathname.endsWith("/palette.html"))
  );
  if (open) {
    await browser.windows.remove(open.id);
    return;
  }
  const parent = await activeBrowserWindow();
  const width = 600;
  const height = 680;
  const left = Math.round(parent.left + (parent.width - width) / 2);
  const top = Math.round(parent.top + (parent.height - height) / 2);
  const palette = await browser.windows.create({
    url: `${browser.runtime.getURL("palette.html")}?windowId=${parent.id}`,
    type: "popup",
    width,
    height,
    left,
    top,
  });
  await browser.windows.update(palette.id, { left, top, width, height });
}

browser.runtime.onInstalled.addListener(() => startUp({ reapply: false }));
browser.runtime.onStartup.addListener(() => startUp({ reapply: true }));

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === AUTO_CLOSE_ALARM) {
    closeExpiredTabs();
    ensurePinnedTabsEverywhere();
  }
});

browser.tabs.onCreated.addListener(enqueueTabCreation);

browser.tabs.onRemoved.addListener(async (tabId, { windowId, isWindowClosing }) => {
  const current = await state();
  delete current.tabWorkspaces[tabId];
  await save(current);
  if (!isWindowClosing) {
    lastEnsure.delete(windowId);
    setTimeout(() => ensurePinnedTabs(windowId), 500);
  }
});

browser.windows.onCreated.addListener(window => {
  if (window.type === "normal") {
    setTimeout(() => ensurePinnedTabs(window.id), 1000);
  }
});

browser.tabs.onActivated.addListener(async ({ tabId, windowId, previousTabId }) => {
  const now = Date.now();
  if (previousTabId) {
    await writeClock(previousTabId, { lastActive: now });
  }
  await writeClock(tabId, { lastActive: now });
  if (switchingWindows.has(windowId)) {
    return;
  }
  const current = await state();
  await rememberActiveTab(current, windowId, await activeWorkspaceForWindow(current, windowId), tabId);
  await save(current);
});

async function focusExistingTab(existing, duplicate) {
  const current = await state();
  const owner = current.tabWorkspaces[existing.id];
  const windowId = duplicate.windowId;
  if (!existing.pinned && isWorkspace(current, owner) && owner !== await activeWorkspaceForWindow(current, windowId)) {
    await showWorkspace(owner, windowId);
  }
  await browser.tabs.show([existing.id]).catch(() => {});
  await browser.tabs.update(existing.id, { active: true });
  await browser.tabs.remove(duplicate.id).catch(() => {});
}

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url || changeInfo.url === "about:blank") {
    return;
  }
  const current = await state();
  const routed = findMatchingRule(current.trafficRules, changeInfo.url)?.workspace;
  const workspace = routed ||
    (isWorkspace(current, current.tabWorkspaces[tabId]) && current.tabWorkspaces[tabId]) ||
    await activeWorkspaceForWindow(current, tab.windowId);
  await assignTab(current, tabId, workspace);
  await save(current);

  if (routed && routed !== await activeWorkspaceForWindow(current, tab.windowId)) {
    await showWorkspace(routed, tab.windowId);
  }
  if (tab.pinned || findMatchingRule(current.duplicateRules, changeInfo.url)) {
    return;
  }
  const siblings = await browser.tabs.query({ windowId: tab.windowId });
  const existing = findDuplicateTab(current, siblings, tab, changeInfo.url, workspace);
  if (existing) {
    await focusExistingTab(existing, tab);
  }
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) {
    return;
  }
  const [action, workspace] = String(info.menuItemId).split(/:(.+)/);
  if (action === "move-to-workspace") {
    const highlighted = await browser.tabs.query({ windowId: tab.windowId, highlighted: true });
    await moveTabsToWorkspace(highlighted.some(candidate => candidate.id === tab.id) ? highlighted : [tab], workspace);
  } else if (action === "open-link-in-workspace") {
    if (isWorkspace(await state(), workspace)) {
      await openInWorkspace(workspace, tab.windowId, info.linkUrl);
    }
  } else if (action === "add-current-tab-favorite") {
    await addTabToFavorites(tab);
  }
});

browser.contextMenus.onShown.addListener(async (info, tab) => {
  if (!tab) {
    return;
  }
  const current = await state();
  const workspace = current.tabWorkspaces[tab.id] || DEFAULT_WORKSPACE;
  await browser.contextMenus.update("workspace-membership", { title: `Workspace: ${workspace}` });
  browser.contextMenus.refresh();
});

async function activeTabOf(windowId) {
  const [tab] = await browser.tabs.query({ active: true, windowId });
  return tab;
}

const COMMANDS = {
  "command-palette": () => openCommandPalette(),
  "next-workspace": windowId => switchRelative(windowId, 1),
  "previous-workspace": windowId => switchToPrevious(windowId),
  "open-all-favorites": async windowId => {
    const current = await state();
    await openAllFavorites(await activeWorkspaceForWindow(current, windowId), windowId);
  },
  "add-current-tab-favorite": async windowId => addTabToFavorites(await activeTabOf(windowId)),
};

browser.commands.onCommand.addListener(async command => {
  const handler = COMMANDS[command];
  if (handler) {
    await handler((await activeBrowserWindow()).id);
  }
});

function createRule(list, { ruleType, value, ...extra }) {
  const normalized = normalizeRuleValue(ruleType, value.trim());
  if (!normalized) {
    return null;
  }
  const existing = list.find(rule => rule.type === ruleType && rule.value === normalized);
  if (existing) {
    Object.assign(existing, extra);
  } else {
    list.push({ id: crypto.randomUUID(), type: ruleType, value: normalized, ...extra });
  }
  return { ok: true };
}

async function cleanTabs(current, windowId, kinds) {
  const workspace = await activeWorkspaceForWindow(current, windowId);
  const tabs = await browser.tabs.query({ windowId });
  return { closed: await closeTabs(await findExpiredTabs(current, tabs, { workspace, kinds })) };
}

const MESSAGES = {
  "get-state": async (current, { windowId }) => ({
    ...current,
    activeWorkspace: await activeWorkspaceForWindow(current, windowId),
  }),

  "create-traffic-rule": async (current, message) => {
    if (!isWorkspace(current, message.workspace)) {
      return undefined;
    }
    const result = createRule(current.trafficRules, { ruleType: message.ruleType, value: message.value, workspace: message.workspace });
    await save(current);
    return result;
  },
  "create-duplicate-rule": async (current, message) => {
    const result = createRule(current.duplicateRules, message);
    await save(current);
    return result;
  },
  "remove-traffic-rule": async (current, { id }) => {
    current.trafficRules = current.trafficRules.filter(rule => rule.id !== id);
    await save(current);
    return { ok: true };
  },
  "export-config": current => exportConfig(current),
  "import-config": (current, { data }) => importConfig(current, data),
  "add-pinned-tab": (current, { url }) => addPinnedTab(current, url),
  "remove-pinned-tab": (current, { id }) => removePinnedTab(current, id),
  "remove-duplicate-rule": async (current, { id }) => {
    current.duplicateRules = current.duplicateRules.filter(rule => rule.id !== id);
    await save(current);
    return { ok: true };
  },

  "open-favorite": (current, { workspace, windowId, url }) => openInWorkspace(workspace, windowId, url),
  "open-all-favorites": (current, { workspace, windowId }) => openAllFavorites(workspace, windowId),
  "open-all-active-favorites": async (current, { windowId }) =>
    openAllFavorites(await activeWorkspaceForWindow(current, windowId), windowId),
  "add-active-tab-favorite": async (current, { windowId }) => addTabToFavorites(await activeTabOf(windowId)),
  "remove-favorite": async (current, { workspace, url }) => {
    current.workspaceFavorites[workspace] = (current.workspaceFavorites[workspace] || [])
      .filter(favorite => favorite.url !== url);
    await save(current);
  },
  "move-favorite": async (current, { workspace, url, direction }) => {
    const favorites = current.workspaceFavorites[workspace] || [];
    const index = favorites.findIndex(favorite => favorite.url === url);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= favorites.length) {
      return;
    }
    [favorites[index], favorites[target]] = [favorites[target], favorites[index]];
    await save(current);
  },

  "clean-inactive-tabs": (current, { windowId }) => cleanTabs(current, windowId, ["visited"]),
  "clean-unvisited-tabs": (current, { windowId }) => cleanTabs(current, windowId, ["unvisited"]),

  "switch-workspace": (current, { workspace, windowId }) => showWorkspace(workspace, windowId),
  "switch-previous-workspace": (current, { windowId }) => switchToPrevious(windowId),
  "create-workspace": (current, { name, windowId }) => createWorkspace(current, name, windowId),
  "rename-workspace": (current, { workspace, name, windowId }) => renameWorkspace(current, workspace, name, windowId),
  "delete-workspace": (current, { workspace }) => deleteWorkspace(current, workspace),
  "set-workspace-style": (current, { workspace, icon, color, windowId }) =>
    setWorkspaceStyle(current, workspace, icon, color, windowId),
  "move-active-tab": async (current, { workspace, windowId }) => {
    const tab = await activeTabOf(windowId);
    if (tab) {
      await moveTabsToWorkspace([tab], workspace);
    }
  },
};

browser.runtime.onMessage.addListener(async message => {
  const handler = MESSAGES[message.type];
  if (!handler) {
    return undefined;
  }
  const window = await activeBrowserWindow(message.windowId);
  return handler(await state(), { ...message, windowId: window.id });
});
