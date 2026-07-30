# InfoOS 选择性物化与按需媒体需求

> 文档版本：v2.0
>
> 日期：2026-07-30
>
> 状态：主链路已确认并可实现；旧全量数据的显式迁移合同待补
>
> 取代：`2026-07-26-infoos-card-pull-requirements.md` 中“全量卡片、全部附件本地物化”的同步合同
>
> 保留：现有 Markdown 卡片查看、显式 WikiLink 和只读渲染边界

关联文档：

- InfoOS：[手动采集与按需媒体需求](../../../InfoOS/docs/product/2026-07-30-infoos-manual-browser-capture-and-on-demand-media-requirements.md)
- InfoOS：[Save to InfoOS 浏览器扩展需求](../../../InfoOS/docs/product/2026-07-30-save-to-infoos-browser-extension-requirements.md)
- 本项目：[Obsidian Markdown 卡片查看插件产品需求](../product/2026-07-17-obsidian-markdown-card-viewer-requirements.md)

## 1. 目标

插件继续承担 Markdown 卡片查看，并把 InfoOS 集成从“全量复制器”改为“远端目录 + 选择性物化器”：

> InfoOS 中的稳定信息卡默认只在插件远端目录中可见；只有用户明确“收下”，才在 Vault 生成薄 Markdown。视频和音频默认留在 InfoOS，需要时播放；只有用户明确离线保存时才写入 Vault。

## 2. 双入口边界

### 2.1 Obsidian Web Clipper

用户临时保存网页时，官方 Web Clipper 直接写入：

```text
00_收件箱/Web Clippings/
```

这些文件是用户自己的 Inbox Markdown：

- 插件可以像其他 Markdown 一样只读渲染；
- InfoOS 集成不得自动接管、改写或上传；
- 是否删除、提炼或转交 InfoOS 由用户在 Inbox 工作流中决定。

### 2.2 InfoOS 远端目录

InfoOS 入口形成稳定信息卡后，插件只读取远端目录。远端卡片不是 Vault 文件，直到用户明确物化。

两条入口不得自动合并正文。若用户后来把 Web Clipping 交给 InfoOS，原笔记只保留个人批注和可选 `infoos_card_id` 链接。

## 3. 产品边界

### 3.1 插件负责

- 测试 InfoOS 连接；
- 手动刷新远端稳定信息卡目录；
- 分页、查询和过滤远端目录；
- 展示卡片摘要、完整度和媒体概况；
- 将选中的远端卡片物化为薄 Markdown；
- 比较 `card_id + version + content_hash`；
- 显式更新已经物化的 InfoOS 管理区块；
- 按需请求私有图片并在插件渲染组件中显示；
- 打开 InfoOS 卡片或媒体播放器；
- 用户明确选择后离线保存单个资产；
- 用户明确选择后移除 InfoOS 受管的本地资产；
- 保存当前 Vault 的物化索引和离线资产索引。
- 展示仅限当前 Obsidian 会话的脱敏 InfoOS 请求日志。

### 3.2 插件不负责

- 自动全量创建 Markdown；
- 自动下载全部图片、视频、音频或其他附件；
- 定时同步、Webhook 或后台推送；
- 把本地修改回传 InfoOS；
- 因远端缺失自动删除本地 Markdown；
- 为远端卡片生成重要性评分或决策；
- 修改非 InfoOS 受管文件；
- 管理 Obsidian Web Clipper Inbox；
- 在插件内实现自定义视频 Range 代理或 MediaSource 播放器；
- 建立第二个卡片数据库、搜索引擎或 AI 系统。

## 4. 四级物化模型

| 级别 | 行为 | Vault 写入 |
|---|---|---|
| L0 远端目录 | 浏览 InfoOS 稳定卡片及资产元数据 | 无 |
| L1 薄 Markdown | 用户点击“收下” | 一篇受管 Markdown |
| L2 按需查看 | 私有图片按需读取；视频打开 InfoOS | 默认无附件 |
| L3 离线保存 | 用户显式选择单个资产 | 只写入所选资产 |

默认级别是 L0。连接 InfoOS、刷新目录或浏览卡片不能隐式升级为 L1/L2/L3。

## 5. 入口与页面

现有插件主入口继续按 Obsidian 当前文件或文件夹上下文打开本地 Markdown 视图。

新增独立的“InfoOS”页签：

- 远端卡片；
- 已收下；
- 本地离线资产；
- 连接设置。

连接页展示最近 100 条会话级请求日志，只记录时间、HTTP 方法、脱敏路由、状态码、耗时和结果类型。日志不持久化，不记录主机、卡片/资产 ID、查询值、正文、Token 或原始错误文本。

远端卡片页：

- 默认按 InfoOS `updated_at` 倒序或服务端稳定游标顺序；
- 支持标题/正文查询、平台、完整度和媒体类型过滤；
- 显示标题、平台、发布时间、摘要、完整度、图片/视频/音频数量；
- 支持单选和多选“收下”；
- 支持打开 InfoOS；
- 刷新必须由用户显式触发，MVP 不定时轮询。

