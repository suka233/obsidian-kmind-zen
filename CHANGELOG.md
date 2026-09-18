# KMind Zen Obsidian Changelog

## 0.33.0 - 2026-09-17

### English

#### Fixes

- Fix a possible blank screen when saving an edited note or clicking outside to close it, on both desktop and mobile.

### 中文

#### 修复

- 修复编辑备注后，保存或点击外部关闭时可能导致界面白屏的问题，覆盖桌面端和移动端。

## 0.32.0 - 2026-09-16

### English

#### New

- Add horizontal and vertical timeline layouts.
- Add left- and right-facing fishbone layouts with support for multi-level nodes and summaries.

#### Fixes

- Fix layout settings such as compact density and node spacing not being restored correctly when reopening some mind maps.
- Fix layout density changes sometimes having no effect unless another option was selected first.
- Fix the keyboard editing accessory bar sometimes remaining visible after finishing note editing on mobile.
- Fix some older mind maps failing to open correctly because of legacy file and image validation metadata.
- Fix some older mind maps triggering a migration save when opened before any editing.
- Fix false save conflict reports that could occur when quickly closing, reopening, or switching submaps after saving.

#### Improvements

- Improve on-demand loading of image display resources to reduce unnecessary requests for off-screen nodes.
- Improve viewport adjustment during mobile editing to reduce obstruction of the content being edited by the soft keyboard and editing accessory bar.
- Improve import compatibility for some older mind map files to reduce incorrect blocking caused by legacy validation metadata.
- Improve original-file backup and resource compatibility handling when saving older mind maps for the first time.
- Improve save handoff when closing and reopening mind maps to prevent preview writes from the old session interfering with the new session.

### 中文

#### 新增

- 新增横向、纵向时间轴布局。
- 新增左右两种鱼骨图布局，支持多级节点和概要。

#### 修复

- 修复部分导图重新打开后，紧凑密度、节点间距等布局设置未正确恢复的问题。
- 修复部分情况下切换布局密度没有反应，需要先切换其他选项的问题。
- 修复移动端备注结束编辑后，键盘编辑附件栏可能残留的问题。
- 修复部分旧版导图因历史文件及图片校验信息而无法正常打开的问题。
- 修复部分旧导图仅打开、尚未编辑就触发迁移保存的问题。
- 修复导图保存后快速关闭、重开或切换子图时，可能误报保存冲突的问题。

#### 优化

- 优化图片显示资源的按需加载，减少屏外节点不必要的资源请求。
- 优化移动端编辑时的视口避让，减少软键盘和编辑附件栏遮挡正在编辑内容的情况。
- 改善部分旧版导图文件的导入兼容性，减少历史校验信息导致的误拦截。
- 完善旧版导图首次保存时的原件备份与资源兼容处理。
- 优化关闭与重新打开导图时的保存交接，避免旧会话的预览写入干扰新会话。

## 0.31.0 - 2026-09-14

### English

#### New

- Add a “WebView compatibility rendering” toggle to improve misaligned images, cloze content, and other node content on some mobile devices. Disabled by default. Access it from the toolbar below the mind map in mobile mode → WebView compatibility rendering.

### 中文

#### 新增

- 新增“WebView 兼容渲染”开关，用于改善部分移动设备中图片、挖空等节点内容的显示错位。默认关闭，入口：移动端模式下导图下方工具栏 → WebView 兼容渲染


## 0.30.0 - 2026-09-11

### English

#### New

- Add formula shortcuts: type or paste $...$ in node content and notes to create inline formulas, or use $$...$$ in a standalone paragraph to create block formulas.
- Provide a Backup & Recovery Toolkit at the bottom of the history panel to help export backup mind maps where possible when disk issues, sync issues, or other problems occur. Reminder: your data is invaluable—please back up your local knowledge base regularly.

#### Fixes

- Fix relationship lines not updating their preview in real time when adjusted by dragging.
- Fix selection loss and interaction issues that could occur when cancelling, switching, or closing the rich-text color picker.

