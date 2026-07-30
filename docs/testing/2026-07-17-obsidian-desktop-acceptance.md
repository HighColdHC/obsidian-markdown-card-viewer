# Obsidian Desktop 验收记录

日期：2026-07-17

## 环境

- 设备：Mac16,10，Apple M4，16 GB 内存
- 系统：macOS 26.2（25C56）
- Obsidian：1.12.7，Electron 39.8.3
- 测试 Vault：`test-vault`
- 测试规模：10,009 个 Markdown 文件，其中 10,000 个为规模数据
- Vault 大小：39 MB

## 结果

| 验收项 | 结果 | 证据 |
|---|---|---|
| 插件加载、Ribbon 打开单卡 | 通过 | 真实 Obsidian 隔离实例 |
| 文件夹递归范围 | 通过 | `Cards` 显示 7 个 Markdown，含子文件夹和独立卡片 |
| Graph / Grid / Masonry / List | 通过 | 四种布局连续切换无控制台错误 |
| Markdown 原生渲染 | 通过 | 标题、Properties、Callout、表格、代码、任务、WikiLink、本地 SVG |
| 只读任务 | 通过 | 2 个任务复选框均为 disabled |
| 长文内部滚动 | 通过 | 卡片可滚动，插件根容器横向溢出为 0 |
| 图谱边界 | 通过 | 内部、外部一跳、缺失、独立节点均显示；缺失节点为虚线且不创建文件 |
| 图谱交互 | 通过 | 节点选择更新右侧全文；拖动位置写入插件设置并可恢复 |
| 单卡进入 | 通过 | 网格/瀑布流点击卡片进入单卡；链接保留自身导航 |
| 增量刷新 | 通过 | 单文件刷新只触发 1 次正文读取，未重建其余 6 张可见卡 |
| 10,000 文件 | 通过 | 首次图谱约 4.6 秒；远景 700 个节点 DOM；网格 9 张可见卡；列表 18 行 |
| 正文惰性读取 | 通过 | 万卡图谱 1 次正文读取；切换网格后累计 10 次，无全量正文读取 |
| 内存与 DOM | 通过 | 图谱约 65.9 MB JS heap / 1,448 个元素；网格约 79.1 MB / 186 个元素 |
| 源码只读静态检查 | 通过 | `npm run check:readonly` |
| Vault 前后快照 | 通过 | 10,010 个非配置文件，SHA-256 前后一致：`f615f91b7da6d1d72ea51b7ca09144e4471087a81c2ec3f474b7c37fd143c3f8` |
| 自动测试与构建 | 通过 | 2 个 Vitest 测试文件通过；TypeScript 与 esbuild 构建通过 |

## 截图

- `test-artifacts/obsidian-card-viewer-single.png`
- `test-artifacts/obsidian-card-viewer-graph.png`
- `test-artifacts/obsidian-card-viewer-grid.png`
- `test-artifacts/obsidian-card-viewer-masonry.png`
- `test-artifacts/obsidian-card-viewer-list.png`
- `test-artifacts/obsidian-card-viewer-missing-node.png`
- `test-artifacts/obsidian-card-viewer-10000-grid.png`

## 复验命令

```bash
npm install
npm run verify
node scripts/install-test-vault.mjs
node scripts/hash-vault.mjs test-vault
```

## 2026-07-19 体验优化回归

版本：`0.2.0`

- 单卡取消重复路径、标题、日期和只读元信息；正文保留唯一 H1；
- 摘要改为原生 Markdown 渲染，Callout、表格、列表、WikiLink 和图片不再退化为纯文本符号；
- 网格摘要高度统一为 340px；瀑布流按可见内容测量，功能样本得到 278–480px 的真实高度；
- 列表阅读卡宽度由 340px 提升至 560px，选中行增加强调色；
- 图谱改为确定性关系布局，加入箭头、一跳邻居高亮、无关节点淡化、当前节点定位和关系来源面板；
- 图谱详情宽度可拖动，并按文件夹保存；旧布局坐标通过布局版本迁移自动清理；
- 10,000 文件图谱打开约 2.7 秒，701 个可见节点、1 次正文读取、无横向溢出；
- 10,000 文件网格渲染 12 张可见卡，累计 13 次正文读取；
- 5 个 Vitest 测试文件、6 个测试、只读静态检查、TypeScript 和 esbuild 构建全部通过；
- 回归前后 Vault 仍为 10,010 个非配置文件，SHA-256 保持不变。

优化后截图位于：

- `output/playwright/optimized-single.png`
- `output/playwright/optimized-graph.png`
- `output/playwright/optimized-grid.png`
- `output/playwright/optimized-masonry.png`
- `output/playwright/optimized-list.png`
- `output/playwright/optimized-10000-grid.png`

