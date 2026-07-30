import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";
import type { InfoOSCardCatalogItem, InfoOSCardDetail } from "../infoos/contracts";
import type MarkdownCardViewerPlugin from "../main";
import { InfoOSDownloadSession } from "./infoos-download-control";
import { EMPTY_INFOOS_FILTERS, catalogPresentationMetadata, orderedCatalog, uniqueValues, updateAvailable, type InfoOSLocalFilters } from "./infoos-view-model";

export const INFOOS_VIEW_TYPE = "infoos-selective-materialization";
type Section = "remote" | "accepted" | "offline" | "connection";

export class InfoOSView extends ItemView {
  private section: Section = "remote";
  private filters: InfoOSLocalFilters = { ...EMPTY_INFOOS_FILTERS };
  private readonly selected = new Set<string>();
  private transientResults: InfoOSCardCatalogItem[] | null = null;
  private readonly queriedItems = new Map<string, InfoOSCardCatalogItem>();
  private activeDownload: InfoOSDownloadSession | null = null;
  private readonly cardDetails = new Map<string, InfoOSCardDetail>();
  private assetCardId: string | null = null;
  private busy = false;
  private status = "目录仅使用本地缓存；刷新需要你明确点击。";

  constructor(leaf: WorkspaceLeaf, private readonly plugin: MarkdownCardViewerPlugin) { super(leaf); }
  getViewType(): string { return INFOOS_VIEW_TYPE; }
  getDisplayText(): string { return "InfoOS"; }
  getIcon(): string { return "database"; }
  async onOpen(): Promise<void> { this.contentEl.addClass("infoos-view-root"); this.render(); }
  async onClose(): Promise<void> { this.contentEl.empty(); }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    const header = root.createDiv({ cls: "infoos-header" });
    header.createDiv({ cls: "infoos-title", text: "InfoOS" });
    header.createDiv({ cls: "infoos-status", text: this.status });
    if (this.activeDownload) {
      const cancel = header.createEl("button", { text: "取消离线保存", cls: "infoos-cancel", attr: { type: "button" } });
      cancel.addEventListener("click", () => {
        this.activeDownload?.cancel();
        this.status = "正在取消离线保存…";
        cancel.disabled = true;
      });
    }
    const tabs = root.createDiv({ cls: "infoos-tabs" });
    (["remote", "accepted", "offline", "connection"] as Section[]).forEach((section) => {
      const labels: Record<Section, string> = { remote: "远端卡片", accepted: "已收下", offline: "本地离线资产", connection: "连接" };
      const button = tabs.createEl("button", { text: labels[section], cls: section === this.section ? "is-active" : "", attr: { type: "button" } });
      button.addEventListener("click", () => { this.section = section; this.render(); });
    });
    const body = root.createDiv({ cls: "infoos-body" });
    if (this.section === "remote") this.renderRemote(body);
    if (this.section === "accepted") this.renderAccepted(body);
    if (this.section === "offline") this.renderOffline(body);
    if (this.section === "connection") this.renderConnection(body);
  }

  private renderRemote(body: HTMLElement): void {
    const state = this.plugin.settings.infoOSSyncState;
    const scopeCurrent = this.plugin.isInfoOSStateCurrent();
    const all = scopeCurrent ? (state.catalog?.order.map((id) => state.catalog?.items[id]).filter(Boolean) as InfoOSCardCatalogItem[] ?? []) : [];
    const controls = body.createDiv({ cls: "infoos-controls" });
    const input = controls.createEl("input", { attr: { type: "search", placeholder: "缓存内筛标题/摘要；远端查标题/正文" } });
    input.value = this.filters.query;
    input.addEventListener("change", () => {
      this.filters.query = input.value;
      this.render();
    });
    this.addSelect(controls, "平台", uniqueValues(all.map((card) => card.source_platform)), this.filters.platform, (value) => { this.filters.platform = value; this.render(); });
    this.addSelect(controls, "完整度", uniqueValues(all.map((card) => card.completeness_status)), this.filters.completeness, (value) => { this.filters.completeness = value; this.render(); });
    this.addSelect(controls, "媒体", ["image", "video", "audio", "other"], this.filters.mediaKind, (value) => { this.filters.mediaKind = value; this.render(); });
    const refresh = controls.createEl("button", { text: this.busy ? "处理中…" : "刷新目录", cls: "mod-cta", attr: { type: "button" } });
    refresh.disabled = this.busy;
    refresh.addEventListener("click", () => void this.run(() => this.plugin.refreshInfoOSCatalog()));
    const remoteQuery = controls.createEl("button", { text: this.busy ? "处理中…" : "远端查询", attr: { type: "button" } });
    remoteQuery.disabled = this.busy;
    remoteQuery.addEventListener("click", () => void this.run(async () => {
      this.transientResults = await this.plugin.queryInfoOSCatalog(this.filters);
      for (const card of this.transientResults) this.queriedItems.set(card.card_id, card);
      return `远端查询返回 ${this.transientResults.length} 张；结果不会改写本地目录缓存。`;
    }));
    if (this.transientResults) {
      const reset = controls.createEl("button", { text: "返回缓存", attr: { type: "button" } });
      reset.disabled = this.busy;
      reset.addEventListener("click", () => { this.transientResults = null; this.status = "已返回本地目录缓存。"; this.render(); });
    }
    const cards = this.transientResults ?? (scopeCurrent ? orderedCatalog(state, this.filters) : []);
    const action = body.createDiv({ cls: "infoos-actionbar" });
    action.setText(`${this.transientResults ? "远端查询" : "缓存"} ${this.transientResults ? this.transientResults.length : all.length} 张，显示 ${cards.length} 张，已选 ${this.selected.size} 张。`);
    const accept = action.createEl("button", { text: `收下已选（${this.selected.size}）`, cls: "mod-cta", attr: { type: "button" } });
    accept.disabled = this.busy || this.selected.size === 0;
    accept.addEventListener("click", () => void this.run(async () => {
      const message = await this.plugin.materializeInfoOSCards(
        [...this.selected],
        [...this.queriedItems.values()]
      );
      this.selected.clear();
      return message;
    }));
    if (!cards.length) { body.createDiv({ cls: "infoos-empty", text: this.transientResults ? "远端查询没有结果。可返回缓存继续本地筛选。" : !scopeCurrent && state.catalog?.order.length ? "现有缓存属于其他 API、Vault 或目标文件夹，不会在当前范围展示。" : all.length ? "没有符合当前本地筛选的卡片。" : "尚无缓存目录。点击“刷新目录”后才会请求 InfoOS。" }); return; }
    const list = body.createDiv({ cls: "infoos-card-list" });
    cards.forEach((card) => this.renderRemoteCard(list, card));
  }

  private renderRemoteCard(parent: HTMLElement, card: InfoOSCardCatalogItem): void {
    const entry = this.plugin.settings.infoOSSyncState.entries[card.card_id];
    const row = parent.createDiv({ cls: "infoos-card-row" });
    const check = row.createEl("input", { attr: { type: "checkbox", "aria-label": `选择 ${card.title}` } });
    check.checked = this.selected.has(card.card_id);
    check.addEventListener("change", () => { check.checked ? this.selected.add(card.card_id) : this.selected.delete(card.card_id); this.render(); });
    const content = row.createDiv({ cls: "infoos-card-content" });
    content.createEl("strong", { text: card.title || card.card_id });
    content.createDiv({ cls: "infoos-meta", text: catalogPresentationMetadata(card).join(" · ") });
    if (card.excerpt) content.createDiv({ cls: "infoos-excerpt", text: card.excerpt });
    if (entry) content.createDiv({ cls: updateAvailable(entry, card) ? "infoos-badge is-update" : "infoos-badge", text: updateAvailable(entry, card) ? "有更新" : "已收下" });
    this.externalLink(row, "在 InfoOS 打开", this.plugin.getInfoOSCardDeepLink(card.card_id));
  }

  private renderAccepted(body: HTMLElement): void {
    const state = this.plugin.settings.infoOSSyncState;
    const entries = this.plugin.isInfoOSStateCurrent() ? Object.values(state.entries) : [];
    body.createDiv({ cls: "infoos-summary", text: `已收下 ${entries.length} 张；停止跟踪只移除索引，不删除 Markdown。` });
    if (!entries.length) { body.createDiv({ cls: "infoos-empty", text: "尚未收下任何卡片。" }); return; }
    const list = body.createDiv({ cls: "infoos-card-list" });
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).forEach((entry) => {
      const remote = state.catalog?.items[entry.cardId];
      const row = list.createDiv({ cls: "infoos-card-row" });
      const content = row.createDiv({ cls: "infoos-card-content" });
      content.createEl("strong", { text: remote?.title || entry.cardId });
      content.createDiv({ cls: "infoos-meta", text: entry.markdownPath });
      content.createDiv({ cls: !remote ? "infoos-badge is-missing" : updateAvailable(entry, remote) ? "infoos-badge is-update" : "infoos-badge", text: !remote ? "当前缓存未找到（本地保留）" : updateAvailable(entry, remote) ? "有更新" : "已是最新" });
      if (remote && updateAvailable(entry, remote)) this.button(row, "更新", () => this.run(() => this.plugin.updateInfoOSCards([entry.cardId])));
      if (remote) {
        this.externalLink(row, "在 InfoOS 打开", this.plugin.getInfoOSCardDeepLink(entry.cardId));
        this.button(row, this.assetCardId === entry.cardId ? "收起资产" : "管理资产", async () => {
          if (this.assetCardId === entry.cardId) {
            this.assetCardId = null;
            this.render();
            return;
          }
          this.assetCardId = entry.cardId;
          if (!this.cardDetails.has(entry.cardId)) {
            this.busy = true;
            this.status = "正在读取资产元数据…";
            this.render();
            try {
              this.cardDetails.set(
                entry.cardId,
                await this.plugin.getInfoOSCardDetail(entry.cardId)
              );
              this.status = "资产元数据已加载；离线保存前会显示大小和目标路径。";
            } catch (error) {
              this.assetCardId = null;
              this.status = errorMessage(error);
              new Notice(this.status);
            } finally {
              this.busy = false;
              this.render();
            }
          } else {
            this.render();
          }
        });
      }
      this.button(row, "停止跟踪", async () => { if (window.confirm("停止跟踪不会删除本地 Markdown。继续？")) { await this.plugin.stopTrackingInfoOSCards([entry.cardId]); this.status = "已停止跟踪，本地文件未删除。"; this.render(); } });
      if (this.assetCardId === entry.cardId) {
        const detail = this.cardDetails.get(entry.cardId);
        if (detail) this.renderAssetManager(list, detail);
      }
    });
  }

  private renderAssetManager(parent: HTMLElement, detail: InfoOSCardDetail): void {
    const panel = parent.createDiv({ cls: "infoos-asset-manager" });
    panel.createEl("h4", { text: `资产 · ${detail.assets.length}` });
    if (!detail.assets.length) {
      panel.createDiv({ cls: "infoos-empty", text: "这张卡没有可交付资产。" });
      return;
    }
    const record = this.plugin.settings.infoOSSyncState.entries[detail.card.card_id];
    for (const asset of detail.assets) {
      const offline = record?.offlineAssets[asset.asset_id];
      const row = panel.createDiv({ cls: "infoos-asset-row" });
      const content = row.createDiv({ cls: "infoos-card-content" });
      content.createEl("strong", { text: asset.title || asset.asset_id });
      content.createDiv({
        cls: "infoos-meta",
        text: [
          asset.kind,
          asset.size_bytes == null ? "大小未知" : formatBytes(asset.size_bytes),
          asset.duration_seconds == null ? null : `${asset.duration_seconds} 秒`,
          offline ? `已保存：${offline.path}` : null
        ].filter(Boolean).join(" · ")
      });
      this.externalLink(
        row,
        asset.kind === "video" || asset.kind === "audio" ? "在 InfoOS 播放" : "在 InfoOS 打开",
        this.plugin.getInfoOSAssetDeepLink(detail.card.card_id, asset.asset_id)
      );
      if (!offline && asset.status === "ready") {
        this.button(row, "离线保存", async () => {
          const target = this.plugin.getInfoOSOfflineAssetPath(
            detail.card.card_id,
            asset.asset_id,
            asset.content_hash,
            asset.mime_type
          );
          const size = asset.size_bytes == null ? "服务端未提供大小" : formatBytes(asset.size_bytes);
          if (!window.confirm(`离线保存这个资产？\n大小：${size}\n目标：${target}`)) return;
          await this.runDownload(async (download, onCommitStart) => {
            await this.plugin.saveInfoOSAsset(detail.card.card_id, asset.asset_id, download, onCommitStart);
            return `已离线保存 ${asset.asset_id}。`;
          });
        });
      }
    }
  }

  private renderOffline(body: HTMLElement): void {
    const entries = this.plugin.isInfoOSStateCurrent() ? Object.values(this.plugin.settings.infoOSSyncState.entries) : [];
    const assets = entries.flatMap((entry) => Object.values(entry.offlineAssets).map((asset) => ({ entry, asset })));
    body.createDiv({ cls: "infoos-summary", text: `已登记离线资产 ${assets.length} 个。删除会逐项确认并移入系统废纸篓。` });
    const audit = this.button(body, "读取旧受管目录审计", () => this.audit(body));
    audit.addClass("infoos-audit-button");
    const list = body.createDiv({ cls: "infoos-card-list" });
    assets.forEach(({ entry, asset }) => {
      const row = list.createDiv({ cls: "infoos-card-row" });
      const content = row.createDiv({ cls: "infoos-card-content" });
      content.createEl("strong", { text: asset.assetId });
      content.createDiv({ cls: "infoos-meta", text: `${asset.kind} · ${formatBytes(asset.sizeBytes)} · ${asset.path}` });
      this.button(row, "移入系统废纸篓", async () => { if (window.confirm(`将 ${asset.path} 移入系统废纸篓？`)) await this.run(async () => { await this.plugin.removeInfoOSAsset(entry.cardId, asset.assetId); return "已移入系统废纸篓。"; }); });
    });
    if (!assets.length) body.createDiv({ cls: "infoos-empty", text: "没有登记的离线资产；旧数据只会通过审计展示，不会自动迁移或删除。" });
  }

  private renderConnection(body: HTMLElement): void {
    body.createDiv({ cls: "infoos-summary", text: "连接信息在 Obsidian 设置 → Markdown Card Viewer 中编辑。测试只验证 cards:read，并报告 assets:read；不会请求 captures:write。" });
    this.button(body, this.busy ? "测试中…" : "测试连接", () => this.run(() => this.plugin.testInfoOSConnection()));
  }

  private async audit(body: HTMLElement): Promise<void> {
    try {
      const audit = await this.plugin.createInfoOSMaterializer().auditManagedTarget(this.plugin.settings.infoOSTargetFolder);
      this.status = `旧目录审计：受管 Markdown ${audit.managedMarkdownCount}，可薄化 ${audit.convertibleToThinCount}，孤儿资产 ${audit.orphanAssetCount}。`;
      body.createDiv({ cls: "infoos-audit", text: `${this.status} 图片 ${audit.assets.image.count}/${formatBytes(audit.assets.image.bytes)}，视频 ${audit.assets.video.count}/${formatBytes(audit.assets.video.bytes)}，音频 ${audit.assets.audio.count}/${formatBytes(audit.assets.audio.bytes)}，其他 ${audit.assets.other.count}/${formatBytes(audit.assets.other.bytes)}。` });
    } catch (error) { this.status = errorMessage(error); this.render(); }
  }

  private addSelect(parent: HTMLElement, label: string, values: string[], value: string, onChange: (value: string) => void): void {
    const select = parent.createEl("select", { attr: { "aria-label": label } });
    select.createEl("option", { text: label, value: "" });
    values.forEach((item) => select.createEl("option", { text: item, value: item })); select.value = value;
    select.addEventListener("change", () => onChange(select.value));
  }
  private button(parent: HTMLElement, text: string, action: () => void | Promise<void>): HTMLButtonElement {
    const button = parent.createEl("button", { text, attr: { type: "button" } }); button.disabled = this.busy;
    button.addEventListener("click", () => void action()); return button;
  }
  private externalLink(parent: HTMLElement, text: string, href: string): HTMLAnchorElement {
    return parent.createEl("a", {
      text,
      cls: "infoos-link-button",
      href,
      attr: { rel: "noopener noreferrer" }
    });
  }
  private async run(action: () => Promise<string>): Promise<void> {
    if (this.busy) return; this.busy = true; this.render();
    try { this.status = await action(); } catch (error) { this.status = errorMessage(error); new Notice(this.status); } finally { this.busy = false; this.render(); }
  }

  private async runDownload(
    action: (download: InfoOSDownloadSession, onCommitStart: () => void) => Promise<string>
  ): Promise<void> {
    if (this.busy) return;
    const download = new InfoOSDownloadSession();
    this.activeDownload = download;
    this.busy = true;
    this.render();
    const onCommitStart = (): void => {
      this.activeDownload = null;
      this.status = "下载与校验完成，正在登记本地资产；此阶段不可取消。";
      this.render();
    };
    try {
      this.status = await action(download, onCommitStart);
      download.complete();
    } catch (error) {
      this.status = download.phase === "cancelled"
        ? "已取消离线保存，未登记本地资产。"
        : errorMessage(error);
      if (download.phase !== "cancelled") new Notice(this.status);
    } finally {
      this.activeDownload = null;
      this.busy = false;
      this.render();
    }
  }
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "InfoOS 操作失败。"; }