#### Improvements

- Improve text and background color selection with a compact preset palette, options to clear colors, and access to more colors.
- Improve Chinese and English labels and hints for rich-text toolbars, node content, and note editing.

### 中文

#### 新增

- 支持公式快捷输入：在节点正文和备注中输入或粘贴 $...$ 转换为行内公式，独占段落的 $$...$$ 转换为块公式
- 历史版本面板底部提供“备份与恢复工具包”，在遇到磁盘、同步或其他问题时，帮助尽可能地导出导图备份。提示：数据无价，请定期备份本地知识库。

#### 修复

- 修复拖拽调整关联线时，线条未实时更新预览的问题。
- 修复富文本颜色选择器在取消、切换或关闭时可能出现的选区丢失与交互异常。

#### 优化

- 优化文字颜色和背景色选择，提供紧凑预设色板，支持清除颜色和选择更多颜色。
- 完善富文本工具栏、节点正文和备注编辑相关的中英文提示。


## 0.28.0 - 2026-08-28

### English

- Improve the visual presentation of save status and related interface feedback.
- Fix an issue where the canvas could become blank after expanding or collapsing nodes in a read-only map.
- Upgrade the core and continue performance improvements.
- Compatibility notice: This release upgrades the core in preparation for upcoming features. The file version of an existing map will be upgraded automatically when it is first edited and saved. After a map has been saved by this version, do not continue editing or saving it with an older plugin, as this may cause map save failures or other compatibility issues.

### 中文

- 优化保存状态等界面的视觉效果。
- 修复只读导图中展开或收缩节点后，画布可能变成空白的问题。
- 升级内核，继续优化性能。
- 兼容性提醒：由于本版本进行了内核升级以适配即将到来的新功能，本版本会在旧导图首次实际编辑并保存时自动升级文件版本。同一导图在新版本保存后，请不要再使用老版本插件继续编辑或保存，否则可能会出现导图保存失败等兼容性问题。

## 0.27.0 - 2026-08-12

### English

- Add cross-map and cross-host node copy and paste for single nodes, multi-selections, and complete node trees.
- Transfer node images, images in content and notes, embedded assets, and image icons into the target map's asset storage.
- Add failure-safe node cut with precise Undo; source nodes are removed only after a complete clipboard write.
- Provide readable rich text and plain text when copying to regular web pages and text editors.
- Validate and atomically import copied resources without leaving partial nodes or orphaned images after failure.
- Move desktop copy, cut, and save feedback into the top-right Zen/read-only mode capsule.
- Fix images disappearing after copying nodes to another map and the resulting target-map save failures.

### 中文

- 新增跨导图、跨端节点复制粘贴，支持单节点、多选节点及完整节点树。
- 节点图片、正文图片、备注图片、嵌入资源和图片图标会随节点写入目标导图资源存储。
- 新增失败安全且可精确撤销的节点剪切；只有完整写入剪贴板后才会删除源节点。
- 复制到普通网页和文本编辑器时提供可读的富文本或纯文本内容。
- 粘贴前完整校验并原子导入资源，失败后不留下不完整节点或孤立图片。
- 将桌面复制、剪切和保存反馈整合到右上角禅模式/只读模式胶囊。
- 修复带图片的节点复制到另一张导图后图片丢失，并可能导致目标导图保存失败的问题。

## 0.26.0 - 2026-08-11

### English

- Upgrade KaTeX to version 0.18.4.
- Add comprehensive formula autocomplete with around 1,022 completion candidates.
- Add case-sensitive formula completion and recognition for `\Gamma`, `\gamma`, and other commands and environments.
- Improve Tab navigation for multi-argument formulas, including Shift+Tab to return to the previous argument.
- Disable browser spell checking in formula inputs to prevent irrelevant spelling underlines on LaTeX commands.
- Improve visual feedback when dragging outline rows onto mind map nodes.

### 中文

