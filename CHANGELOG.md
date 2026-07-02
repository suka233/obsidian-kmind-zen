# KMind Zen Obsidian Changelog

## 0.21.0 - 2026-07-03

### English

- Add node drag alignment guides.
- Update the core version to prepare for upcoming whiteboard elements.

### 中文

- 新增节点拖拽对齐辅助线。
- 升级内核版本，为即将到来的白板元素做准备。

## 0.20.0 - 2026-06-29

### English

- Add a Wheel behavior setting under Canvas interaction.
- Support direct wheel zoom, wheel panning with `Ctrl/Cmd` wheel zoom, and disabled wheel zoom.
- In wheel panning mode, vertical wheel pans up/down, horizontal wheel or `Shift + vertical wheel` pans left/right, and `Ctrl/Cmd + wheel` zooms.
- Keep the default wheel behavior as direct zoom.

### 中文

- 在画布操作习惯中新增“滚轮行为”设置。
- 支持直接缩放、滚轮平移并按 `Ctrl/Cmd` 缩放、关闭滚轮缩放三种模式。
- 在滚轮平移模式下，纵向滚轮上下平移，横向滚轮或 `Shift + 纵向滚轮` 左右平移，`Ctrl/Cmd + 滚轮` 缩放。
- 默认滚轮行为仍保持直接缩放。

## 0.19.0 - 2026-06-28

### English

- Add Tree Up and Tree Down layouts.
- Add the minimal Ink Branch theme.
- Add the Branch Line edge style, now also available in Theme Designer.
- Update the core layout engine.

### 中文

- 新增布局：向上树状图 & 向下树状图。
- 新增简洁主题：墨线枝干。
- 新增连线风格：枝干线，该风格在主题设计器中也能用啦～
- 更新内核布局引擎。

## 0.18.0 - 2026-06-27

### English

- Add Add Parent to the node context menu and shortcut settings.
- Add Move Node Up and Move Node Down with `Alt/Option+Up` and `Alt/Option+Down`.
- Add Collapse and Expand shortcuts: `Alt/Option+Left` and `Alt/Option+Right`.
- Update the core version.

### 中文

- 新增节点右键菜单「添加父节点」与对应快捷键配置。
- 新增上移节点、下移节点功能，快捷键为 `Alt/Option+Up`、`Alt/Option+Down`。
- 新增收缩、展开节点快捷键：`Alt/Option+Left`、`Alt/Option+Right`。
- 更新内核版本。

## 0.17.1 - 2026-06-25

### English

- Fix official notices and tutorials failing to load in the Obsidian update dialog.

### 中文

- 修复 Obsidian 更新弹框中官方通知和教程内容加载失败的问题。

## 0.17.0 - 2026-06-25

### English

- Add the update dialog and official changelog so users can view the current release and past updates.
- Remove the plugin-side `Ctrl/Cmd+N` default shortcut to avoid overriding Obsidian or system new-item behavior.

### 中文

- 新增更新日志弹框与官网更新日志，支持查看本次更新内容和以往更新。
- 移除插件端 `Ctrl/Cmd+N` 默认快捷键，避免覆盖 Obsidian 或系统的新建行为。

## 0.16.0 - 2026-06-23

### English

- Rework node editing into true in-place editing, keeping the editing area inside the node body for a smoother and more stable experience.
- Improve editing interaction and performance, especially around first-line input, multi-line growth, zoom, and mixed text sizes.
- Fix edge cases where exported PNG or SVG files could clip node body text.
- Disable spell checking in node body editing, notes, and Outline mode to reduce browser or host writing-assistant interference.

### 中文

- 重构节点编辑体验，支持真正的原地编辑，编辑区保持在节点正文内部，交互更稳定顺滑。
- 优化首行输入、多行增长、缩放和混合字号等场景下的编辑交互与性能。
- 修复极端情况下导出 PNG 或 SVG 时节点正文被截断的问题。
- 关闭节点正文、备注和大纲编辑中的拼写检查，减少浏览器或宿主写作辅助对导图编辑的干扰。

## 0.15.0 - 2026-06-22

### English

- Add node width resize handles so node content width can be adjusted directly on the canvas.
- Improve edge-case node width measurement to prevent node content from being clipped in dense text, formula, inline code, and export scenarios.

### 中文

- 新增节点宽度拖拽手柄，可在画布中直接调整节点内容宽度。
- 优化极端内容下的节点宽度测量，减少密集文本、公式、inline code 和导出场景中的节点内容裁剪问题。

## 0.14.1 - 2026-06-22

### English

