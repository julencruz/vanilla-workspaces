# Vanilla Workspaces

A minimal Firefox extension for organizing tabs into workspaces, routing links automatically, and preventing duplicate tabs.

## Features

- Create, rename, delete, and switch between workspaces.
- Keep tabs, favorites, and workspace appearance settings per workspace. Use any emoji or up to two characters as the icon, and pick any color with the built-in picker or a hex code.
- Switching workspaces only hides and shows tabs; it does not move tabs between workspaces. New tabs belong to the active workspace, and existing tabs move only when explicitly assigned.
- Route links to a workspace by domain, URL prefix, or exact URL.
- Prevent duplicate tabs across all workspaces: opening a URL that is already open elsewhere switches to that workspace and tab. Rules can allow duplicates for selected sites.
- Consolidate duplicate Firefox New Tab, Home, and Private Browsing start pages within each workspace.
- Switch workspaces and manage favorites with keyboard shortcuts or the command palette. Toggle between the current and previous workspace without cycling through the full list.
- Keep a global list of pinned tabs (command palette → Pinned tabs). Choose whether each entry matches its exact URL or any URL on the same site. They are created and re-pinned automatically if closed or unpinned, and are shown in every workspace.
- Export and import your configuration (workspaces, styles, favorites, routes, duplicate rules, pinned tabs) as a JSON file from the command palette. Imports are validated and open tabs are kept.
- Pause inactivity timers and playing audio/video in tabs of hidden workspaces; both resume when you return.
- Close tabs that have never been activated after 30 minutes, and tabs left inactive for over two hours. Pinned tabs, favorites, active tabs, and tabs playing audio are kept.

## Install for development

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Select **Load Temporary Add-on…**.
3. Choose this directory's `manifest.json`.

Temporary add-ons are removed when Firefox closes. For a permanent installation, the extension needs to be packaged and signed by Mozilla.

## Keyboard shortcuts

Default shortcuts use the `Command` key on macOS. They can be changed in Firefox under **Add-ons and themes → Extensions → Manage Extension Shortcuts**.

| Action | Default shortcut |
| --- | --- |
| Next workspace | `Command+Shift+Right` |
| Toggle to previous workspace | `Command+Shift+Left` |
| Toggle command palette | `Command+Shift+K` |
| Open all workspace favorites | `Command+Shift+Down` |
| Add current tab to favorites | `Command+Shift+Up` |

## Privacy

Vanilla Workspaces does not make network requests. Workspace settings, rules, and favorites are stored locally in Firefox; tab assignments are also stored in the browser's session data.

## Permissions

- `tabs`, `tabHide`: organize and hide tabs when switching workspaces.
- `storage`, `sessions`: persist workspace settings and restore tab assignments.
- `contextMenus`: add workspace and favorites actions to tab and link menus.
- `alarms`: periodically close stale, inactive tabs.
- `scripting` and access to all sites: pause and resume playing media in tabs of hidden workspaces. No page content is read or sent anywhere.