- 升级 KaTeX 版本至 0.18.4。
- 新增更完善的公式自动补全，提供约 1022 个补全候选。
- 完善大小写敏感的公式补全与识别，例如 `\Gamma`、`\gamma`，以及其它命令和环境。
- 优化多参数公式的 Tab 导航，并支持使用 Shift+Tab 返回上一个参数。
- 关闭公式输入框的浏览器拼写检查，避免 LaTeX 命令出现无关的拼写波浪线。
- 优化大纲行拖拽到导图节点时的视觉交互效果。

## 0.25.0 - 2026-08-11

### English

- Add syntax hints and common syntax options to the formula editor.
- Add smart avoidance to the formula editor.
- Improve the responsiveness and feel of formula editing. If it still feels off, please keep the feedback coming—thank you!
- Improve formula syntax validation.
- Improve outline performance.
- Fix incorrect rendering of the not-equal sign in formulas.
- Update and upgrade the core as whiteboard feature development nears completion.
- Refactor the core for code quality and better performance.
- The standalone KMind Zen desktop app is now available on the Mac App Store. Search for "KMind Zen" to download it; signing in with a Founders Pass automatically unlocks the lifetime edition.

### 中文

- 公式编辑器新增语法提示与常用语法选项。
- 公式编辑器新增智能避让。
- 优化公式编辑器手感；如果仍有手感问题，请继续反馈，多谢～～
- 优化公式编辑语法检测。
- 优化大纲性能。
- 修复公式不等号渲染错误的问题。
- 更新并升级内核版本，白板功能开发已接近尾声。
- 内核质量性重构，优化性能。
- KMind Zen 独立客户端现已上架 Mac App Store，欢迎搜索 "KMind Zen" 下载体验；使用创始者通行证登录后可自动解锁永久版。

## 0.24.0 - 2026-07-16

### English

- Add image paste support to node content and outline rows, with drag-to-resize controls.
- Add image paste support to notes.
- Add drag-to-resize support for the notes popover.
- Improve outline editing so pressing Enter on a root row creates a child node instead of another root node.
- Keep the notes action buttons anchored to the bottom of the popover.
- Fix the notes Save button having no effect when clicked.

### 中文

- 新增节点正文与大纲行图片粘贴功能，支持拖拽调整图片大小。
- 新增备注区图片粘贴功能。
- 新增拖拽调节备注框大小。
- 优化大纲输入体验，在根节点按下 Enter 后默认创建子节点，而非新根节点。
- 优化备注悬浮窗布局，底部操作按钮始终贴底显示。
- 修复点击备注保存按钮没有响应的问题。

## 0.23.0 - 2026-07-13

### English

- Improve import handling with stricter filtering of invalid rich-text content.
- Improve import speed for large projects and preview refresh performance.
- Fix invalid node content preventing the outline from initializing.
- Fix the outline becoming unresponsive after expanding nodes.

### 中文

- 优化导入，更严格地过滤非法富文本内容。
- 优化大项目导入速度与预览图刷新性能。
- 修复非法节点内容导致大纲初始化失败的问题。
- 修复展开节点后大纲卡住的问题。

## 0.22.0 - 2026-07-08

### English

- Add the brace edge style for all current layouts.
- Add `.md`, `.opml`, `.txt`, and `.mm` (FreeMind) file import support.
- Add `.md`, `.opml`, `.mm`, and `.xmind` file export support.
- Remove the not-yet-adapted lecture export options.
- Update the core version to prepare for upcoming whiteboard elements.
- Improve core performance.

### 中文

- 新增大括号连线风格，当前的布局方式均可用。
- 新增 `.md`、`.opml`、`.txt`、`.mm` (FreeMind) 文件格式导入支持。
- 新增 `.md`、`.opml`、`.mm`、`.xmind` 文件格式导出支持。
- 移除暂未完全适配的知识讲义系列导出支持项。
- 升级内核版本，为即将到来的白板元素做准备。
- 优化内核性能。

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
