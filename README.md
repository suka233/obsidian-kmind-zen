# KMind Zen for Obsidian

[中文说明](./README_zh_CN.md)

Local-first mind maps for your Obsidian vault.

KMind Zen lets you create, organize, reopen, and refine `.kmindz` mind maps as real files inside Obsidian. Your maps stay in your vault, so your existing folders, sync, backups, and version-control habits continue to work.

![Create a KMind map from the command palette](./public/onboarding/obsidian-command.webp)

## Why KMind Zen for Obsidian

- **Local-first `.kmindz` files**: maps are saved in your vault instead of hidden inside an external cloud workspace.
- **Vault-native creation**: start from the command palette, or create a map exactly where it belongs from the file tree menu.
- **Reopen from the file tree**: click any `.kmindz` file later and continue editing the same local file.
- **Focused editing with Zen mode**: reduce interface noise when a map becomes complex, while keeping save status, history, export, and zoom close.
- **One KMind Zen format across hosts**: move maps between Obsidian, SiYuan, the Web App, and future desktop workflows.

## Quick Start

### 1. Create your first map from the command palette

Run `KMind: New map` from the Obsidian command palette. The plugin creates a new `.kmindz` file and opens it directly in the KMind view.

![Create a KMind map from the command palette](./public/onboarding/obsidian-command.webp)

### 2. Create a map exactly where it belongs

When you already know the project or topic folder for a map, right-click a folder or note in the Obsidian file tree and create a new KMind map there.

![Create a KMind map from the folder menu](./public/onboarding/obsidian-folder-menu.webp)

### 3. Reopen `.kmindz` files from your vault

After a map is created, it lives in the file tree like the rest of your vault files. Click it later to reopen the KMind view and keep editing the same local file.

![Reopen a .kmindz file from the vault](./public/onboarding/obsidian-open-file.webp)

### 4. Use Zen mode for complex structures

When a map grows, switch to Zen mode to quiet the interface and focus on structure. Frequent actions remain nearby when you need them.

![Use Zen mode in KMind Zen for Obsidian](./public/onboarding/obsidian-zen.webp)

## What Stays Local

- Mind maps remain local `.kmindz` files in your Obsidian vault.
- Autosave writes changes back to the same file.
- Your existing sync and backup setup can cover `.kmindz` files.
- License activation does not upload mind map document contents.
- The plugin reads and writes `.kmindz` maps and related asset or history files inside the current Obsidian vault.

## Features

- Rich-text mind map nodes and notes.
- Images, TODOs, icons, tags, comments, hyperlinks, format painter, and relationship lines.
- Multiple links per node, with custom icons.
- Project-level layouts, themes, edge styles, rainbow edges, and background color settings.
- Smart light and dark theme variants.
- Local theme designer and `.kmind-theme.json` import/export.
- PNG export and copy-as-image styles for cleaner sharing.
- Configurable canvas drag habits: pan-first or select-first.
- Keyboard shortcuts scoped to KMind Zen views.

## Installation

Recommended installation:

1. Open Obsidian Settings.
2. Go to Community plugins and search for `KMind Zen`.
3. Install and enable the plugin.

You can also use this repository with BRAT if you want to test a release before it reaches the marketplace update channel.

## Links

- Website: <https://kmind.app>
- Obsidian plugin page: <https://kmind.app/en/obsidian-plugin>
- Quick start guide: <https://kmind.app/en/tutorials/obsidian-local-first-mind-maps>
- `.kmindz` file guide: <https://kmind.app/en/tutorials/obsidian-kmindz-files>

## Privacy, Local Files, and Network Access

- The plugin connects to `https://kmind.app` in this production build for licensing, trial activation, purchase sessions, pricing, and theme sharing.
- License requests may send licensing-related fields such as email address, license key, selected offer, coupon code, device public key, signed proof, lease, and refresh token.
- Theme sharing sends the selected `.kmind-theme.json` package, language, and optional shared content id to KMind services.
- Mind map files remain local `.kmindz` files in the Obsidian vault. The license flow does not upload mind map document contents.
- The plugin stores local license state in Obsidian browser storage, including a device keypair, signed lease, and refresh token.
- No dedicated telemetry or analytics pipeline is bundled.

## For Reviewers: Source Boundary

This repository is a generated public source snapshot for Obsidian marketplace review. It contains the Obsidian host adapter source, plugin manifest, styles, onboarding assets, and release metadata for KMind Zen.

The Obsidian adapter source is included under `src/`. KMind Zen shared engine packages, such as `@kmind/core`, `@kmind/app`, `@kmind/editor-react`, `@kmind/app-react`, `@kmind/icons`, and `@kmind/i18n`, are proprietary and are not included in this public snapshot.

The installable release assets are generated by the private KMind build pipeline and uploaded to GitHub Releases as `main.js`, `manifest.json`, and `styles.css`.

## Release Metadata

- Source commit: `b34f6a939b8f648466f9978eca2481159d2dd635`
- Plugin version: `0.11.2`
- Minimum Obsidian version: `1.6.0`