## 2026-07-20 随机刷卡模式验收

版本：`0.3.0`

- 单卡页可从当前卡片进入刷卡模式，当前卡固定为第一张，父文件夹递归范围内其余卡片随机排列；
- 文件夹视图可切换“刷卡”，并可“换一批”重新随机后续顺序；
- 每屏一张完整 Markdown 卡片并纵向吸附；滚轮、上下方向键、PageUp、PageDown、空格和界面按钮可切换；
- 长文实测先在卡片内部滚动，到达底部后下一次滚轮切到下一张；
- 7 文件范围最多渲染 5 张卡；10,000 文件范围首屏渲染 3 张卡，进度为 `1 / 10000`，无横向溢出；
- 6 个 Vitest 文件、8 个测试、只读静态检查、TypeScript 和 esbuild 构建全部通过；
- 截图：`output/playwright/feed-folder.png`、`output/playwright/feed-from-single.png`、`output/playwright/feed-10000.png`。

## 2026-07-20 多媒体播放协调验收

版本：`0.3.1`

- 临时样本包含 3 张 960 × 420 图片和 2 个 640 × 360 视频，均按 Markdown 顺序在同一卡片内纵向渲染；
- 图片和视频均自适应卡片宽度至 302px，两个视频使用 Obsidian 原生控件、加载状态为可播放，初始均暂停；
- 播放第二个视频后，第一个视频立即暂停且进度保持在约 0.35 秒；
- 刷到下一张卡后，上一视频暂停且进度稳定在约 0.41 秒；刷回后进度不变并保持暂停；
- 离开插件视图前正在播放的视频会暂停；无控制台错误、无横向溢出；
- 7 个 Vitest 文件、10 个测试、只读静态检查、TypeScript 和 esbuild 构建全部通过；
- 截图：`output/playwright/media-playback-coordination.png`。

## 2026-07-26 InfoOS 真实拉取验收

版本：`0.4.0`

环境与安全边界：

- Linux InfoOS 测试环境通过 SSH 回环隧道暴露为 `http://127.0.0.1:8000`；
- 使用仅含 `cards:read + assets:read` 的临时 Token；
- Obsidian 设置页连接测试显示 InfoOS v1 就绪，Token 输入框类型为 `password`；
- 验收结束后服务端临时 Token 已撤销，测试 Vault 插件数据中的 Token 已清空；
- `.gitignore` 已排除插件 `data.json` 和 `test-vault/InfoOS E2E/`，发布包只允许三个正式插件文件。

首次同步：

- 从真实 Linux InfoOS 拉取 274 张卡，全部生成受管 Markdown；
- 下载 91 个本地附件：45 个 MP4、45 个 JPG、1 个 WebP，总测试目录约 721 MB；
- 不再产生 MIME 不明的 `.bin` 媒体；MIME 缺失时通过文件头识别 JPG/WebP；
- 一张真实混合媒体卡在 Obsidian 中得到 1 张图片和 1 个视频；
- 图片 `complete=true`、`naturalWidth=480`，视频 `readyState=4`、`networkState=1`；
- 图片和视频均使用 Vault 本地 `app://` 资源地址，不依赖带认证的远端媒体 URL；
- `Cards` 文件夹显示 274 个 Markdown，图谱渲染 282 个含一跳关系节点；
- 文件夹可进入纵向刷卡模式，首屏按需渲染 3 张卡并显示 `1 / 274`。

增量与写入边界：

- 第二次同步结果：新增 0、更新 0、未变化 274；
- InfoOS 请求审计记录只有 2 次分页目录请求，卡片详情请求 0、附件请求 0；
- 同步目录共 365 个文件，前后 SHA-256 均为 `a3c5f2cea6407491826b9a8107735de12c6745c157cc1788a52d26d82da8f991`；
- 抽检卡片 mtime 前后均为 `1785058703`；
- 目标目录之外的 10,010 个非配置文件组合哈希前后均为 `dd8ead60a7875c9fcc33c74eac1a9a2d7d31292600bf9223ecf721d8b46406d7`。

自动验证：

- 12 个 Vitest 文件、31 个测试全部通过；
- TypeScript、esbuild 和 Vault 写入白名单检查通过；
- 写入 API 只允许存在于 `src/infoos/vault-materializer.ts`；
- 发布 ZIP 仅包含 `main.js`、`manifest.json`、`styles.css`。

截图：

- `output/playwright/infoos-connection-success.png`
- `output/playwright/infoos-secure-sync-success.png`
- `output/playwright/infoos-card-local-media.png`
- `output/playwright/infoos-folder-graph.png`
- `output/playwright/infoos-folder-feed.png`
