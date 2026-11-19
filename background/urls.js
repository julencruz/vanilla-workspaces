const FIREFOX_START_PAGES = new Set(["about:newtab", "about:home", "about:privatebrowsing"]);
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$)/;

function isFirefoxStartPage(url) {
  return FIREFOX_START_PAGES.has(url);
}

function normalizedUrl(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) {
      parsed.searchParams.delete(key);
    }
  }
  if (parsed.pathname.endsWith("/") && parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function globalPinnedOrigins(current) {
  const origins = new Set();
  for (const entry of current.pinnedTabs) {
    try {
      origins.add(new URL(entry.url).origin);
    } catch {}
  }
  return origins;
}

function ruleMatches(rule, parsed) {
  switch (rule.type) {
    case "domain":
      return parsed.hostname === rule.value || parsed.hostname.endsWith(`.${rule.value}`);
    case "prefix":
      return `${parsed.origin}${parsed.pathname}`.startsWith(rule.value);
    case "exact":
      return parsed.href === rule.value;
    default:
      return false;
  }
}

function findMatchingRule(rules, url) {
  if (!url || url.startsWith("about:")) {
    return undefined;
  }
  const parsed = new URL(url);
  return rules.find(rule => ruleMatches(rule, parsed));
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
    return ruleType === "prefix" ? `${parsed.origin}${parsed.pathname}` : parsed.href;
  } catch {
    return null;
  }
}

function findDuplicateTab(current, tabs, tab, url, workspace) {
  const startPage = isFirefoxStartPage(url);
  const normalized = startPage ? null : normalizedUrl(url);
  const pinnedOrigins = startPage ? new Set() : globalPinnedOrigins(current);
  const matches = tabs.filter(candidate => {
    if (candidate.id === tab.id || !candidate.url) {
      return false;
    }
    if (startPage) {
      return isFirefoxStartPage(candidate.url) && current.tabWorkspaces[candidate.id] === workspace;
    }
    if (candidate.url.startsWith("about:")) {
      return false;
    }
    if (candidate.pinned && pinnedOrigins.has(new URL(candidate.url).origin) && new URL(url).origin === new URL(candidate.url).origin) {
      return true;
    }
    return normalizedUrl(candidate.url) === normalized;
  });
  const rank = candidate => (candidate.pinned ? 0 : current.tabWorkspaces[candidate.id] === workspace ? 1 : 2);
  return matches.sort((first, second) => rank(first) - rank(second))[0];
}
