# Markdown Card Viewer

Obsidian Desktop 插件，用卡片、关系图谱、网格、瀑布流、列表和纵向刷卡方式查看 Vault 中的 Markdown。

插件还支持选择性物化：使用请求地址和 Bearer Token 显式刷新 InfoOS 远端目录，选择卡片“收下”到 Vault；附件仅在用户明确离线保存时写入。它不做定时同步、双向同步、远程删除、卡片编辑、采集、脚本或 Agent 调度。

## 安装

### BRAT（推荐）

1. 在 Obsidian 社区插件中安装并启用 `BRAT`；
2. 执行命令 `BRAT: Add a beta plugin for testing`；
3. 填入 `https://github.com/HighColdHC/obsidian-markdown-card-viewer`；
4. 安装完成后，在“第三方插件”中启用 `Markdown Card Viewer`。

BRAT 会从 GitHub Release 下载版本一致的 `main.js`、`manifest.json` 和 `styles.css`。

### 手动安装

从 [GitHub Releases](https://github.com/HighColdHC/obsidian-markdown-card-viewer/releases) 下载与同一版本对应的：

- `main.js`
- `manifest.json`
- `styles.css`

将三个文件放入 Vault 的 `.obsidian/plugins/markdown-card-viewer/`，然后在 Obsidian 的“第三方插件”中启用。

## InfoOS 选择性物化

在 Obsidian 的 `设置 → 第三方插件 → Markdown Card Viewer` 中填写：

- 请求地址：远程服务必须使用 HTTPS；SSH 隧道可使用 `http://127.0.0.1:端口`；
- Token：需要 `cards:read`，有附件的卡片还需要 `assets:read`；
- 目标文件夹：默认 `InfoOS`。

先在设置中点击“测试连接”，再从功能区或命令“打开 InfoOS 目录”。新安装默认不订阅任何信息源：先进入“信息源”，刷新并选择要订阅的来源，保存后再到“远端卡片”刷新目录。旧安装继续保留原有的全部来源行为，直到用户明确修改订阅。

“刷新目录”只更新本地缓存，不写 Vault；远端卡片和信息源列表按页展示；在远端卡片中勾选并点击“收下”才会生成薄 Markdown。已收下卡片可明确更新或停止跟踪（不会删除文件）。

默认文件布局：

```text
InfoOS/
├── Cards/
│   └── <card-id>--<hash>.md
└── Assets/
    └── <card-id>--<hash>/
        └── <asset-id>--<hash>.<ext>
```

插件用 `card_id + version + content_hash` 判断变化。目录缓存绑定 API 地址、当前 Vault 的随机标识和目标文件夹；远端卡片消失不会删除本地文件；非受管同名文件不会被覆盖。旧版的已下载资产仅在“本地离线资产”审计中只读展示，不会自动迁移或删除。

Token 保存在当前 Vault 的本地插件数据文件中。插件不会把 Token 写入日志或 Markdown。

信息源选择同样只保存在当前 Vault 的插件数据中，并绑定请求地址、Vault 和目标文件夹。选择为空时插件不会请求卡片目录；服务端未声明 `source_id` 筛选能力时，插件会停止而不会退化为全量请求。

`InfoOS → 连接` 页面可以查看当前 Obsidian 会话最近 100 条脱敏请求日志。日志只包含时间、HTTP 方法、脱敏路由、状态码和耗时，不保存 Token、正文、主机、卡片/资产 ID、查询值或错误原文；重启 Obsidian 后自动清空。

## 开发验证

```bash
npm install
npm run verify
```

构建产物为 `main.js`、`manifest.json` 和 `styles.css`。

发布前运行：

```bash
npm run package:release
```

生成的 ZIP 只包含上述三个文件，不会带入测试 Vault、插件 `data.json`、Token 或同步卡片。

## 许可证

[MIT](LICENSE)
