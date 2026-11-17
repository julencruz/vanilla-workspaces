const DEFAULT_WORKSPACE = "General";
const WORKSPACE_KEY = "vanilla-workspace";
const WINDOW_WORKSPACE_KEY = "vanilla-active-workspace";
const DEFAULT_WORKSPACE_STYLE = { icon: "●", color: "#0060df" };
const PINNED_APP_HOSTS = new Set(["calendar.google.com", "gemini.google.com"]);
let switchingWorkspace = false;

async function state() {
  const stored = await browser.storage.local.get({
    workspaces: [DEFAULT_WORKSPACE],
    activeWorkspaces: {},
    tabWorkspaces: {},
    workspaceStyles: { [DEFAULT_WORKSPACE]: DEFAULT_WORKSPACE_STYLE },
    workspaceFavorites: {},
    trafficRules: [],
    duplicateRules: [],
    tabLastActive: {},
    workspaceActiveTab: {},
  });

  return stored;
}

function workspaceForWindow(current, windowId) {
  const workspace = current.activeWorkspaces[windowId];
  return current.workspaces.includes(workspace) ? workspace : current.workspaces[0];
}

async function updateWorkspaceIndicator(workspace, windowId) {
  const current = await state();
  const style = current.workspaceStyles[workspace] || DEFAULT_WORKSPACE_STYLE;
  const icon = new OffscreenCanvas(32, 32);
  const context = icon.getContext("2d");
  context.clearRect(0, 0, 32, 32);
  context.fillStyle = style.color;
  context.beginPath();
  context.roundRect(2, 2, 28, 28, 9);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "18px system-ui, Apple Color Emoji, Segoe UI Emoji";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(style.icon, 16, 16.5);
  await browser.action.setIcon({ imageData: context.getImageData(0, 0, 32, 32), windowId });
  await browser.action.setBadgeText({ text: "", windowId });
  await browser.action.setTitle({ title: `Workspace: ${workspace}`, windowId });
}

async function activeWorkspaceForWindow(current, windowId) {
  const stored = await browser.sessions.getWindowValue(windowId, WINDOW_WORKSPACE_KEY);
  return current.workspaces.includes(stored) ? stored : workspaceForWindow(current, windowId);
}

async function activeBrowserWindow() {
  const windows = await browser.windows.getAll();
  return windows.find(window => window.focused && window.type === "normal") ||
    windows.find(window => window.type === "normal") ||
    browser.windows.getLastFocused();
}

async function save({ workspaces, activeWorkspaces, tabWorkspaces, workspaceStyles, workspaceFavorites, trafficRules, duplicateRules, tabLastActive, workspaceActiveTab }) {
  await browser.storage.local.set({ workspaces, activeWorkspaces, tabWorkspaces, workspaceStyles, workspaceFavorites, trafficRules, duplicateRules, tabLastActive, workspaceActiveTab });
}

async function assign(tabId, workspace) {
  const current = await state();
  current.tabWorkspaces[tabId] = workspace;
  await browser.sessions.setTabValue(tabId, WORKSPACE_KEY, workspace);
  await save(current);
}

async function moveTabsToWorkspace(tabs, workspace) {
  const current = await state();
  if (!current.workspaces.includes(workspace)) {
    return;
  }

  const movableTabs = tabs.filter(tab => !tab.pinned);
  for (const tab of movableTabs) {
    current.tabWorkspaces[tab.id] = workspace;
    await browser.sessions.setTabValue(tab.id, WORKSPACE_KEY, workspace);
  }
  await save(current);
  const windowId = tabs[0]?.windowId;
  if (movableTabs.length) {
    await showWorkspace(await activeWorkspaceForWindow(current, windowId), windowId);
  }
}

async function addTabToFavorites(tab) {
  if (!tab?.url || tab.url.startsWith("about:")) {
    return;
  }
  const current = await state();
  const workspace = current.tabWorkspaces[tab.id] || await activeWorkspaceForWindow(current, tab.windowId);
  const favorites = current.workspaceFavorites[workspace] || [];
  if (!favorites.some(favorite => favorite.url === tab.url)) {
    favorites.push({ title: tab.title || tab.url, url: tab.url });
    current.workspaceFavorites[workspace] = favorites;
    await save(current);
  }
}

