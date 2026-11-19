const switchingWindows = new Map();
const switchingTasks = new Map();

async function withSwitching(windowId, task) {
  switchingWindows.set(windowId, (switchingWindows.get(windowId) || 0) + 1);
  const run = (switchingTasks.get(windowId) || Promise.resolve()).catch(() => {}).then(task);
  switchingTasks.set(windowId, run);
  try {
    return await run;
  } finally {
    const remaining = switchingWindows.get(windowId) - 1;
    if (remaining > 0) {
      switchingWindows.set(windowId, remaining);
    } else {
      switchingWindows.delete(windowId);
    }
    if (switchingTasks.get(windowId) === run) {
      switchingTasks.delete(windowId);
    }
  }
}

async function hideTabs(tabIds) {
  if (!tabIds.length) {
    return;
  }
  await browser.tabs.hide(tabIds).catch(error => console.error("tabs.hide failed", error));
  for (let attempt = 0; attempt < 3; attempt++) {
    const pending = [];
    for (const id of tabIds) {
      const tab = await browser.tabs.get(id).catch(() => null);
      if (tab && !tab.hidden && !tab.pinned) {
        pending.push(id);
      }
    }
    if (!pending.length) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
    for (const id of pending) {
      await browser.tabs.hide(id).catch(error => console.error("tabs.hide retry failed", id, error));
    }
  }
}

const activeTabKey = (windowId, workspace) => `${windowId}:${workspace}`;

async function rememberActiveTab(current, windowId, workspace, tabId) {
  current.workspaceActiveTab[activeTabKey(windowId, workspace)] = tabId;
  await browser.sessions.setWindowValue(windowId, `workspace-active-tab:${workspace}`, tabId).catch(() => {});
}

async function updateWorkspaceIndicator(current, workspace, windowId) {
  const style = current.workspaceStyles[workspace] || DEFAULT_WORKSPACE_STYLE;
  const color = sanitizeColor(style.color);
  const icon = sanitizeIcon(style.icon);
  const canvas = new OffscreenCanvas(32, 32);
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(2, 2, 28, 28, 9);
  context.fill();
  context.fillStyle = readableTextColor(color);
  const size = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(icon)].length > 1 ? 13 : 18;
  context.font = `${size}px system-ui, Apple Color Emoji, Segoe UI Emoji`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(icon, 16, 16.5);
  await browser.action.setIcon({ imageData: context.getImageData(0, 0, 32, 32), windowId });
  await browser.action.setBadgeText({ text: "", windowId });
  await browser.action.setTitle({ title: `Workspace: ${workspace}`, windowId });
}

async function pickTabToActivate(current, windowId, workspace, ownTabs) {
  const saved = ownTabs.find(tab => tab.id === current.workspaceActiveTab[activeTabKey(windowId, workspace)]);
  if (saved) {
    return saved;
  }
  const ranked = await Promise.all(ownTabs.map(async tab => ({
    tab,
    lastActive: (await readClock(tab.id)).lastActive || 0,
  })));
  ranked.sort((first, second) => second.lastActive - first.lastActive || second.tab.index - first.tab.index);
  return ranked[0]?.tab;
}

