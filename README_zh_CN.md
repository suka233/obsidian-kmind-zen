# KMind Zen Obsidian 插件

这是用于 Obsidian 市场审核测试的公开源码快照仓库。

## 源码边界

本仓库包含 Obsidian 宿主适配层源码、插件 manifest、样式、引导资源与发布元数据。KMind Zen 共享内核包（例如 '@kmind/core'、'@kmind/app'、'@kmind/editor-react'、'@kmind/app-react'、'@kmind/icons'、'@kmind/i18n'）仍为闭源专有代码，不包含在该公开快照中。

可安装产物由 KMind 私有构建流水线生成，并通过 GitHub Releases 上传 'main.js'、'manifest.json' 和 'styles.css'。

## 网络与数据披露

- 当前正式构建会连接 'https://kmind.app'，用于授权、试用、购买会话、价格和主题分享。
- 授权请求可能发送邮箱、授权码、所选套餐、优惠码、设备公钥、签名证明、lease 与 refresh token 等授权相关字段。
- 主题分享会发送选中的 '.kmind-theme.json' 主题包、语言和可选 shared content id。
- 导图文件仍以本地 '.kmindz' 文件形式保存在 Obsidian 仓库中，授权流程不会上传导图文档内容。
- 插件会在 Obsidian 本地浏览器存储中保存本地授权状态，包括设备密钥对、签名 lease 和 refresh token。
- 插件会在当前 Obsidian 仓库内读写 '.kmindz' 导图文件及其相关资源或历史文件。
- 未内置独立的遥测或统计上报管线。