async function openAllFavorites(workspace, windowId) {
  const current = await state();
  const favorites = current.workspaceFavorites[workspace] || [];
  if (!favorites.length) {
    return;
  }
  await showWorkspace(workspace, windowId);
  for (const favorite of favorites) {
    const tab = await browser.tabs.create({ windowId, url: favorite.url, active: false });
    await assign(tab.id, workspace);
  }
}

async function openCommandPalette() {
  const palette = await browser.windows.getAll({ populate: true }).then(windows =>
    windows.find(window => window.tabs.some(tab => tab.url?.endsWith("/palette.html"))),
  );
  if (palette) {
    await browser.windows.remove(palette.id);
    return;
  }
  const window = await activeBrowserWindow();
  const width = 600;
  const height = 680;
  const left = Math.round(window.left + (window.width - width) / 2);
  const top = Math.round(window.top + (window.height - height) / 2);
  const paletteWindow = await browser.windows.create({
    url: browser.runtime.getURL("palette.html"),
    type: "popup",
    width,
    height,
    left,
    top,
  });
  // macOS may ignore the initial popup coordinates; apply them after creation.
  await browser.windows.update(paletteWindow.id, { left, top, width, height });
}

function normalizedUrl(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith("utm_") || key === "fbclid" || key === "gclid") {
      parsed.searchParams.delete(key);
    }
  }
  if (parsed.pathname.endsWith("/") && parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function workspaceForUrl(rules, url) {
  if (!url || url.startsWith("about:")) {
    return null;
  }
  const parsed = new URL(url);
  const prefix = `${parsed.origin}${parsed.pathname}`;
  return rules.find(rule =>
    (rule.type === "domain" && (parsed.hostname === rule.value || parsed.hostname.endsWith(`.${rule.value}`))) ||
    (rule.type === "prefix" && prefix.startsWith(rule.value)) ||
    (rule.type === "exact" && parsed.href === rule.value)
  )?.workspace || null;
}

function normalizeRuleValue(ruleType, value) {
  if (!value) {
    return null;
  }
  try {
    if (ruleType === "domain") {
      return new URL(value.includes("://") ? value : `https://${value}`).hostname;
    }
    const parsed = new URL(value);
    return ruleType === "prefix"
      ? `${parsed.origin}${parsed.pathname}`
      : parsed.href;
  } catch {
    return null;
  }
}

function matchesRule(rules, url) {
  if (!url || url.startsWith("about:")) {
    return false;
  }
  const parsed = new URL(url);
  const prefix = `${parsed.origin}${parsed.pathname}`;
  return rules.some(rule =>
    (rule.type === "domain" && (parsed.hostname === rule.value || parsed.hostname.endsWith(`.${rule.value}`))) ||
    (rule.type === "prefix" && prefix.startsWith(rule.value)) ||
    (rule.type === "exact" && parsed.href === rule.value)
  );
}

function pinnedAppUrl(url) {
  const parsed = new URL(url);
  return PINNED_APP_HOSTS.has(parsed.hostname) ? parsed.origin : null;
}


async function updateWorkspaceMenu() {
  const current = await state();
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: "workspace-membership",
    title: "Workspace",
    contexts: ["tab"],
    enabled: false,
  });
  browser.contextMenus.create({
    id: "add-current-tab-favorite",
    title: "Add tab to workspace favorites",
    contexts: ["tab"],
  });
  browser.contextMenus.create({
    id: "move-to-workspace",
    title: "Move to workspace",
    contexts: ["tab"],
  });
  for (const workspace of current.workspaces) {
    browser.contextMenus.create({
      id: `move-to-workspace:${workspace}`,
      parentId: "move-to-workspace",
      title: workspace,
      contexts: ["tab"],
    });
  }
  browser.contextMenus.create({
    id: "open-link-in-workspace",
    title: "Open link in workspace",
    contexts: ["link"],
  });
  for (const workspace of current.workspaces) {
    browser.contextMenus.create({
      id: `open-link-in-workspace:${workspace}`,
      parentId: "open-link-in-workspace",
      title: workspace,
      contexts: ["link"],
    });
  }
}

