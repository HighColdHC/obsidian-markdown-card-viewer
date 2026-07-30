# InfoOS 卡片拉取需求

> 版本：v1.0
> 日期：2026-07-26
> 状态：已确认并进入实现
> 变更：为原 Markdown 卡片查看插件增加唯一的受控写入能力

## 1. 目标

用户在插件设置中填写 InfoOS 请求地址、Bearer Token 和目标文件夹，测试连接后手动拉取卡片。插件将远端完整正文和附件物化为本地 Markdown，再由现有单卡、多卡、关系图谱和刷卡视图读取。

## 2. 范围

插件新增：

- HTTPS 或本机 SSH 隧道连接；
- Token 认证；
- 连接测试；
- 手动拉取；
- 基于 `card_id + version + content_hash` 的增量比较；
- 完整正文、图片、视频、音频及其他附件的本地物化；
- 插件本地同步索引。

插件仍不负责：

- InfoOS 采集、处理、调度或服务端开发；
- 定时轮询、Webhook、推送、双向同步；
- 将本地修改回传 InfoOS；
- 因远端缺失而删除本地文件；
- 编辑、处理、流转、搜索、AI、Agent、脚本或 skill。

## 3. 接口

插件使用 InfoOS `/api/plugin/v1`：

- `GET /capabilities`
- `GET /health`
- `GET /cards?page_size=200&page_token=...`
- `GET /cards/{card_id}`
- `GET /assets/{asset_id}`

全部请求使用 `Authorization: Bearer <token>`。Token 不得进入日志、Notice、Markdown 或错误消息。

## 4. 安全与写入边界

- 远程地址只允许 HTTPS；
- HTTP 只允许 `localhost`、`127.0.0.1` 或 `::1`，用于 SSH 隧道；
- URL 不允许用户名、密码、查询参数或锚点；
- 所有文件只能写入用户指定的受管目标目录；
- Markdown 必须带 `infoos_managed: true` 和稳定 `infoos_card_id`；
- 只有受管标记和 `card_id` 同时匹配时才能覆盖；
- 路径冲突时停止该卡片，保留原文件；
- Vault 写 API 只允许集中存在于 `src/infoos/vault-materializer.ts`。

## 5. 同步语义

1. 先完整读取卡片目录，目录失败时不写任何文件；
2. 本地没有索引、版本变化、内容哈希变化或受管 Markdown 丢失时才请求详情；
3. 每张卡先取得详情及全部附件，最后提交 Markdown；
4. Markdown 成功后才更新该卡索引；
5. 单卡失败不阻塞其他卡片；
6. 失败卡片的旧 Markdown 与旧索引不变；
7. 重复同步时，未变化卡片零详情请求、零 Vault 写入；
8. 不自动删除孤立卡片或旧附件；
9. 同一时间只允许一个同步任务。

## 6. 本地布局

```text
<目标文件夹>/
├── Cards/<safe-card-id>.md
└── Assets/<safe-card-id>/<safe-asset-id>--<content-hash>.<ext>
```

卡片 Markdown 保存 InfoOS 身份、版本、内容哈希、来源和时间字段；正文块按 `position` 稳定排序并保留完整内容；附件使用本地 Obsidian 内嵌或链接语法。

## 7. 验收

- 设置页可以填写并遮罩 Token；
- 正确 Token 连接成功，401/403/网络/接口错误给出可行动中文提示；
- 首次拉取创建完整 Markdown 和附件；
- 第二次拉取不修改未变化文件；
- 单卡失败不损坏旧文件；
- 非受管文件不被覆盖；
- 新卡片能直接进入现有五种视图；
- 图片、视频和音频使用本地附件正常显示；
- 自动化测试、类型检查、构建与 Vault 写入边界检查全部通过；
- 真实 Linux InfoOS 经 SSH 隧道和真实 Obsidian Desktop 验收通过。