这里的查询和过滤只作用于 InfoOS 远端目录，不为整个 Vault 增加搜索引擎，也不改变现有本地 Markdown 查看器“无复杂搜索/筛选”的边界。

## 6. InfoOS 接口

继续使用：

```text
{baseUrl}/api/plugin/v1
```

接口：

- `GET /capabilities`
- `GET /health`
- `GET /cards?page_size=...&page_token=...`
- `GET /cards/{card_id}`
- `GET /assets/{asset_id}`

目录可选过滤参数：

- `query`
- `platform`
- `completeness`
- `media_kind`

客户端必须兼容服务端忽略新过滤参数的旧实现；在 capabilities 未声明时，不发送对应参数。

Token：

- 目录和详情需要 `cards:read`；
- 私有图片和离线保存需要 `assets:read`；
- 不需要也不得请求 `captures:write`；
- Token 不得进入 Markdown、Notice、外链、资源 URL、日志或异常堆栈。

## 7. 远端目录本地状态

L0 目录缓存保存在插件配置数据中，不写入 Markdown：

- `card_id`
- `version`
- `content_hash`
- `title`
- `source_platform`
- `published_at`
- `updated_at`
- `completeness_status`
- `excerpt`
- `asset_summary`

缓存必须绑定：

- 规范化 InfoOS 服务地址；
- 当前 Vault ID；
- 物化目标目录。

切换地址、Vault 或目标目录时不能复用旧索引。

## 8. “收下”与薄 Markdown

### 8.1 目标目录

```text
<目标文件夹>/
├── Cards/<safe-card-id>.md
└── Assets/<safe-card-id>/<safe-asset-id>--<content-hash>.<ext>
```

L1 默认只创建 `Cards/` 下的 Markdown。没有离线资产时不创建该卡的 `Assets/` 文件夹。

### 8.2 Frontmatter

```yaml
---
infoos_managed: true
infoos_card_id: card_id
infoos_version: 1
infoos_content_hash: sha256
infoos_materialization: thin
infoos_source_platform: web
infoos_source_url: https://example.com/article
infoos_published_at: 2026-07-30T00:00:00Z
infoos_updated_at: 2026-07-30T00:00:00Z
infoos_offline_assets: []
---
```

必须保留：

- 稳定身份；
- 版本和内容哈希；
- 来源和时间；
- `thin` 物化模式；
- 当前本地离线资产 ID。

### 8.3 正文

薄 Markdown 包含：

- 标题；
- 原始正文；
- 引用和结构化文本；
- 视频转录；
- 正文/转录中文翻译；
- 中文 AI 解读；
- 缺口说明；
- 返回原始来源和 InfoOS 卡片的链接。

薄 Markdown 不包含：

- 完整原始 JSON；
- 完整 HTML 快照；
- 内部 task/run 事件；
- 视频和音频二进制；
- 所有图片二进制；
- Cookie、Token、内部本机路径。

## 9. InfoOS 管理区块与用户正文

同一文件分成两类区域：

1. 插件生成并可显式更新的 InfoOS 管理区块；
2. 用户自行增加的批注、WikiLink 和个人判断。

插件只能在以下条件同时成立时更新：

- 文件开头包含 `infoos_managed: true`；
- `infoos_card_id` 与目标卡片一致；
- 文件位于配置的受管目录；
- 管理区块边界完整；
- 用户明确执行“更新”。

建议管理区块：

```markdown
<!-- infoos:managed:start -->
...
<!-- infoos:managed:end -->
```

用户在管理区块外的内容必须逐字节保留。管理区块损坏时停止更新并提示冲突，不覆盖整篇文件。

MVP 不自动更新已收下卡片；远端有新版本时显示“有更新”，由用户确认。

## 10. 图片

### 10.1 默认行为

- 图片默认不下载到 Vault；
- Markdown 保存稳定的 InfoOS 资产占位信息；
- 插件阅读模式通过 `requestUrl` 携带 Bearer Token 按需读取；
- 图片响应只在当前渲染生命周期缓存，不写入普通网页缓存；
- 离开视图后释放 Blob URL；
- 图片加载失败时显示来源、大小、状态和“在 InfoOS 打开”。

建议使用受控代码块：

````markdown
```infoos-asset
{"asset_id":"asset_id","kind":"image","mode":"remote"}
```
````

插件通过 Markdown post processor 渲染该占位符。插件停用时，用户仍能看到可追踪的资产 ID。

### 10.2 离线保存

用户可以对单张图片点击“离线保存”：

1. 请求完整资产；
2. 校验 `size_bytes` 和 SHA-256；
3. 写入受管 `Assets/<card-id>/`；
4. 更新 `infoos_offline_assets`；
5. 后续优先显示本地文件。

## 11. 视频和音频

- 默认不下载；
- Markdown 只写封面/标题、时长、大小、转录、原始来源和“在 InfoOS 播放”；
- 点击播放打开 InfoOS Web 深链接；
- InfoOS 不可达时提供原始平台链接；
- 不在普通 Markdown 中写带 Bearer Token 的 URL；
- 不假设所有平台允许 iframe；
- MVP 不在 Obsidian 内实现私有视频流播放；
- 用户可以显式离线保存单个视频或音频，流程与图片相同；
- 离线保存前必须显示文件大小和目标路径。