async function showWorkspace(workspace, windowId) {
  const current = await state();
  if (!current.workspaces.includes(workspace)) {
    return;
  }

  switchingWorkspace = true;
  try {
  // Save the currently active tab for the workspace we're leaving.
  const leavingWorkspace = await activeWorkspaceForWindow(current, windowId);
  const allTabs = await browser.tabs.query({ windowId });
  const currentlyActiveTab = allTabs.find(tab => tab.active);
  if (currentlyActiveTab && leavingWorkspace && leavingWorkspace !== workspace) {
    current.workspaceActiveTab[leavingWorkspace] = currentlyActiveTab.id;
    await browser.sessions.setWindowValue(windowId, `workspace-active-tab:${leavingWorkspace}`, currentlyActiveTab.id);
  }

  current.activeWorkspaces[windowId] = workspace;
  await browser.sessions.setWindowValue(windowId, WINDOW_WORKSPACE_KEY, workspace);
  await updateWorkspaceIndicator(workspace, windowId);
  const tabs = allTabs;
  const visibleTabs = [];
  const hiddenTabs = [];
  for (const tab of tabs) {
    const tabWorkspace = current.tabWorkspaces[tab.id] || DEFAULT_WORKSPACE;
    if (!current.tabWorkspaces[tab.id]) {
      current.tabWorkspaces[tab.id] = DEFAULT_WORKSPACE;
    }

    const isVisible = tab.pinned || tabWorkspace === workspace;
    if (isVisible) {
      visibleTabs.push(tab);
    } else {
      hiddenTabs.push(tab);
    }
  }

  const workspaceTabsInWindow = tabs.filter(tab => !tab.pinned && (current.tabWorkspaces[tab.id] || DEFAULT_WORKSPACE) === workspace);
  if (!workspaceTabsInWindow.length) {
    const createdTab = await browser.tabs.create({ windowId, url: "about:newtab", active: true });
    current.tabWorkspaces[createdTab.id] = workspace;
    await browser.sessions.setTabValue(createdTab.id, WORKSPACE_KEY, workspace);
    tabs.push(createdTab);
    visibleTabs.push(createdTab);
  }

  await browser.tabs.show(visibleTabs.map(tab => tab.id)).catch(() => {});

  await browser.tabs.hide(hiddenTabs.map(tab => tab.id)).catch(() => {});

  const favoriteUrls = new Set((current.workspaceFavorites[workspace] || []).map(f => f.url));
  const workspaceTabs = tabs
    .filter(tab => !tab.pinned && (
      (current.tabWorkspaces[tab.id] || DEFAULT_WORKSPACE) === workspace
    ))
    .sort((first, second) => {
      const aFav = favoriteUrls.has(first.url) ? 0 : 1;
      const bFav = favoriteUrls.has(second.url) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return first.index - second.index;
    })
    .map(tab => tab.id);
  const globalPinnedCount = tabs.filter(tab => tab.pinned).length;
  if (workspaceTabs.length) {
    await browser.tabs.move(workspaceTabs, { index: globalPinnedCount });
  }
  await save(current);

  // Restore the last active tab for this workspace, or fall back to first visible.
  const savedTabId = current.workspaceActiveTab[workspace];
  const savedTab = savedTabId && tabs.find(tab => tab.id === savedTabId && !tab.pinned && (current.tabWorkspaces[tab.id] || DEFAULT_WORKSPACE) === workspace);
  if (savedTab) {
    await browser.tabs.update(savedTab.id, { active: true });
  } else {
    const shownTabs = await browser.tabs.query({ windowId, hidden: false });
    const shownWorkspaceTabs = shownTabs
      .filter(tab => !tab.pinned && (current.tabWorkspaces[tab.id] || DEFAULT_WORKSPACE) === workspace)
      .sort((first, second) => {
        const firstLastActive = current.tabLastActive[first.id] || 0;
        const secondLastActive = current.tabLastActive[second.id] || 0;
        if (firstLastActive !== secondLastActive) {
          return secondLastActive - firstLastActive;
        }
        return second.index - first.index;
      });
    const target = shownWorkspaceTabs[0] || shownTabs.find(tab => tab.active) || shownTabs.find(tab => tab.pinned) || shownTabs[0];
    if (target && !target.active) {
      await browser.tabs.update(target.id, { active: true });
    }
  }
  } finally {
    switchingWorkspace = false;
  }
}

