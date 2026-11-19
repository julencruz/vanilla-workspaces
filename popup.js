const workspaces = document.querySelector("#workspaces");
const form = document.querySelector("#new-workspace");
const name = document.querySelector("#workspace-name");
const activeWorkspace = document.querySelector("#active-workspace");
const workspaceCount = document.querySelector("#workspace-count");
const favorites = document.querySelector("#favorites");
const openAllFavorites = document.querySelector("#open-all-favorites");
const renameWorkspace = document.querySelector("#rename-workspace");
const workspaceIcon = document.querySelector("#workspace-icon");
const colorHex = document.querySelector("#workspace-color-hex");
const colorArea = document.querySelector("#color-area");
const colorAreaThumb = document.querySelector("#color-area-thumb");
const hueSlider = document.querySelector("#hue-slider");
const hueThumb = document.querySelector("#hue-thumb");
const appearancePreview = document.querySelector("#appearance-preview");
const saveWorkspaceStyleButton = document.querySelector("#save-workspace-style");
let selectedColor = "#0060df";

let hsv = hexToHsv(APPEARANCE_DEFAULT.color);

function paintAppearance({ updateHex = true } = {}) {
  selectedColor = hsvToHex(hsv);
  colorArea.style.setProperty("--hue-color", hsvToHex({ h: hsv.h, s: 1, v: 1 }));
  colorAreaThumb.style.left = `${hsv.s * 100}%`;
  colorAreaThumb.style.top = `${(1 - hsv.v) * 100}%`;
  hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
  hueSlider.setAttribute("aria-valuenow", String(Math.round(hsv.h)));
  appearancePreview.style.background = selectedColor;
  appearancePreview.style.color = readableOn(selectedColor);
  appearancePreview.textContent = clampIcon(workspaceIcon.value) || APPEARANCE_DEFAULT.icon;
  if (updateHex) {
    colorHex.value = selectedColor;
    colorHex.removeAttribute("aria-invalid");
  }
}

function setSelectedColor(color) {
  hsv = hexToHsv(normalizeHex(color) || APPEARANCE_DEFAULT.color);
  paintAppearance();
}

function dragOn(element, onMove) {
  element.addEventListener("pointerdown", event => {
    element.setPointerCapture(event.pointerId);
    const move = moveEvent => {
      const box = element.getBoundingClientRect();
      onMove(
        Math.min(1, Math.max(0, (moveEvent.clientX - box.left) / box.width)),
        Math.min(1, Math.max(0, (moveEvent.clientY - box.top) / box.height)),
      );
    };
    move(event);
    element.addEventListener("pointermove", move);
    const stop = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
    };
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  });
}

dragOn(colorArea, (x, y) => {
  hsv = { ...hsv, s: x, v: 1 - y };
  paintAppearance();
});

dragOn(hueSlider, x => {
  hsv = { ...hsv, h: x * 360 };
  paintAppearance();
});

function nudge(event, apply) {
  const step = event.shiftKey ? 0.1 : 0.02;
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
  if (delta) {
    event.preventDefault();
    apply(delta[0], delta[1]);
    paintAppearance();
  }
}

colorArea.addEventListener("keydown", event => nudge(event, (dx, dy) => {
  hsv = { ...hsv, s: Math.min(1, Math.max(0, hsv.s + dx)), v: Math.min(1, Math.max(0, hsv.v - dy)) };
}));

hueSlider.addEventListener("keydown", event => nudge(event, dx => {
  hsv = { ...hsv, h: Math.min(360, Math.max(0, hsv.h + dx * 360)) };
}));

colorHex.addEventListener("input", () => {
  const hex = normalizeHex(colorHex.value);
  if (hex) {
    hsv = hexToHsv(hex);
    paintAppearance({ updateHex: false });
    colorHex.removeAttribute("aria-invalid");
  } else {
    colorHex.setAttribute("aria-invalid", "true");
  }
});

colorHex.addEventListener("blur", () => paintAppearance());

workspaceIcon.addEventListener("input", () => {
  const clamped = clampIcon(workspaceIcon.value);
  if (clamped !== workspaceIcon.value.trim() && workspaceIcon.value.trim()) {
    workspaceIcon.value = clamped;
  }
  paintAppearance({ updateHex: false });
});

async function send(message) {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return browser.runtime.sendMessage({ ...message, windowId: tab?.windowId });
}

async function sendAndRender(message) {
  await send(message);
  await render();
}

async function render() {
  const state = await send({ type: "get-state" });
  activeWorkspace.textContent = state.activeWorkspace;
  workspaceCount.textContent = state.workspaces.length;
  const style = state.workspaceStyles[state.activeWorkspace] || { icon: "●", color: "#0060df" };
  workspaceIcon.value = style.icon;
  setSelectedColor(style.color);
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
    open.addEventListener("click", () => sendAndRender({
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
      await send({
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
      await send({
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
      await send({
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
      await sendAndRender({ type: "switch-workspace", workspace });
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
          await sendAndRender({ type: "delete-workspace", workspace });
        }
      });
      row.append(remove);
    }
    workspaces.append(row);

  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  await send({ type: "create-workspace", name: name.value });
  name.value = "";
  await render();
});

renameWorkspace.addEventListener("click", async () => {
  const state = await send({ type: "get-state" });
  const name = prompt("Workspace name", state.activeWorkspace)?.trim();
  if (!name || name === state.activeWorkspace) {
    return;
  }
  await send({
    type: "rename-workspace",
    workspace: state.activeWorkspace,
    name,
  });
  await render();
});

openAllFavorites.addEventListener("click", async () => {
  const state = await send({ type: "get-state" });
  await send({
    type: "open-all-favorites",
    workspace: state.activeWorkspace,
  });
  await render();
});

async function saveWorkspaceStyle() {
  const state = await send({ type: "get-state" });
  await send({
    type: "set-workspace-style",
    workspace: state.activeWorkspace,
    icon: clampIcon(workspaceIcon.value) || APPEARANCE_DEFAULT.icon,
    color: selectedColor,
  });
  saveWorkspaceStyleButton.textContent = "Saved";
  setTimeout(() => {
    saveWorkspaceStyleButton.textContent = "Save";
  }, 1000);
}

saveWorkspaceStyleButton.addEventListener("click", saveWorkspaceStyle);

render();