## 12. 本地资产移除

插件提供“移除本地副本，保留薄笔记”：

- 只处理 `infoos_offline_assets` 中登记的文件；
- 只处理受管 `Assets/<card-id>/` 路径；
- 操作前展示数量、总大小和路径；
- 使用 Obsidian/系统废纸篓能力，不直接永久删除；
- 成功后更新索引和 frontmatter；
- 失败时保留索引并提示人工检查；
- 不删除 Markdown；
- 不通知 InfoOS 删除服务端资产。

批量清理必须作为独立确认动作，不随升级自动执行。该能力是 v2 对“InfoOS 受管本地附件”增加的唯一受控删除例外，不授权删除普通 Vault 文件。

## 13. 旧全量物化迁移

现有全量同步数据必须被视为用户数据，不自动删除。

插件提供只读审计：

- 已管理 Markdown 数；
- 本地图片、视频、音频和其他附件数；
- 各类型总字节；
- 可转换为 thin 的卡片数；
- 孤立或校验失败的资产。

迁移操作：

1. 用户选择一张或一批卡；
2. 插件生成变更预览；
3. 保留 Markdown 和用户区块；
4. 把媒体引用改为远端/InfoOS 播放入口；
5. 将原本地资产移动到废纸篓；
6. 更新物化和离线资产索引。

任何校验失败的卡片跳过，不影响其他卡片。

### 13.1 显式迁移的安全前置条件

旧 v1 Markdown 没有 InfoOS 管理区块边界，现有文件本身不能可靠区分“插件生成正文”和“用户后来追加或修改的正文”。因此，在补齐以下合同前：

- 如何识别 v1 插件生成的原始基线；
- 如何判定哪些字节属于用户内容；
- 变更预览需要展示的逐文件 Markdown 与资产差异；
- 批量确认的粒度、失败恢复和废纸篓回滚记录；
- 迁移后对旧附件引用和离线资产索引的确定性校验；

插件只提供只读审计，不提供会改写 Markdown 或移动旧资产的迁移按钮。不得用“当前文件看起来像旧模板”作为删除或改写依据。

## 14. 删除和所有权

- InfoOS 拥有远端信息卡和资产；
- 插件拥有当前 Vault 的物化索引和离线资产索引；
- 用户拥有管理区块外的 Markdown 内容；
- 远端卡片消失不删除本地笔记；
- “停止跟踪”只移除插件索引，不删除文件；
- 本地笔记删除不回传 InfoOS；
- 插件不维护服务端同步回执。

## 15. 错误与安全

- HTTPS 或 localhost HTTP 规则沿用现有实现；
- 外部 URL 永不携带 Bearer Token；
- 所有资产 URL 必须位于已配置的 `/api/plugin/v1/assets/`；
- 401、403、404、416、网络、校验和冲突错误分别提示；
- 单卡失败不影响其他选择；
- 请求和错误日志不包含 Token、正文和带敏感查询参数的 URL；
- 所有 Vault 写入集中在受审计 adapter；
- 非受管文件永不覆盖；
- 大资产下载支持取消，取消后不留下半文件。

## 16. 并行开发边界

Obsidian 插件实现方拥有：

- 远端目录 UI 和本地缓存；
- “收下”、显式更新和薄 Markdown；
- InfoOS 资产 post processor；
- 离线保存、校验和受控移除；
- 旧全量数据审计与显式迁移；
- Vault 安全边界和真实 Obsidian 验收。

InfoOS 实现方拥有：

- 目录字段和 capabilities；
- 资产读取和 Range；
- Web 深链接和认证播放器；
- 卡片/资产身份、版本、hash 和错误合同。

插件不得读取 InfoOS SQLite，也不得根据服务器目录结构构造本机文件路径。

## 17. MVP 验收

1. 远端存在 1,000 张稳定信息卡时，首次打开 L0 不创建 1,000 篇 Markdown，也不下载附件；
2. 点击“收下”一张卡只创建一篇 thin Markdown；
3. 再次刷新未变化卡片不写 Vault；
4. 有新版本时只提示，不自动覆盖；
5. 用户管理区块外的修改在显式更新后保持不变；
6. 私有图片可以在插件阅读模式按需显示，Token 不进入 Markdown；
7. 视频点击后打开正确 InfoOS 卡片/媒体；
8. 默认收下一张含视频卡片时，Vault 增加的视频字节为 0；
9. 离线保存一个资产只增加该资产，大小和 hash 校验通过；
10. 移除本地副本只处理登记资产并进入废纸篓；
11. 旧全量数据未经确认不发生删除或改写；
12. Web Clipper Inbox 文件不被 InfoOS 集成修改；
13. 自动化测试、类型检查、构建、写入边界检查和真实 Obsidian Desktop 验收通过；
14. 验收记录包含操作前后 Vault 文件数、各类附件数量和总字节。
