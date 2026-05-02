# KMind Zen for Obsidian

[中文说明](./README_zh_CN.md)

KMind Zen is a next-generation professional mind mapping tool. Website: https://kmind.app

KMind Zen was rebuilt from the ground up, with a redesigned core, interface, and interaction model for greater flexibility and long-term extensibility. Today, KMind Zen is available as a SiYuan plugin, an Obsidian plugin, a web app, and an OpenClaw Skill. A standalone desktop app is also on the way.

## What's new in 0.4.0 (2026-05-03)

- The Project Popover now uses visual layout and theme cards, including light/dark theme previews, rainbow edge settings, and background color presets plus custom color input.
- The root-node theme switching popover now shows visual layout, theme, and edge route previews before applying changes.
- Layout, theme, and edge route names are localized in the Obsidian plugin UI.
- KMind Zen now uses the shared KMind core 0.3.0.

## Installation

KMind Zen is not yet available in the Obsidian Community Plugins marketplace because the review process is still ongoing.

If you want to use KMind Zen in Obsidian right now, the recommended approach is to install it manually with BRAT:

- Install and enable the BRAT plugin in Obsidian.
- Add the KMind Zen for Obsidian repository in BRAT: `https://github.com/suka233/obsidian-kmind-zen.git`
- Follow BRAT's prompts to install and enable the plugin.

## Licensing and disclosures

- KMind Zen for Obsidian is a closed-source commercial plugin. The public repository is used for release metadata and installable assets. Source access for marketplace review can be granted separately to authorized reviewers through a private audit repository.
- Most plugin features are free to use, with unlimited mind maps and no node-count limit. Only some advanced features require a commercial license. A free trial is available, and paid activation uses an email address plus a license key. Global users can contact `kmind_app@outlook.com` for purchase, upgrade, or activation support.
- The plugin connects to KMind services at `https://kmind.app` for trial claims, license activation and refresh, pricing, and purchase sessions. In the current code path, those requests send licensing-related fields such as email address, license key, and selected offer or coupon.
- Map files remain local `.kmindz` files in your vault. The license flow does not upload mind map document contents.
- The plugin stores local license state in Obsidian's local browser storage, including a device keypair, signed lease, and refresh token.
- The plugin reads and writes `.kmindz` maps and related asset or history files inside the current Obsidian vault.
- No dedicated telemetry or analytics pipeline is bundled.

## Features

- Every KMind Zen host runs on the same core. A single KMind Zen source file can move smoothly between SiYuan, Obsidian, the web app, and the upcoming desktop app. You can also use the KMind Zen Skill with AI tools to turn source material into editable mind maps offline. One practical workflow is converting lecture or meeting recordings into KMind Zen documents that you can refine and archive later.
- A purpose-built `.kmindz.svg` source format. It contains the full editable source document while still being a valid SVG image, so you can preview the map without opening it first.
- Smart themes with both light and dark variants across the official theme set, switching automatically with no manual theme toggle required.
- Visual project settings for choosing layouts, themes, edge styles, rainbow edges, and background colors with less guesswork.
- Unlimited summary nesting, so summaries can contain their own summaries at any depth.
- Flexible cloze support for both nodes and notes, designed for memorization and review.
- An improved formula editor that can be opened quickly from the slash menu.
- Enhanced global search that goes beyond node text and also covers notes, comments, and more.
- Bidirectional links between nodes.
- Node comments that are distinct from notes and can be reviewed in chronological order, making it easier to revisit the thinking process behind a map.
- Refined drag-and-drop interactions for a smoother editing experience.
- Improved hyperlink support, including multiple links per node and custom icons for each link.
- A more polished Zen mode and read-only experience, with the current state clearly visible and easy to exit from the top-right corner.
- Core editing capabilities such as rich text nodes, rich text notes, multi-root maps, node images, TODOs, icons, notes, tags, format painter, and relationship lines.

## Built for Obsidian

- Inside Obsidian, KMind Zen uses the `.kmindz` file extension so maps can be opened directly in the editor. Aside from the extension, `.kmindz` is identical to the `.kmindz.svg` format used on other KMind Zen hosts.

## Roadmap

- [ ] AI features
- [ ] Submaps
- [ ] Flowcharts
- [ ] Handwriting
- [ ] Collaboration

## Limitations

- The current marketplace submission targets desktop only. Mobile is not part of the supported surface for this release.