async function showWorkspace(workspace, windowId) {
  await withSwitching(windowId, async () => {
    const current = await state();
    if (!isWorkspace(current, workspace)) {
      return;
    }
    const now = Date.now();
    const leaving = await activeWorkspaceForWindow(current, windowId);
    const tabs = await browser.tabs.query({ windowId });
    const activeTab = tabs.find(tab => tab.active);

    if (leaving !== workspace) {
      if (activeTab) {
        await rememberActiveTab(current, windowId, leaving, activeTab.id);
        await writeClock(activeTab.id, { lastActive: now });
      }
      await browser.sessions.setWindowValue(windowId, KEYS.previousWorkspace, leaving);
    }

    current.activeWorkspaces[windowId] = workspace;
    await browser.sessions.setWindowValue(windowId, KEYS.windowWorkspace, workspace);
    await updateWorkspaceIndicator(current, workspace, windowId);

    for (const tab of tabs) {
      if (!isWorkspace(current, current.tabWorkspaces[tab.id])) {
        await assignTab(current, tab.id, leaving);
      }
    }

    const belongsHere = tab => tab.pinned || current.tabWorkspaces[tab.id] === workspace;
    const visible = tabs.filter(belongsHere);
    const hidden = tabs.filter(tab => !belongsHere(tab));
    const ownTabs = tabs.filter(tab => !tab.pinned && current.tabWorkspaces[tab.id] === workspace);

    if (!ownTabs.length) {
      const created = await browser.tabs.create({ windowId, active: true }).catch(error => {
        console.error("could not open a New Tab for the empty workspace", error);
        return null;
      });
      if (created) {
        await assignTab(current, created.id, workspace);
        await writeClock(created.id, { createdAt: now });
        visible.push(created);
        ownTabs.push(created);
      }
    }

    await Promise.allSettled([
      ...hidden.map(tab => pauseTab(tab, now)),
      ...visible.map(tab => resumeTab(tab, now)),
    ]);
    await browser.tabs.show(visible.map(tab => tab.id)).catch(() => {});
    await save(current);

    const target = await pickTabToActivate(current, windowId, workspace, ownTabs);
    if (target && !target.active) {
      await browser.tabs.update(target.id, { active: true });
    }
    await hideTabs(hidden.map(tab => tab.id));
  });
}

async function switchRelative(windowId, direction) {
  const current = await state();
  const active = await activeWorkspaceForWindow(current, windowId);
  const total = current.workspaces.length;
  const index = current.workspaces.indexOf(active);
  await showWorkspace(current.workspaces[(index + direction + total) % total], windowId);
}

async function switchToPrevious(windowId) {
  const current = await state();
  const previous = await browser.sessions.getWindowValue(windowId, KEYS.previousWorkspace);
  if (isWorkspace(current, previous)) {
    await showWorkspace(previous, windowId);
  }
}

async function createWorkspaceTab(workspace, windowId, url, active) {
  const tab = await browser.tabs.create({ windowId, url, active });
  const current = await state();
  await assignTab(current, tab.id, workspace);
  await save(current);
  return tab;
}

async function openInWorkspace(workspace, windowId, url) {
  await showWorkspace(workspace, windowId);
  return createWorkspaceTab(workspace, windowId, url, true);
}

async function openAllFavorites(workspace, windowId) {
  const current = await state();
  const favorites = current.workspaceFavorites[workspace] || [];
  if (!favorites.length) {
    return;
  }
  await showWorkspace(workspace, windowId);
  for (const favorite of favorites) {
    await createWorkspaceTab(workspace, windowId, favorite.url, false);
  }
}

async function addTabToFavorites(tab) {
  if (!tab?.url || tab.url.startsWith("about:")) {
    return;
  }
  const current = await state();
  const workspace = current.tabWorkspaces[tab.id] || await activeWorkspaceForWindow(current, tab.windowId);
  if (isFavoriteUrl(current, workspace, tab.url)) {
    return;
  }
  current.workspaceFavorites[workspace] = [
    ...(current.workspaceFavorites[workspace] || []),
    { title: tab.title || tab.url, url: tab.url },
  ];
  await save(current);
}

async function moveTabsToWorkspace(tabs, workspace) {
  const current = await state();
  const movable = tabs.filter(tab => !tab.pinned);
  if (!isWorkspace(current, workspace) || !movable.length) {
    return;
  }
  for (const tab of movable) {
    await assignTab(current, tab.id, workspace);
  }
  await save(current);
  const { windowId } = movable[0];
  await showWorkspace(await activeWorkspaceForWindow(current, windowId), windowId);
}

function renameKey(object, from, to) {
  if (from in object) {
    object[to] = object[from];
    delete object[from];
  }
}