async function initializeTab(tab) {
  const current = await state();
  const workspace = await browser.sessions.getTabValue(tab.id, WORKSPACE_KEY);
  current.tabWorkspaces[tab.id] = current.workspaces.includes(workspace)
    ? workspace
    : await activeWorkspaceForWindow(current, tab.windowId);
  await browser.sessions.setTabValue(tab.id, WORKSPACE_KEY, current.tabWorkspaces[tab.id]);
  await save(current);
}

browser.tabs.onCreated.addListener(initializeTab);

browser.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const current = await state();
  current.tabLastActive[tabId] = Date.now();
  await save(current);
});

async function restoreTabs() {
  const tabs = await browser.tabs.query({});
  const current = await state();
  for (const tab of tabs) {
    const workspace = await browser.sessions.getTabValue(tab.id, WORKSPACE_KEY);
    current.tabWorkspaces[tab.id] = current.workspaces.includes(workspace)
      ? workspace
      : current.tabWorkspaces[tab.id] || DEFAULT_WORKSPACE;
  }
  // Restore last active tab per workspace from session storage.
  const windows = await browser.windows.getAll();
  for (const win of windows) {
    for (const workspace of current.workspaces) {
      const tabId = await browser.sessions.getWindowValue(win.id, `workspace-active-tab:${workspace}`);
      if (tabId && !current.workspaceActiveTab[workspace]) {
        current.workspaceActiveTab[workspace] = tabId;
      }
    }
  }
  await save(current);
}

const AUTO_CLOSE_MINUTES = 120;
const AUTO_CLOSE_ALARM = "auto-close-stale-tabs";

async function closeStateTabs() {
  const current = await state();
  const cutoff = Date.now() - AUTO_CLOSE_MINUTES * 60 * 1000;
  const tabs = await browser.tabs.query({});
  const toClose = tabs.filter(tab => {
    if (tab.pinned || tab.active) return false;
    const workspace = current.tabWorkspaces[tab.id] || DEFAULT_WORKSPACE;
    const favoriteUrls = new Set((current.workspaceFavorites[workspace] || []).map(f => f.url));
    if (favoriteUrls.has(tab.url)) return false;
    const lastActive = current.tabLastActive[tab.id];
    if (lastActive === undefined) return false;
    return lastActive < cutoff;
  });
  if (toClose.length) {
    await browser.tabs.remove(toClose.map(tab => tab.id));
  }
}

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === AUTO_CLOSE_ALARM) closeStateTabs();
});

browser.runtime.onInstalled.addListener(async () => {
  await restoreTabs();
  await updateWorkspaceMenu();
  browser.alarms.create(AUTO_CLOSE_ALARM, { periodInMinutes: 5 });
  const windows = await browser.windows.getAll();
  await Promise.all(windows.map(async window => {
    const current = await state();
    await updateWorkspaceIndicator(await activeWorkspaceForWindow(current, window.id), window.id);
  }));
});
browser.runtime.onStartup.addListener(async () => {
  await restoreTabs();
  await updateWorkspaceMenu();
  browser.alarms.create(AUTO_CLOSE_ALARM, { periodInMinutes: 5 });
  const windows = await browser.windows.getAll();
  await Promise.all(windows.map(async window => {
    const current = await state();
    await showWorkspace(await activeWorkspaceForWindow(current, window.id), window.id);
  }));
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) {
    return;
  }

  if (info.menuItemId.startsWith("move-to-workspace:")) {
    const highlightedTabs = await browser.tabs.query({ windowId: tab.windowId, highlighted: true });
    const tabsToMove = highlightedTabs.some(candidate => candidate.id === tab.id)
      ? highlightedTabs
      : [tab];
    await moveTabsToWorkspace(tabsToMove, info.menuItemId.slice("move-to-workspace:".length));
  } else if (info.menuItemId.startsWith("open-link-in-workspace:")) {
    const workspace = info.menuItemId.slice("open-link-in-workspace:".length);
    const current = await state();
    if (!current.workspaces.includes(workspace)) {
      return;
    }
    await showWorkspace(workspace, tab.windowId);
    const [newTab] = await browser.tabs.create({ windowId: tab.windowId, url: info.linkUrl, active: true });
    await assign(newTab.id, workspace);
  } else if (info.menuItemId === "add-current-tab-favorite" && tab.url && !tab.url.startsWith("about:")) {
    await addTabToFavorites(tab);
  }
});

