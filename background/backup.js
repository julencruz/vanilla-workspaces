const BACKUP_FORMAT = "vanilla-workspaces-config";
const BACKUP_VERSION = 1;
const RULE_TYPES = new Set(["domain", "prefix", "exact"]);

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function cleanRules(rules, allowedWorkspaces) {
  const seen = new Set();
  const result = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    const value = normalizeRuleValue(rule?.type, String(rule?.value || "").trim());
    const workspace = allowedWorkspaces ? rule?.workspace : undefined;
    if (!RULE_TYPES.has(rule?.type) || !value || (allowedWorkspaces && !allowedWorkspaces.includes(workspace))) {
      continue;
    }
    const key = `${rule.type}|${value}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ id: crypto.randomUUID(), type: rule.type, value, ...(allowedWorkspaces ? { workspace } : {}) });
    }
  }
  return result;
}

function sanitizeConfig(raw) {
  if (raw?.app !== BACKUP_FORMAT || typeof raw.config !== "object" || raw.config === null) {
    return null;
  }
  const source = raw.config;
  const workspaces = [...new Set((Array.isArray(source.workspaces) ? source.workspaces : [])
    .filter(name => typeof name === "string")
    .map(name => name.trim().slice(0, 40))
    .filter(Boolean))];
  if (!workspaces.length) {
    return null;
  }
  const workspaceStyles = {};
  const workspaceFavorites = {};
  for (const name of workspaces) {
    const style = source.workspaceStyles?.[name];
    workspaceStyles[name] = { icon: sanitizeIcon(style?.icon), color: sanitizeColor(style?.color) };
    const favorites = Array.isArray(source.workspaceFavorites?.[name]) ? source.workspaceFavorites[name] : [];
    workspaceFavorites[name] = favorites
      .filter(favorite => isHttpUrl(favorite?.url))
      .map(favorite => ({ title: String(favorite.title || favorite.url).slice(0, 200), url: favorite.url }));
  }
  const pinnedTabs = [];
  for (const entry of Array.isArray(source.pinnedTabs) ? source.pinnedTabs : []) {
    const url = typeof entry?.url === "string" ? normalizePinnedUrl(entry.url) : null;
    if (url && !pinnedTabs.some(existing => pinnedKey(existing.url) === pinnedKey(url))) {
      pinnedTabs.push({ id: crypto.randomUUID(), url, matchMode: entry.matchMode === "site" ? "site" : "url" });
    }
  }
  return {
    workspaces,
    workspaceStyles,
    workspaceFavorites,
    trafficRules: cleanRules(source.trafficRules, workspaces),
    duplicateRules: cleanRules(source.duplicateRules),
    pinnedTabs,
  };
}

function exportConfig(current) {
  const { workspaces, workspaceStyles, workspaceFavorites, trafficRules, duplicateRules, pinnedTabs } = current;
  return {
    app: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    config: { workspaces, workspaceStyles, workspaceFavorites, trafficRules, duplicateRules, pinnedTabs },
  };
}

async function importConfig(current, raw) {
  const config = sanitizeConfig(raw);
  if (!config) {
    return { ok: false, error: "Not a valid Vanilla Workspaces backup." };
  }
  Object.assign(current, config);
  current.workspaceActiveTab = {};
  await save(current);
  await updateWorkspaceMenu();
  await reapplyAllWindows(current);
  await ensurePinnedTabsEverywhere({ force: true });
  return {
    ok: true,
    summary: `${config.workspaces.length} workspaces, ${config.trafficRules.length} routes, ${config.pinnedTabs.length} pinned tabs`,
  };
}
