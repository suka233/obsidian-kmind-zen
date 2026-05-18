# KMind Zen Obsidian Changelog

## 0.8.0 - 2026-05-18

### English

- Improve relationship line editing and interactions, with new dashed and dotted line styles.
- Add relationship line color configuration for clearer cross-branch structure.
- Add project-level relationship line settings so maps can keep a consistent relationship style.
- Add relationship line support for summaries.

### 中文

- 优化关联线功能与交互，新增虚线 / 点线样式选择。
- 新增关联线颜色配置，让跨分支关系表达更清晰。
- 新增项目级别关联线配置，便于整张导图保持统一的关联线风格。
- 为概要新增关联线支持。

## 0.7.0 - 2026-05-17

### English

- Add polished PNG export with the currently available clean window frame style.
- Add PNG clarity options in the export dialog so exported images can balance size and sharpness.
- Improve the canvas and node "Copy as image" context menu with visual style previews for original and window-framed images.
- Improve context-menu submenu hover tolerance.

### 中文

- 普通 PNG 导出新增图片美化能力，当前开放简洁窗口外框风格。
- 导出弹窗新增 PNG 清晰度选择，可在文件体积和图片清晰度之间按需取舍。
- 画布和节点右键“复制为图片”升级为带预览的样式选择，支持原图和窗口外框图片。
- 优化右键菜单二级菜单的悬停宽限。

## 0.6.0 - 2026-05-15

### English

- Design and save local KMind Zen themes directly inside the Obsidian plugin.
- Import and export `.kmind-theme.json` packages for offline theme sharing.
- Apply local themes from the map theme popover after saving or importing them.
- Use compact, default, and relaxed project density presets to adjust map spacing quickly.
- Upgrade the shared KMind core to 0.5.0, improve performance, fix theme spacing isolation, and improve core-layout vertical spacing stability.

### 中文

- 可以直接在 Obsidian 插件中设计并保存本地 KMind Zen 主题。
- 支持导入 / 导出 `.kmind-theme.json` 离线主题分享包。
- 保存或导入本地主题后，可以从导图内主题 Popover 应用到当前项目。
- 项目设置新增紧凑、默认、舒展三档密度预设，用于快速调整导图间距。
- 更新内核至 0.5.0，优化性能，修复主题间距隔离问题，并优化内核布局的纵向间距稳定性。

## 0.5.0 - 2026-05-09

### English

- Add shortcut customization in the Obsidian plugin settings, scoped to KMind Zen views.
- Add a rich-text shortcut reference for node text, notes, and comments.
- Show the current shortcut next to supported context-menu actions, including custom bindings.
- Add more default shortcuts for notes, comments, zoom reset, submaps, and common copy/paste actions.

### 中文

- 新增 Obsidian 插件快捷键配置，并且只作用于 KMind Zen 视图。
- 快捷键面板新增富文本快捷键提示，覆盖节点正文、备注和批注编辑。
- 右键菜单会在对应操作旁显示当前真实快捷键，包括用户自定义后的快捷键。
- 补齐备注、批注、重置缩放、子导图和常用复制粘贴操作的默认快捷键。

## 0.4.1 - 2026-05-08

### English

- Upgrade the shared KMind core to 0.4.0.
- Improve the large-map editing experience, including smoother viewing, zooming, and rendering in the Obsidian view.
- Align the Obsidian plugin with the latest web and SiYuan performance improvements.

### 中文

- 将共享 KMind 内核升级到 0.4.0。
- 优化大图编辑体验，导图较大时浏览、缩放和渲染更顺滑。
- 与 WebApp、思源插件同步最新性能优化。

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
