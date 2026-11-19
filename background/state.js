const DEFAULT_WORKSPACE = "General";
const DEFAULT_WORKSPACE_STYLE = Object.freeze({ icon: "●", color: "#0060df" });

const KEYS = Object.freeze({
  tabWorkspace: "vanilla-workspace",
  windowWorkspace: "vanilla-active-workspace",
  previousWorkspace: "vanilla-previous-workspace",
  createdAt: "vanilla-created-at",
  lastActive: "vanilla-last-active",
  pausedAt: "vanilla-paused-at",
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_ICON_GRAPHEMES = 2;

function sanitizeIcon(value) {
  const text = String(value ?? "").trim();
  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)];
  const icon = segments.slice(0, MAX_ICON_GRAPHEMES).map(part => part.segment).join("");
  return icon || DEFAULT_WORKSPACE_STYLE.icon;
}

function sanitizeColor(value) {
  return HEX_COLOR.test(value) ? value.toLowerCase() : DEFAULT_WORKSPACE_STYLE.color;
}

function readableTextColor(background) {
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(background.slice(index, index + 2), 16) / 255);
  const linear = channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
  return luminance > 0.5 ? "#1b1b1b" : "#ffffff";
}

function createDefaultState() {
  return {
    workspaces: [DEFAULT_WORKSPACE],
    activeWorkspaces: {},
    tabWorkspaces: {},
    workspaceStyles: { [DEFAULT_WORKSPACE]: { ...DEFAULT_WORKSPACE_STYLE } },
    workspaceFavorites: {},
    trafficRules: [],
    duplicateRules: [],
    pinnedTabs: [],
    workspaceActiveTab: {},
  };
}

const STATE_KEYS = Object.keys(createDefaultState());

async function state() {
  return browser.storage.local.get(createDefaultState());
}

async function save(current) {
  await browser.storage.local.set(Object.fromEntries(STATE_KEYS.map(key => [key, current[key]])));
}

function isWorkspace(current, name) {
  return current.workspaces.includes(name);
}

function isFavoriteUrl(current, workspace, url) {
  return (current.workspaceFavorites[workspace] || []).some(favorite => favorite.url === url);
}

async function activeWorkspaceForWindow(current, windowId) {
  const stored = await browser.sessions.getWindowValue(windowId, KEYS.windowWorkspace);
  const workspace = [stored, current.activeWorkspaces[windowId]].find(name => isWorkspace(current, name)) ||
    current.workspaces[0];
  current.activeWorkspaces[windowId] = workspace;
  return workspace;
}

async function activeBrowserWindow(windowId) {
  if (windowId) {
    const window = await browser.windows.get(windowId).catch(() => null);
    if (window?.type === "normal") {
      return window;
    }
  }
  const windows = await browser.windows.getAll();
  return windows.find(window => window.focused && window.type === "normal") ||
    windows.find(window => window.type === "normal") ||
    browser.windows.getLastFocused();
}

async function assignTab(current, tabId, workspace) {
  current.tabWorkspaces[tabId] = workspace;
  await browser.sessions.setTabValue(tabId, KEYS.tabWorkspace, workspace).catch(() => {});
}

async function resolveTabWorkspace(current, tab, storedFallback = current.tabWorkspaces[tab.id]) {
  const stored = await browser.sessions.getTabValue(tab.id, KEYS.tabWorkspace).catch(() => undefined);
  return [stored, storedFallback].find(name => isWorkspace(current, name)) ||
    activeWorkspaceForWindow(current, tab.windowId);
}
