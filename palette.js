const activeWorkspace = document.querySelector("#active-workspace");
const actions = document.querySelector("#actions");
const workspaces = document.querySelector("#workspaces");
const form = document.querySelector("#create-workspace");
const name = document.querySelector("#workspace-name");
const search = document.querySelector("#command-search");
const closePalette = document.querySelector("#close-palette");
const routeForm = document.querySelector("#create-route");
const routeType = document.querySelector("#route-type");
const routeValue = document.querySelector("#route-value");
const routeWorkspace = document.querySelector("#route-workspace");
const routes = document.querySelector("#routes");
const routeStatus = document.querySelector("#route-status");
const duplicateForm = document.querySelector("#create-duplicate-rule");
const duplicateType = document.querySelector("#duplicate-type");
const duplicateValue = document.querySelector("#duplicate-value");
const duplicateRules = document.querySelector("#duplicate-rules");
const duplicateStatus = document.querySelector("#duplicate-status");

let state;

function matches(text) {
  return text.toLowerCase().includes(search.value.trim().toLowerCase());
}

async function send(type, extra = {}) {
  await browser.runtime.sendMessage({ type, ...extra });
  await render();
}

function action(label, type, { shortcut, dangerous = false, confirmation } = {}) {
  if (!matches(label)) {
    return;
  }
  const button = document.createElement("button");
  button.className = dangerous ? "danger" : "action";
  button.append(label);
  if (shortcut) {
    const shortcutLabel = document.createElement("span");
    shortcutLabel.className = "shortcut";
    shortcutLabel.textContent = shortcut;
    button.append(shortcutLabel);
  }
  button.addEventListener("click", async () => {
    if (!dangerous || confirm(confirmation || "Close every non-favorite tab in this workspace?")) {
      await send(type);
    }
  });
  actions.append(button);
}

async function render() {
  state = await browser.runtime.sendMessage({ type: "get-state" });
  activeWorkspace.textContent = state.activeWorkspace;
  actions.replaceChildren();
  workspaces.replaceChildren();
  routes.replaceChildren();
  duplicateRules.replaceChildren();
  routeWorkspace.replaceChildren();
  action("Open all favorites", "open-all-active-favorites", { shortcut: "Cmd Shift Down" });
  action("Add current tab to favorites", "add-active-tab-favorite", { shortcut: "Cmd Shift Up" });
  action("Close visited tabs unused for 30 minutes", "clean-inactive-tabs", {
    dangerous: true,
    confirmation: "Close tabs you visited more than 30 minutes ago? Unvisited tabs are kept.",
  });
  action("Close unvisited tabs", "clean-unvisited-tabs", {
    dangerous: true,
    confirmation: "Close unvisited tabs? Favorites are kept.",
  });
  action("Clean non-favorite tabs", "clean-active-workspace", { dangerous: true });

  for (const workspace of state.workspaces) {
    const option = document.createElement("option");
    option.value = workspace;
    option.textContent = workspace;
    option.selected = workspace === state.activeWorkspace;
    routeWorkspace.append(option);

    if (!matches(workspace)) {
      continue;
    }
    const button = document.createElement("button");
    button.textContent = workspace;
    button.setAttribute("aria-current", String(workspace === state.activeWorkspace));
    button.addEventListener("click", () => send("switch-workspace", { workspace }));
    workspaces.append(button);
  }

  for (const route of state.trafficRules) {
    const row = document.createElement("div");
    row.className = "route";

    const meta = document.createElement("div");
    meta.className = "route-meta";
    const type = document.createElement("span");
    type.className = "route-type";
    type.textContent = route.type;
    const destination = document.createElement("span");
    destination.className = "route-workspace";
    destination.textContent = `→ ${route.workspace}`;
    meta.append(type, destination);

    const label = document.createElement("span");
    label.className = "route-value";
    label.textContent = route.value;
    label.title = `${route.type}: ${route.value}`;

    const acts = document.createElement("div");
    acts.className = "route-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      routeType.value = route.type;
      routeValue.value = route.value;
      routeWorkspace.value = route.workspace;
      document.querySelector(".traffic-control").open = true;
      routeValue.focus();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Remove route";
    remove.addEventListener("click", () => send("remove-traffic-rule", { id: route.id }));
    acts.append(edit, remove);

    row.append(meta, label, acts);
    routes.append(row);
  }

  for (const rule of state.duplicateRules || []) {
    const row = document.createElement("div");
    row.className = "route";

    const meta = document.createElement("div");
    meta.className = "route-meta";
    const type = document.createElement("span");
    type.className = "route-type";
    type.textContent = rule.type;
    const destination = document.createElement("span");
    destination.className = "route-workspace";
    destination.textContent = "duplication on";
    meta.append(type, destination);

    const label = document.createElement("span");
    label.className = "route-value";
    label.textContent = rule.value;
    label.title = `${rule.type}: ${rule.value}`;

    const acts = document.createElement("div");
    acts.className = "route-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Remove duplicate allow rule";
    remove.addEventListener("click", () => send("remove-duplicate-rule", { id: rule.id }));
    acts.append(remove);

    row.append(meta, label, acts);
    duplicateRules.append(row);
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  await send("create-workspace", { name: name.value });
  name.value = "";
});

routeForm.addEventListener("submit", async event => {
  event.preventDefault();
  const result = await browser.runtime.sendMessage({
    type: "create-traffic-rule",
    ruleType: routeType.value,
    value: routeValue.value,
    workspace: routeWorkspace.value,
  });
  routeStatus.textContent = result?.ok ? "Route saved" : "Enter a valid URL or domain";
  if (result?.ok) {
    routeValue.value = "";
  }
  await render();
});

duplicateForm.addEventListener("submit", async event => {
  event.preventDefault();
  const result = await browser.runtime.sendMessage({
    type: "create-duplicate-rule",
    ruleType: duplicateType.value,
    value: duplicateValue.value,
  });
  duplicateStatus.textContent = result?.ok ? "Duplicate rule saved" : "Enter a valid URL or domain";
  if (result?.ok) {
    duplicateValue.value = "";
  }
  await render();
});

search.addEventListener("input", render);
search.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    window.close();
  }
  if (event.key === "Enter") {
    const first = document.querySelector("#actions button, #workspaces button");
    if (first) {
      event.preventDefault();
      first.click();
    }
  }
});

closePalette.addEventListener("click", () => window.close());

render();
search.focus();