function forEachActiveTabKey(current, workspace, visit) {
  for (const key of Object.keys(current.workspaceActiveTab)) {
    if (key.endsWith(`:${workspace}`)) {
      visit(key, key.slice(0, -workspace.length));
    }
  }
}

async function retargetWindows(current, from, to) {
  for (const { id } of await browser.windows.getAll()) {
    for (const key of [KEYS.windowWorkspace, KEYS.previousWorkspace]) {
      if (await browser.sessions.getWindowValue(id, key) === from) {
        await browser.sessions.setWindowValue(id, key, to);
      }
    }
    if (current.activeWorkspaces[id] === from) {
      current.activeWorkspaces[id] = to;
    }
  }
}

async function reapplyAllWindows(current) {
  for (const { id } of await browser.windows.getAll()) {
    await showWorkspace(await activeWorkspaceForWindow(current, id), id);
  }
}

async function createWorkspace(current, rawName, windowId) {
  const name = rawName.trim();
  if (!name || isWorkspace(current, name)) {
    return;
  }
  current.workspaces.push(name);
  current.workspaceStyles[name] = { ...DEFAULT_WORKSPACE_STYLE };
  await save(current);
  await updateWorkspaceMenu();
  await showWorkspace(name, windowId);
}

async function renameWorkspace(current, from, rawName, windowId) {
  const to = rawName.trim();
  if (!to || isWorkspace(current, to) || !isWorkspace(current, from)) {
    return;
  }
  current.workspaces = current.workspaces.map(name => (name === from ? to : name));
  renameKey(current.workspaceStyles, from, to);
  renameKey(current.workspaceFavorites, from, to);
  forEachActiveTabKey(current, from, (key, prefix) => renameKey(current.workspaceActiveTab, key, `${prefix}${to}`));
  for (const [tabId, workspace] of Object.entries(current.tabWorkspaces)) {
    if (workspace === from) {
      await assignTab(current, Number(tabId), to);
    }
  }
  await retargetWindows(current, from, to);
  await save(current);
  await updateWorkspaceMenu();
  await showWorkspace(await activeWorkspaceForWindow(current, windowId), windowId);
}

async function deleteWorkspace(current, workspace) {
  if (current.workspaces.length === 1 || !isWorkspace(current, workspace)) {
    return;
  }
  const doomed = (await browser.tabs.query({}))
    .filter(tab => !tab.pinned && current.tabWorkspaces[tab.id] === workspace);
  current.workspaces = current.workspaces.filter(name => name !== workspace);
  delete current.workspaceStyles[workspace];
  delete current.workspaceFavorites[workspace];
  forEachActiveTabKey(current, workspace, key => delete current.workspaceActiveTab[key]);
  await retargetWindows(current, workspace, current.workspaces[0]);
  await save(current);
  await closeTabs(doomed);
  await updateWorkspaceMenu();
  await reapplyAllWindows(current);
}

async function setWorkspaceStyle(current, workspace, icon, color, windowId) {
  if (!isWorkspace(current, workspace)) {
    return;
  }
  current.workspaceStyles[workspace] = { icon: sanitizeIcon(icon), color: sanitizeColor(color) };
  await save(current);
  if (await activeWorkspaceForWindow(current, windowId) === workspace) {
    await updateWorkspaceIndicator(current, workspace, windowId);
  }
}

async function updateWorkspaceMenu() {
  const current = await state();
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({ id: "workspace-membership", title: "Workspace", contexts: ["tab"], enabled: false });
  browser.contextMenus.create({ id: "add-current-tab-favorite", title: "Add tab to workspace favorites", contexts: ["tab"] });
  for (const [id, title, context] of [
    ["move-to-workspace", "Move to workspace", "tab"],
    ["open-link-in-workspace", "Open link in workspace", "link"],
  ]) {
    browser.contextMenus.create({ id, title, contexts: [context] });
    for (const workspace of current.workspaces) {
      browser.contextMenus.create({ id: `${id}:${workspace}`, parentId: id, title: workspace, contexts: [context] });
    }
  }
}