browser.contextMenus.onShown.addListener(async (info, tab) => {
  if (!tab) {
    return;
  }

  const current = await state();
  const workspace = current.tabWorkspaces[tab.id] ||
    await browser.sessions.getTabValue(tab.id, WORKSPACE_KEY) ||
    DEFAULT_WORKSPACE;
  await browser.contextMenus.update("workspace-membership", {
    title: `Workspace: ${workspace}`,
  });
  browser.contextMenus.refresh();
});

browser.tabs.onRemoved.addListener(async tabId => {
  const current = await state();
  delete current.tabWorkspaces[tabId];
  delete current.tabLastActive[tabId];
  await save(current);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url || changeInfo.url === "about:blank") {
    return;
  }

  const current = await state();
  const routedWorkspace = workspaceForUrl(current.trafficRules, changeInfo.url);
  const workspace = routedWorkspace || current.tabWorkspaces[tabId] || await activeWorkspaceForWindow(current, tab.windowId);
  current.tabWorkspaces[tabId] = workspace;
  await browser.sessions.setTabValue(tabId, WORKSPACE_KEY, workspace);
  await save(current);

  if (routedWorkspace && routedWorkspace !== await activeWorkspaceForWindow(current, tab.windowId)) {
    await showWorkspace(routedWorkspace, tab.windowId);
  }

  if (matchesRule(current.duplicateRules || [], changeInfo.url)) {
    return;
  }

  const url = normalizedUrl(changeInfo.url);
  const appUrl = pinnedAppUrl(changeInfo.url);
  const matches = await browser.tabs.query({ windowId: tab.windowId });
  const existing = matches.find(candidate => {
    if (candidate.id === tabId || !candidate.url || candidate.url.startsWith("about:")) {
      return false;
    }
    if (candidate.pinned && appUrl && pinnedAppUrl(candidate.url) === appUrl) {
      return true;
    }
    return normalizedUrl(candidate.url) === url &&
      (candidate.pinned || (current.tabWorkspaces[candidate.id] || DEFAULT_WORKSPACE) === workspace);
  });

  if (existing) {
    await browser.tabs.show([existing.id]).catch(() => {});
    await browser.tabs.update(existing.id, { active: true });
    await browser.tabs.remove(tabId);
  }
});

browser.commands.onCommand.addListener(async command => {
  if (command === "command-palette") {
    await openCommandPalette();
    return;
  }
  const current = await state();
  const window = await activeBrowserWindow();
  if (command === "open-all-favorites") {
    await openAllFavorites(await activeWorkspaceForWindow(current, window.id), window.id);
    return;
  }
  if (command === "add-current-tab-favorite") {
    const [tab] = await browser.tabs.query({ active: true, windowId: window.id });
    await addTabToFavorites(tab);
    return;
  }
  const activeWorkspace = workspaceForWindow(current, window.id);
  const index = current.workspaces.indexOf(activeWorkspace);
  const direction = command === "next-workspace" ? 1 : -1;
  const next = (index + direction + current.workspaces.length) % current.workspaces.length;
  await showWorkspace(current.workspaces[next], window.id);
});

