# Vanilla Workspaces

A minimal Firefox extension for organizing tabs into workspaces, routing links automatically, and preventing duplicate tabs.

## Features

- Create, rename, delete, and switch between workspaces.
- Keep tabs, favorites, and workspace appearance settings per workspace.
- Route links to a workspace by domain, URL prefix, or exact URL.
- Prevent duplicate tabs, with rules to allow duplicates for selected sites.
- Switch workspaces and manage favorites with keyboard shortcuts or the command palette.
- Close stale background tabs automatically after two hours; pinned tabs, active tabs, and favorites are kept.

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
| Previous workspace | `Command+Shift+Left` |
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
