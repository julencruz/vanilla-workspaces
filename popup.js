const workspaces = document.querySelector("#workspaces");
const form = document.querySelector("#new-workspace");
const name = document.querySelector("#workspace-name");
const activeWorkspace = document.querySelector("#active-workspace");
const workspaceCount = document.querySelector("#workspace-count");
const favorites = document.querySelector("#favorites");
const openAllFavorites = document.querySelector("#open-all-favorites");
const renameWorkspace = document.querySelector("#rename-workspace");
const workspaceIcon = document.querySelector("#workspace-icon");
const workspaceColors = document.querySelectorAll("#workspace-colors button");
const saveWorkspaceStyleButton = document.querySelector("#save-workspace-style");
let selectedColor = "#0060df";

async function render() {
  const state = await browser.runtime.sendMessage({ type: "get-state" });
  activeWorkspace.textContent = state.activeWorkspace;
  workspaceCount.textContent = state.workspaces.length;
  const style = state.workspaceStyles[state.activeWorkspace] || { icon: "●", color: "#0060df" };
  workspaceIcon.value = style.icon;
  selectedColor = style.color;
  for (const color of workspaceColors) {
    color.setAttribute("aria-pressed", String(color.dataset.color === selectedColor));
  }
  workspaces.replaceChildren();
  favorites.replaceChildren();

  const workspaceFavorites = state.workspaceFavorites[state.activeWorkspace] || [];
  openAllFavorites.disabled = workspaceFavorites.length === 0;
  for (const [index, favorite] of workspaceFavorites.entries()) {
    const row = document.createElement("div");
    row.className = "favorite";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "favorite-open";
    open.textContent = favorite.title;
    open.title = favorite.url;
    open.addEventListener("click", () => browser.runtime.sendMessage({
      type: "open-favorite",
      workspace: state.activeWorkspace,
      url: favorite.url,
    }));
    const moveUp = document.createElement("button");
    moveUp.type = "button";
    moveUp.className = "favorite-move";
    moveUp.textContent = "↑";
    moveUp.title = "Move up";
    moveUp.disabled = index === 0;
    moveUp.addEventListener("click", async () => {
      await browser.runtime.sendMessage({
        type: "move-favorite",
        workspace: state.activeWorkspace,
        url: favorite.url,
        direction: -1,
      });
      await render();
    });
    const moveDown = document.createElement("button");
    moveDown.type = "button";
    moveDown.className = "favorite-move";
    moveDown.textContent = "↓";
    moveDown.title = "Move down";
    moveDown.disabled = index === workspaceFavorites.length - 1;
    moveDown.addEventListener("click", async () => {
      await browser.runtime.sendMessage({
        type: "move-favorite",
        workspace: state.activeWorkspace,
        url: favorite.url,
        direction: 1,
      });
      await render();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "favorite-remove";
    remove.textContent = "×";
    remove.title = `Remove ${favorite.title}`;
    remove.addEventListener("click", async () => {
      await browser.runtime.sendMessage({
        type: "remove-favorite",
        workspace: state.activeWorkspace,
        url: favorite.url,
      });
      await render();
    });
    row.append(open, moveUp, moveDown, remove);
    favorites.append(row);
  }

  for (const workspace of state.workspaces) {
    const row = document.createElement("div");
    row.className = "workspace";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = workspace;
    button.className = "workspace-button";
    button.setAttribute("aria-current", String(workspace === state.activeWorkspace));
    button.addEventListener("click", async () => {
      await browser.runtime.sendMessage({ type: "switch-workspace", workspace });
      await render();
    });
    row.append(button);

    if (state.workspaces.length > 1) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-workspace";
      remove.textContent = "×";
      remove.title = `Delete ${workspace}`;
      remove.setAttribute("aria-label", `Delete ${workspace}`);
      remove.addEventListener("click", async () => {
        if (confirm(`Delete ${workspace}? Its tabs will be closed.`)) {
          await browser.runtime.sendMessage({ type: "delete-workspace", workspace });
          await render();
        }
      });
      row.append(remove);
    }
    workspaces.append(row);

  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  await browser.runtime.sendMessage({ type: "create-workspace", name: name.value });
  name.value = "";
  await render();
});

renameWorkspace.addEventListener("click", async () => {
  const state = await browser.runtime.sendMessage({ type: "get-state" });
  const name = prompt("Workspace name", state.activeWorkspace)?.trim();
  if (!name || name === state.activeWorkspace) {
    return;
  }
  await browser.runtime.sendMessage({
    type: "rename-workspace",
    workspace: state.activeWorkspace,
    name,
  });
  await render();
});

openAllFavorites.addEventListener("click", async () => {
  const state = await browser.runtime.sendMessage({ type: "get-state" });
  await browser.runtime.sendMessage({
    type: "open-all-favorites",
    workspace: state.activeWorkspace,
  });
});

async function saveWorkspaceStyle() {
  const state = await browser.runtime.sendMessage({ type: "get-state" });
  await browser.runtime.sendMessage({
    type: "set-workspace-style",
    workspace: state.activeWorkspace,
    icon: workspaceIcon.value,
    color: selectedColor,
  });
  saveWorkspaceStyleButton.textContent = "Saved";
  setTimeout(() => {
    saveWorkspaceStyleButton.textContent = "Save";
  }, 1000);
}

saveWorkspaceStyleButton.addEventListener("click", saveWorkspaceStyle);

for (const color of workspaceColors) {
  color.addEventListener("click", () => {
    selectedColor = color.dataset.color;
    for (const option of workspaceColors) {
      option.setAttribute("aria-pressed", String(option === color));
    }
  });
}

render();