browser.runtime.onMessage.addListener(async message => {
  const current = await state();

  if (message.type === "get-state") {
    const window = await activeBrowserWindow();
    return { ...current, activeWorkspace: workspaceForWindow(current, window.id) };
  }

  if (message.type === "create-traffic-rule") {
    const value = message.value.trim();
    if (!value || !current.workspaces.includes(message.workspace)) {
      return;
    }
    const normalizedValue = normalizeRuleValue(message.ruleType, value);
    if (!normalizedValue) {
      return;
    }
    const existing = current.trafficRules.find(rule => rule.type === message.ruleType && rule.value === normalizedValue);
    if (existing) {
      existing.workspace = message.workspace;
    } else {
      current.trafficRules.push({ id: crypto.randomUUID(), type: message.ruleType, value: normalizedValue, workspace: message.workspace });
    }
    await save(current);
    return { ok: true };
  }

  if (message.type === "create-duplicate-rule") {
    const value = message.value.trim();
    const normalizedValue = normalizeRuleValue(message.ruleType, value);
    if (!normalizedValue) {
      return;
    }
    const existing = (current.duplicateRules || []).find(rule => rule.type === message.ruleType && rule.value === normalizedValue);
    if (!existing) {
      current.duplicateRules = [...(current.duplicateRules || []), {
        id: crypto.randomUUID(),
        type: message.ruleType,
        value: normalizedValue,
      }];
      await save(current);
    }
    return { ok: true };
  }

  if (message.type === "remove-traffic-rule") {
    current.trafficRules = current.trafficRules.filter(rule => rule.id !== message.id);
    await save(current);
    return { ok: true };
  }

  if (message.type === "remove-duplicate-rule") {
    current.duplicateRules = (current.duplicateRules || []).filter(rule => rule.id !== message.id);
    await save(current);
    return { ok: true };
  }

  if (message.type === "open-favorite") {
    const window = await activeBrowserWindow();
    await showWorkspace(message.workspace, window.id);
    const [tab] = await browser.tabs.create({ windowId: window.id, url: message.url, active: true });
    await assign(tab.id, message.workspace);
    return;
  }

  if (message.type === "open-all-favorites") {
    const window = await activeBrowserWindow();
    await openAllFavorites(message.workspace, window.id);
    return;
  }

  if (message.type === "open-all-active-favorites") {
    const window = await activeBrowserWindow();
    await openAllFavorites(await activeWorkspaceForWindow(current, window.id), window.id);
    return;
  }

  if (message.type === "add-active-tab-favorite") {
    const window = await activeBrowserWindow();
    const [tab] = await browser.tabs.query({ active: true, windowId: window.id });
    await addTabToFavorites(tab);
    return;
  }

  if (message.type === "clean-active-workspace") {
    const window = await activeBrowserWindow();
    const workspace = await activeWorkspaceForWindow(current, window.id);
    const favoriteUrls = new Set((current.workspaceFavorites[workspace] || []).map(favorite => favorite.url));
    const tabs = await browser.tabs.query({ windowId: window.id });
    const toClose = tabs.filter(tab => !tab.pinned && current.tabWorkspaces[tab.id] === workspace && !favoriteUrls.has(tab.url));
    if (toClose.length) {
      await browser.tabs.remove(toClose.map(tab => tab.id));
    }
    return;
  }

  if (message.type === "clean-inactive-tabs") {
    const window = await activeBrowserWindow();
    const workspace = await activeWorkspaceForWindow(current, window.id);
    const cutoff = Date.now() - 30 * 60 * 1000;
    const tabs = await browser.tabs.query({ windowId: window.id });
    const toClose = tabs.filter(tab =>
      !tab.pinned &&
      current.tabWorkspaces[tab.id] === workspace &&
      !tab.active &&
      current.tabLastActive[tab.id] !== undefined &&
      current.tabLastActive[tab.id] < cutoff
    );
    if (toClose.length) {
      await browser.tabs.remove(toClose.map(tab => tab.id));
    }
    return { closed: toClose.length };
  }

  if (message.type === "clean-unvisited-tabs") {
    const window = await activeBrowserWindow();
    const workspace = await activeWorkspaceForWindow(current, window.id);
    const favoriteUrls = new Set((current.workspaceFavorites[workspace] || []).map(favorite => favorite.url));
    const tabs = await browser.tabs.query({ windowId: window.id });
    const toClose = tabs.filter(tab =>
      !tab.pinned &&
      current.tabWorkspaces[tab.id] === workspace &&
      !tab.active &&
      current.tabLastActive[tab.id] === undefined &&
      !favoriteUrls.has(tab.url)
    );
    if (toClose.length) {
      await browser.tabs.remove(toClose.map(tab => tab.id));
    }
    return { closed: toClose.length };
  }

  if (message.type === "remove-favorite") {
    const favorites = current.workspaceFavorites[message.workspace] || [];
    current.workspaceFavorites[message.workspace] = favorites.filter(favorite => favorite.url !== message.url);
    await save(current);
    return;
  }

  if (message.type === "move-favorite") {
    const favorites = current.workspaceFavorites[message.workspace] || [];
    const index = favorites.findIndex(favorite => favorite.url === message.url);
    const target = index + message.direction;
    if (index < 0 || target < 0 || target >= favorites.length) {
      return;
    }
    [favorites[index], favorites[target]] = [favorites[target], favorites[index]];
    current.workspaceFavorites[message.workspace] = favorites;
    await save(current);
    return;
  }

  if (message.type === "switch-workspace") {
    const window = await activeBrowserWindow();
    await showWorkspace(message.workspace, window.id);
    return;
  }

  if (message.type === "create-workspace") {
    const name = message.name.trim();
    if (name && !current.workspaces.includes(name)) {
      current.workspaces.push(name);
      current.workspaceStyles[name] = { ...DEFAULT_WORKSPACE_STYLE };
      await save(current);
      await updateWorkspaceMenu();
      const window = await activeBrowserWindow();
      await showWorkspace(name, window.id);
    }
    return;
  }

  if (message.type === "rename-workspace") {
    const name = message.name.trim();
    if (!name || current.workspaces.includes(name) || !current.workspaces.includes(message.workspace)) {
      return;
    }
    current.workspaces = current.workspaces.map(workspace => workspace === message.workspace ? name : workspace);
    current.workspaceStyles[name] = current.workspaceStyles[message.workspace] || DEFAULT_WORKSPACE_STYLE;
    current.workspaceFavorites[name] = current.workspaceFavorites[message.workspace] || [];
    delete current.workspaceStyles[message.workspace];
    delete current.workspaceFavorites[message.workspace];
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map(async tab => {
      if (current.tabWorkspaces[tab.id] === message.workspace) {
        current.tabWorkspaces[tab.id] = name;
        await browser.sessions.setTabValue(tab.id, WORKSPACE_KEY, name);
      }
    }));
    for (const [windowId, workspace] of Object.entries(current.activeWorkspaces)) {
      if (workspace === message.workspace) {
        current.activeWorkspaces[windowId] = name;
        await browser.sessions.setWindowValue(Number(windowId), WINDOW_WORKSPACE_KEY, name);
      }
    }
    await save(current);
    await updateWorkspaceMenu();
    return;
  }

  if (message.type === "delete-workspace") {
    if (current.workspaces.length === 1 || !current.workspaces.includes(message.workspace)) {
      return;
    }

    const tabs = await browser.tabs.query({});
    const tabsToClose = tabs
      .filter(tab => !tab.pinned && current.tabWorkspaces[tab.id] === message.workspace)
      .map(tab => tab.id);
    current.workspaces = current.workspaces.filter(workspace => workspace !== message.workspace);
    delete current.workspaceStyles[message.workspace];
    delete current.workspaceFavorites[message.workspace];
    const fallback = current.workspaces[0];
    for (const [windowId, workspace] of Object.entries(current.activeWorkspaces)) {
      if (workspace === message.workspace) {
        current.activeWorkspaces[windowId] = fallback;
        await browser.sessions.setWindowValue(Number(windowId), WINDOW_WORKSPACE_KEY, fallback);
      }
    }
    await save(current);
    if (tabsToClose.length) {
      await browser.tabs.remove(tabsToClose);
    }
    await updateWorkspaceMenu();
    const windows = await browser.windows.getAll();
    await Promise.all(windows.map(async window => showWorkspace(
      await activeWorkspaceForWindow(current, window.id),
      window.id,
    )));
    return;
  }

  if (message.type === "set-workspace-style") {
    if (!current.workspaces.includes(message.workspace)) {
      return;
    }
    current.workspaceStyles[message.workspace] = {
      icon: message.icon,
      color: message.color,
    };
    await save(current);
    const window = await activeBrowserWindow();
    if (workspaceForWindow(current, window.id) === message.workspace) {
      await updateWorkspaceIndicator(message.workspace, window.id);
    }
    return;
  }

  if (message.type === "move-active-tab") {
    const window = await activeBrowserWindow();
    const [tab] = await browser.tabs.query({ active: true, windowId: window.id });
    if (tab) {
      await moveTabsToWorkspace([tab], message.workspace);
    }
    return;
  }

});