- Align the Obsidian Outline and Split row controls with the web app by removing the host button background and inset shadows.
- Fix Outline row context menus inside Obsidian so they open next to the row instead of drifting to the far right.

### 中文

- 对齐 Obsidian 大纲 / 分屏行控件与 WebApp 视觉，移除宿主按钮样式带来的白色背景和内阴影。
- 修复 Obsidian 大纲行右键菜单定位，菜单会贴近当前行打开，不再偏到很右侧。

## 0.14.0 - 2026-06-20

### English

- Add Outline and Split modes alongside the map view.
- Edit the same mind map as a continuous outline while keeping selection, rich text, summaries, icons, and shortcuts synchronized with the map.
- Drag nodes between the map and outline in Split mode, including outline-to-map and map-to-outline moves.

### 中文

- 新增大纲与分屏模式，可在导图、大纲、分屏之间切换。
- 同一份导图可在连续大纲中编辑，选中、富文本、概要、图标和快捷键与导图保持同步。
- 分屏模式支持导图节点与大纲双向拖拽，可从大纲拖到导图，也可从导图拖回大纲。

## 0.13.0 - 2026-06-14

### English

- Improve the node relationship line editor and smart avoidance behavior.
- Add three relationship line types: straight, orthogonal, and rounded orthogonal.

### 中文

- 优化 节点关联线 编辑器，优化智能避让功能。
- 新增三种关联线类型：直线，正交连线，圆角正交连线。

## 0.12.1 - 2026-06-12

### English

- Fix the Todo context-menu shortcut hint.

### 中文

- 修复待办右键菜单快捷键提示。

## 0.12.0 - 2026-06-12

### English

- Add right-click actions to expand a node or the current map to 1-6 levels.
- Add quick expand/collapse actions for node subtrees and the current map.
- Keep the current-map menu switching between collapse and expand after the map is collapsed.

### 中文

- 新增右键按层级展开，可将节点或当前导图展开到 1-6 层。
- 新增节点子树和当前导图的快速展开 / 收起入口。
- 当前导图收起后，右键菜单会自动切换为展开当前导图。

## 0.11.2 - 2026-06-04

### English

- Update the marketplace manifest description

### 中文

- 更新插件市场 manifest 描述

## 0.11.1 - 2026-06-03

### English

- Improve Obsidian plugin copy.
- Improve quick-start and marketplace-facing guidance.
- Polish interaction copy and plugin presentation details.

### 中文

- 优化 Obsidian 插件文案。
- 优化快速上手和插件市场展示说明。
- 打磨交互文案和插件展示细节。

## 0.11.0 - 2026-05-21

### English

- Add a canvas drag habit setting with Pan-first and Select-first modes.
- In Select-first mode, drag blank map space to marquee-select and hold Space while dragging to pan.
- Keep Space reserved for canvas navigation so custom shortcuts do not interfere with panning.

### 中文

- 新增画布拖拽习惯设置，可在平移优先和选择优先之间切换。
- 选择优先模式下，导图空白处左键拖拽框选，按 Space + 左键拖拽平移画布。
- Space 会保留给画布导航使用，避免自定义快捷键影响平移操作。

## 0.10.0 - 2026-05-21

### English

- Add automatic image compression for inserted images in the plugin, enabled by default.
- Add direct node-image resizing.
- Add drag-and-drop node-image positioning across top, bottom, left, and right slots.

### 中文

- 插件端新增插入图片自动压缩配置，默认开启。
- 节点图片新增直接拖动调整大小。
- 节点图片支持拖拽到上、下、左、右方位。

## 0.9.1 - 2026-05-20

### English

- Improve dark-mode editing for nodes and rich-text notes.
- Improve dark-mode adaptation for rich-text toolbar dropdowns, link/cloze/slash/formula popovers, and context-menu scrollbars.
- Improve dark-mode adaptation for relationship-line creation and format-painter cursor-following hints.

### 中文

- 优化 dark 模式下的节点编辑和富文本备注编辑体验。
- 优化富文本工具栏下拉、链接 / 挖空 / 斜杠 / 公式浮层和右键菜单滚动条的 dark 适配。
- 优化关联线添加和格式刷的鼠标跟随提示的 dark 适配。

## 0.9.0 - 2026-05-18

### English

- Improve summary node localization and interaction details.
- Add bulk node dragging: after multi-selecting nodes, drag any selected node to move them together.
- Add automatic node centering when a map is first created.

### 中文

- 优化概要节点 i18n 和交互细节。
- 新增批量节点拖拽：多选节点后，按住任意已选中节点即可整体移动。
- 新增初次创建导图时，节点自动居中的功能。

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
