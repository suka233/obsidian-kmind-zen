# KMind Zen Obsidian Changelog

## 0.4.0 - 2026-05-03

### English

- Redesign the Project Popover with visual layout cards, light/dark theme previews, rainbow edge settings, and background color presets plus custom color input.
- Redesign the root-node theme switching popover with visual layout, theme, and edge route previews, making layout and line style changes easier to compare before applying.
- Localize layout, theme, and edge route display names across the Obsidian plugin UI.
- Upgrade the shared KMind core to 0.3.0.

### 中文

- 重构 Project Popover，改为可视化布局卡片、明暗主题预览、彩虹连线设置、背景色预设和自定义颜色输入。
- 重构根节点“切换主题”Popover，用可视化卡片展示布局、主题和连线路由，方便用户在应用前比较效果。
- 为 Obsidian 插件界面补齐布局、主题和连线路由的本地化展示名。
- 将共享 KMind 内核升级到 0.3.0。

## 0.3.1 - 2026-05-02

### English

- Fix node context menu behavior after multi-selecting nodes: right-clicking an already selected node now keeps the full multi-selection highlighted.
- Make node context menu actions use the node that was right-clicked as their explicit target, including copy, todo, submap, expand, and collapse actions.
- Keep delete behavior aligned with multi-selection, so deleting from the node context menu still deletes the selected node group.

### 中文

- 修复多选节点后的右键菜单行为：右键某个已选节点时，其它已选节点会继续保持选中态。
- 节点右键菜单现在会以被右键的节点作为明确目标，覆盖复制、待办、子导图、展开和折叠等操作。
- 保持删除行为与多选语义一致，从节点右键菜单删除时仍会删除当前选中的节点组。

## 0.3.0 - 2026-04-29

### English

- Add XMind file import support through the shared KMind import flow.
- Support modern `.xmind` files with `content.json`, including topic trees, free topics, multi-sheet projects, notes, labels, hyperlinks, images, relationships, and summaries.
- Report unsupported XMind features before import, and fail clearly for legacy XML, encrypted files, or unsupported zip compression.

### 中文

- 通过共享 KMind 导入流程新增 XMind 文件导入支持。
- 支持现代 `.xmind` 文件中的 `content.json`，包括主题树、自由主题、多画布项目、备注、标签、超链接、图片、关联线和概要。
- 导入前提示暂不支持的 XMind 特性；旧版 XML、加密文件或不支持的 zip 压缩方式会明确失败。

## 0.2.0 - 2026-04-29

### English

- Upgrade the shared KMind core to 0.2.0.
- Fix chemical equation rendering in extreme cases, including mhchem labels that contain CJK text.

### 中文

- 将共享 KMind 内核升级到 0.2.0。
- 修复极端情况下的化学方程式渲染问题，包括 mhchem 条件标签中包含中文时的显示异常。

## 0.1.0 - 2026-03-24

- Prepare the initial Obsidian plugin release for community review.
- Add a release-only publishing flow for `manifest.json`, `versions.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, Git tag, and GitHub Release assets.
- Align the plugin production build with `https://kmind.app` and the production signing public key flow.
- Add marketplace review disclosures for licensing, network use, local storage, and vault file access.
- Mark the current submission as desktop-only.
