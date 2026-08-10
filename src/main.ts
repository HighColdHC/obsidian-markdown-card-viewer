import { MarkdownRenderChild, Menu, Notice, Plugin, TFile, TFolder, requestUrl } from "obsidian";
import { InfoOSClient, supportsCatalogFilter, supportsSourceFilter, type HttpRequester } from "./infoos/client";
import { EMPTY_INFOOS_CATALOG_CACHE, InfoOSPluginError, type InfoOSCardCatalogItem, type InfoOSCatalogFilters, type InfoOSSourceSubscription } from "./infoos/contracts";
import {
  appendInfoOSRequestLog,
  sanitizeInfoOSRequestLogRoute,
  type InfoOSRequestLogEntry
} from "./infoos/request-log";
import { InfoOSSyncEngine } from "./infoos/sync-engine";
import { InfoOSSession } from "./infoos/session";
import {
  defaultSourceSubscriptionMode,
  sourceSubscriptionForScope,
  sourceSubscriptionWithCatalog
} from "./infoos/source-subscriptions";
import {
  InfoOSVaultMaterializer,
  ObsidianVaultWriteAdapter,
  normalizeInfoOSTargetFolder
} from "./infoos/vault-materializer";
import {
  CardViewerSettingTab,
  DEFAULT_SETTINGS,
  type CardViewerSettings,
  type SettingsHost
} from "./settings";
import { normalizeSettings } from "./settings-model";
import { isScopeVisible, restoreAuthoritativeCatalog, withTransientCatalog } from "./ui/infoos-view-model";
import { validateInfoOSAssetRender } from "./ui/infoos-asset-validator";
import { InfoOSDownloadSession, mayCommitInfoOSDownload } from "./ui/infoos-download-control";
import { CARD_VIEW_TYPE, CardViewerView } from "./ui/card-viewer-view";
import { INFOOS_VIEW_TYPE, InfoOSView } from "./ui/infoos-view";

export default class MarkdownCardViewerPlugin extends Plugin implements SettingsHost {
  settings: CardViewerSettings = structuredClone(DEFAULT_SETTINGS);
  private saveTimer: number | null = null;
  private refreshTimer: number | null = null;
  private fileRefreshTimer: number | null = null;
  private readonly pendingFileRefreshes = new Map<string, TFile>();
  private infoOSRequestLog: InfoOSRequestLogEntry[] = [];
  private readonly infoOSSession = new InfoOSSession();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(CARD_VIEW_TYPE, (leaf) => new CardViewerView(leaf, this));
    this.registerView(INFOOS_VIEW_TYPE, (leaf) => new InfoOSView(leaf, this));
    this.addRibbonIcon("layout-grid", "打开 Markdown 卡片", () => {
      void this.openFromContext();
    });
    this.addCommand({
      id: "open-active-markdown-as-card",
      name: "将当前 Markdown 作为卡片打开",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) void this.activateView().then((view) => view.openSingle(file.path));
        return true;
      }
    });
    this.addCommand({
      id: "open-active-folder-as-cards",
      name: "将当前 Markdown 文件夹作为卡片打开",
      checkCallback: (checking) => {
        const folder = this.app.workspace.getActiveFile()?.parent;
        if (!folder) return false;
        if (!checking) void this.activateView().then((view) => view.openFolder(folder.path || "/"));
        return true;
      }
    });
    this.addRibbonIcon("database", "打开 InfoOS 目录", () => void this.activateInfoOSView());
    this.addCommand({ id: "open-infoos-directory", name: "打开 InfoOS 目录", callback: () => void this.activateInfoOSView() });
    this.registerEvent(this.app.workspace.on("file-menu", (menu: Menu, file) => {
      if (file instanceof TFolder) {
        menu.addItem((item) => item
          .setTitle("作为卡片视图打开")
          .setIcon("layout-grid")
          .onClick(() => void this.activateView().then((view) => view.openFolder(file.path || "/"))));
      } else if (file instanceof TFile && file.extension === "md") {
        menu.addItem((item) => item
          .setTitle("作为 Markdown 卡片打开")
          .setIcon("square-stack")
          .onClick(() => void this.activateView().then((view) => view.openSingle(file.path))));
      }
    }));
    this.registerEvent(this.app.vault.on("create", () => this.requestRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.requestRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.requestFileRefresh(file)));
    this.addSettingTab(new CardViewerSettingTab(this.app, this));
    this.registerMarkdownCodeBlockProcessor("infoos-asset", (source, el, ctx) => {
      void this.renderInfoOSAsset(source, el, ctx.sourcePath, ctx);
    });
  }

  onunload(): void {
    if (this.saveTimer != null) window.clearTimeout(this.saveTimer);
    if (this.refreshTimer != null) window.clearTimeout(this.refreshTimer);
    if (this.fileRefreshTimer != null) window.clearTimeout(this.fileRefreshTimer);
  }

  requestSaveSettings(): void {
    if (this.saveTimer != null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveSettings();
    }, 250);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(CARD_VIEW_TYPE)) {
      if (leaf.view instanceof CardViewerView) void leaf.view.refresh();
    }
  }

  async testInfoOSConnection(): Promise<string> {
    return await this.infoOSSession.runExclusive(async () => {
      const client = this.createInfoOSClient();
      const result = await client.testConnection();
      this.rememberInfoOSCapabilities(client, await client.getCapabilities());
      const assets = result.capabilities.includes("assets:read") ? "，服务支持附件读取" : "";
      return `连接成功：InfoOS ${result.interfaceVersion}，cards:read 已验证${assets}。`;
    });
  }

  getInfoOSRequestLog(): readonly InfoOSRequestLogEntry[] {
    return [...this.infoOSRequestLog].reverse();
  }

  clearInfoOSRequestLog(): void {
    this.infoOSRequestLog = [];
  }

  getInfoOSScope() {
    const client = this.createInfoOSClient();
    return {
      sourceApiBaseUrl: client.getApiBaseUrl(),
      vaultId: this.settings.infoOSVaultId,
      targetFolder: normalizeInfoOSTargetFolder(this.settings.infoOSTargetFolder)
    };
  }

  isInfoOSStateCurrent(): boolean {
    try { return isScopeVisible(this.settings.infoOSSyncState, this.getInfoOSScope()); }
    catch { return false; }
  }

  async refreshInfoOSCatalog(): Promise<string> {
    return await this.infoOSSession.runExclusive(async () => {
      const client = this.createInfoOSClient();
      const engine = this.createInfoOSEngine(client);
      const capabilities = await client.getCapabilities();
      this.rememberInfoOSCapabilities(client, capabilities);
      const scope = this.getInfoOSScope();
      const subscription = sourceSubscriptionForScope(
        this.settings.infoOSSyncState, scope,
        defaultSourceSubscriptionMode(this.settings.infoOSSyncState)
      );
      const selectedSourceMode = subscription.mode === "selected";
      if (selectedSourceMode
        && subscription.selectedSourceIds.length > 0
        && !supportsSourceFilter(capabilities)) {
        throw new InfoOSPluginError("forbidden", "当前 InfoOS 不支持按信息源筛选，已停止刷新以避免退化成全量请求。");
      }
      const result = await engine.refreshCatalog(scope, {
        capabilities,
        sourceIds: selectedSourceMode ? subscription.selectedSourceIds : undefined,
        selectedSourceMode
      });
      await this.commitInfoOSState(result.state);
      return `目录已刷新：${result.catalogCount} 张，新增 ${result.addedToCatalog}，变化 ${result.changedInCatalog}。`;
    });
  }

  async refreshInfoOSSources(): Promise<string> {
    return await this.infoOSSession.runExclusive(async () => {
      const client = this.createInfoOSClient();
      const capabilities = await client.getCapabilities();
      this.rememberInfoOSCapabilities(client, capabilities);
      if (!capabilities.source_schema) {
        throw new InfoOSPluginError("forbidden", "当前 InfoOS 未声明信息源目录能力。");
      }
      const scope = this.getInfoOSScope();
      const existing = sourceSubscriptionForScope(this.settings.infoOSSyncState, scope,
        defaultSourceSubscriptionMode(this.settings.infoOSSyncState));
      const subscription = sourceSubscriptionWithCatalog(existing, await client.listAllSources());
      await this.commitInfoOSState({ ...this.settings.infoOSSyncState, sourceSubscription: subscription });
      return `信息源目录已刷新：${subscription.order.length} 个；此操作不会写入 Vault。`;
    });
  }

  getInfoOSSourceSubscription(): InfoOSSourceSubscription {
    return sourceSubscriptionForScope(this.settings.infoOSSyncState, this.getInfoOSScope(),
      defaultSourceSubscriptionMode(this.settings.infoOSSyncState));
  }

  async saveInfoOSSourceSubscription(subscription: InfoOSSourceSubscription): Promise<void> {
    await this.infoOSSession.runExclusive(async () => {
      await this.commitInfoOSState({
        ...this.settings.infoOSSyncState,
        catalog: { ...EMPTY_INFOOS_CATALOG_CACHE, items: {}, order: [] },
        sourceSubscription: subscription
      });
    });
  }

  /** Explicit server-side search. Results are transient and never overwrite the scoped cache. */
  async queryInfoOSCatalog(filters: InfoOSCatalogFilters): Promise<InfoOSCardCatalogItem[]> {
    const client = this.createInfoOSClient();
    const capabilities = await client.getCapabilities();
    this.rememberInfoOSCapabilities(client, capabilities);
    const requested: Array<[keyof InfoOSCatalogFilters, "query" | "platform" | "completeness" | "media_kind"]> = [
      ["query", "query"], ["platform", "platform"], ["completeness", "completeness"], ["mediaKind", "media_kind"]
    ];
    for (const [key, capability] of requested) {
      if (filters[key]?.trim() && !supportsCatalogFilter(capabilities, capability)) {
        throw new InfoOSPluginError("forbidden", `InfoOS 不支持远端筛选：${capability}。`);
      }
    }
    if (!Object.values(filters).some((value) => value?.trim())) {
      throw new InfoOSPluginError("invalid_config", "请至少填写一个远端查询条件。");
    }
    const scope = this.getInfoOSScope();
    const subscription = sourceSubscriptionForScope(
      this.settings.infoOSSyncState, scope,
      defaultSourceSubscriptionMode(this.settings.infoOSSyncState)
    );
    const selectedSourceMode = subscription.mode === "selected";
    if (selectedSourceMode && subscription.selectedSourceIds.length === 0) return [];
    if (selectedSourceMode && !supportsSourceFilter(capabilities)) {
      throw new InfoOSPluginError("forbidden", "当前 InfoOS 不支持按信息源筛选，已停止查询以避免越过本地订阅范围。");
    }
    return await client.listAllCards({
      filters,
      capabilities,
      sourceIds: selectedSourceMode ? subscription.selectedSourceIds : undefined
    });
  }

  async materializeInfoOSCards(
    ids: readonly string[],
    transientCatalog: readonly InfoOSCardCatalogItem[] = []
  ): Promise<string> {
    return await this.infoOSSession.runExclusive(async () => {
      const client = this.createInfoOSClient();
      const authoritativeState = this.settings.infoOSSyncState;
      const scope = this.getInfoOSScope();
      const subscription = sourceSubscriptionForScope(
        authoritativeState, scope,
        defaultSourceSubscriptionMode(authoritativeState)
      );
      const selectedSourceIds = new Set(subscription.selectedSourceIds);
      if (subscription.mode === "selected" && selectedSourceIds.size === 0) {
        throw new InfoOSPluginError("forbidden", "当前未选择任何信息源，无法收下卡片。");
      }
      const scopedTransientCatalog = subscription.mode === "selected"
        ? transientCatalog.filter((card) => typeof card.source_id === "string"
          && card.source_id.length > 0
          && selectedSourceIds.has(card.source_id))
        : transientCatalog;
      const workingState = withTransientCatalog(authoritativeState, scopedTransientCatalog);
      if (subscription.mode === "selected") {
        for (const id of new Set(ids)) {
          const card = workingState.catalog?.items[id];
          if (card?.source_id == null || !selectedSourceIds.has(card.source_id)) {
            throw new InfoOSPluginError("forbidden", `卡片 ${id} 不属于当前选中的信息源，无法收下。`);
          }
        }
      }
      const result = await this.createInfoOSEngine(client, workingState).materializeSelected(ids, scope, {
        ...(this.infoOSSession.webDeepLinksEnabled(client.getApiBaseUrl()) ? {
          cardDeepLink: (cardId: string) => client.buildCardDeepLink(cardId),
          assetDeepLink: (cardId: string, assetId: string) => client.buildAssetDeepLink(cardId, assetId)
        } : {})
      });
      if (workingState !== authoritativeState) {
        result.state = restoreAuthoritativeCatalog(result.state, authoritativeState);
      }
      await this.commitInfoOSState(result.state);
      return result.failed ? `已收下 ${result.created} 张，失败 ${result.failed}。` : `已收下 ${result.created} 张。`;
    });
  }

  async updateInfoOSCards(ids: readonly string[]): Promise<string> {
    return await this.infoOSSession.runExclusive(async () => {
      const client = this.createInfoOSClient();
      const result = await this.createInfoOSEngine(client).updateSelected(ids, this.getInfoOSScope(), {
        ...(this.infoOSSession.webDeepLinksEnabled(client.getApiBaseUrl()) ? {
          cardDeepLink: (cardId: string) => client.buildCardDeepLink(cardId),
          assetDeepLink: (cardId: string, assetId: string) => client.buildAssetDeepLink(cardId, assetId)
        } : {})
      });
      await this.commitInfoOSState(result.state);
      return result.failed ? `已更新 ${result.updated} 张，失败 ${result.failed}。` : `已更新 ${result.updated} 张。`;
    });
  }

  async stopTrackingInfoOSCards(ids: readonly string[]): Promise<void> {
    await this.infoOSSession.runExclusive(async () => {
      const state = this.createInfoOSEngine(this.createInfoOSClient()).stopTracking(ids, this.getInfoOSScope());
      await this.commitInfoOSState(state);
    });
  }

  createInfoOSMaterializer(): InfoOSVaultMaterializer {
    return new InfoOSVaultMaterializer(new ObsidianVaultWriteAdapter(this.app.vault));
  }

  private async loadSettings(): Promise<void> {
    const loaded = await this.loadData() as Partial<CardViewerSettings> | null;
    this.settings = normalizeSettings(loaded);
    // Persist the generated vault id immediately; it scopes the cache without touching Vault files.
    if (!loaded?.infoOSVaultId) await this.saveSettings();
  }

  private createInfoOSClient(): InfoOSClient {
    const requester: HttpRequester = async (request) => {
      const startedAt = Date.now();
      const route = sanitizeInfoOSRequestLogRoute(request.url);
      try {
        const response = await requestUrl(request);
        let json: unknown = null;
        try {
          json = response.json;
        } catch {
          json = null;
        }
        this.recordInfoOSRequest({
          timestamp: new Date(startedAt).toISOString(),
          method: request.method,
          route,
          status: response.status,
          durationMs: Date.now() - startedAt,
          outcome: response.status >= 200 && response.status < 400 ? "success" : "http_error"
        });
        return {
          status: response.status,
          headers: response.headers,
          arrayBuffer: response.arrayBuffer,
          json,
          text: response.text
        };
      } catch {
        this.recordInfoOSRequest({
          timestamp: new Date(startedAt).toISOString(),
          method: request.method,
          route,
          status: null,
          durationMs: Date.now() - startedAt,
          outcome: "network_error"
        });
        throw new InfoOSPluginError("network_error", "InfoOS 请求失败，请检查网络和服务状态。");
      }
    };
    return new InfoOSClient(
      this.settings.infoOSBaseUrl,
      this.settings.infoOSToken,
      requester
    );
  }

  private recordInfoOSRequest(entry: InfoOSRequestLogEntry): void {
    this.infoOSRequestLog = appendInfoOSRequestLog(this.infoOSRequestLog, entry);
  }

  private rememberInfoOSCapabilities(
    client: InfoOSClient,
    capabilities: Awaited<ReturnType<InfoOSClient["getCapabilities"]>>
  ): void {
    this.infoOSSession.rememberCapabilities(client.getApiBaseUrl(), capabilities);
  }

  private createInfoOSEngine(
    client: InfoOSClient,
    state: CardViewerSettings["infoOSSyncState"] = this.settings.infoOSSyncState
  ): InfoOSSyncEngine {
    return new InfoOSSyncEngine(client, this.createInfoOSMaterializer(), () => state);
  }

  private async commitInfoOSState(state: CardViewerSettings["infoOSSyncState"]): Promise<void> {
    this.settings.infoOSSyncState = state;
    await this.saveSettings();
    this.refreshViews();
  }

  private async activateInfoOSView(): Promise<InfoOSView> {
    let leaf = this.app.workspace.getLeavesOfType(INFOOS_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: INFOOS_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof InfoOSView)) throw new Error("InfoOS leaf has unexpected view type");
    return leaf.view;
  }

  private async renderInfoOSAsset(source: string, el: HTMLElement, sourcePath: string, ctx: { addChild(child: MarkdownRenderChild): void }): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(sourcePath) as TFile | null;
    el.empty();
    el.addClass("infoos-asset-preview");
    const decision = validateInfoOSAssetRender(source, {
      sourcePath,
      frontmatter: file ? this.app.metadataCache.getFileCache(file)?.frontmatter : null,
      scopeCurrent: this.isInfoOSStateCurrent(),
      entry: file ? this.settings.infoOSSyncState.entries[
        this.app.metadataCache.getFileCache(file)?.frontmatter?.infoos_card_id as string
      ] : undefined
    });
    if (!decision.allowed) {
      el.createEl("p", { text: decision.reason });
      return;
    }
    const { cardId, placeholder, offline } = decision;
    const link = this.getInfoOSAssetDeepLink(cardId, placeholder.assetId);
    try {
      let bytes: ArrayBuffer;
      if (offline) {
        const local = this.app.vault.getAbstractFileByPath(offline.path) as TFile | null;
        if (!local) throw new InfoOSPluginError("not_found", "已登记的离线图片不存在。");
        bytes = await this.app.vault.readBinary(local);
      } else {
        const client = this.createInfoOSClient();
        const detail = await client.getCard(cardId);
        const asset = detail.card.card_id === cardId ? detail.assets.find((candidate) => candidate.asset_id === placeholder.assetId) : undefined;
        if (!asset || asset.kind !== "image" || asset.status !== "ready"
          || asset.content_hash !== placeholder.contentHash || asset.mime_type !== placeholder.mimeType
          || asset.size_bytes !== placeholder.sizeBytes) {
          throw new InfoOSPluginError("conflict", "图片占位元数据与 InfoOS 卡片详情不一致。");
        }
        bytes = await client.getAsset(asset.url);
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: placeholder.mimeType }));
      const child = new MarkdownRenderChild(el);
      child.register(() => URL.revokeObjectURL(url));
      ctx.addChild(child);
      el.createEl("img", { attr: { src: url, alt: "InfoOS 图片" } });
      if (!offline) {
        const button = el.createEl("button", { text: "离线保存", attr: { type: "button" } });
        let download: InfoOSDownloadSession | null = null;
        button.addEventListener("click", () => {
          if (download?.canCancel) {
            download.cancel();
            button.disabled = true;
            button.setText("正在取消…");
            return;
          }
          let target = "受管 Assets 目录";
          try {
            target = this.getInfoOSOfflineAssetPath(cardId, placeholder.assetId, placeholder.contentHash, placeholder.mimeType);
          } catch {
            // The materializer still validates the final path and bytes.
          }
          const size = formatBytes(placeholder.sizeBytes);
          if (!window.confirm(`离线保存这张图片？\n大小：${size}\n目标：${target}`)) return;
          download = new InfoOSDownloadSession();
          button.setText("停止保存");
          void this.saveInfoOSAsset(cardId, placeholder.assetId, download, () => {
            button.disabled = true;
            button.setText("正在登记…");
          }).then(() => {
            download?.complete();
            button.setText("已离线保存");
          }).catch((error: unknown) => {
            const cancelled = download?.phase === "cancelled";
            if (!cancelled) new Notice(errorMessage(error));
            button.setText(cancelled ? "已取消" : "离线保存");
            button.disabled = cancelled;
          }).finally(() => {
            download = null;
          });
        });
      }
    } catch (error) {
      el.createEl("p", { text: `图片不可用：${errorMessage(error)}` });
      if (link) el.createEl("a", { text: "在 InfoOS 打开", href: link });
    }
  }

  async getInfoOSCardDetail(cardId: string) {
    return await this.createInfoOSClient().getCard(cardId);
  }

  getInfoOSCardDeepLink(cardId: string): string | null {
    const client = this.createInfoOSClient();
    return this.infoOSSession.webDeepLinksEnabled(client.getApiBaseUrl())
      ? client.buildCardDeepLink(cardId)
      : null;
  }

  getInfoOSAssetDeepLink(cardId: string, assetId: string): string | null {
    const client = this.createInfoOSClient();
    return this.infoOSSession.webDeepLinksEnabled(client.getApiBaseUrl())
      ? client.buildAssetDeepLink(cardId, assetId)
      : null;
  }

  getInfoOSOfflineAssetPath(cardId: string, assetId: string, contentHash: string, mimeType: string): string {
    const materializer = this.createInfoOSMaterializer();
    return materializer.getOfflineAssetPath(
      this.settings.infoOSTargetFolder,
      cardId,
      { asset_id: assetId, content_hash: contentHash, mime_type: mimeType }
    );
  }

  async saveInfoOSAsset(
    cardId: string,
    assetId: string,
    download: InfoOSDownloadSession,
    onCommitStart: () => void
  ): Promise<void> {
    await this.infoOSSession.runExclusive(async () => {
      const client = this.createInfoOSClient();
      const signal = download.signal;
      throwIfAborted(signal);
      const detail = await client.getCard(cardId, signal);
      const asset = detail.assets.find((candidate) => candidate.asset_id === assetId);
      const record = this.settings.infoOSSyncState.entries[cardId];
      if (!asset || !record) {
        throw new InfoOSPluginError("not_found", "找不到可保存的 InfoOS 附件。");
      }
      assertDownloadMayCommit(signal);
      const bytes = await client.getAsset(asset.url, signal);
      assertDownloadMayCommit(signal);
      if (!download.beginCommit()) {
        throw new InfoOSPluginError("cancelled", "InfoOS 离线保存未进入提交阶段。");
      }
      onCommitStart();
      // From here the UI has removed the cancel control. The local writes and
      // settings registration form one non-cancellable commit phase.
      const saved = await this.createInfoOSMaterializer().saveOfflineAsset({
        cardId,
        markdownPath: record.markdownPath,
        targetFolder: this.settings.infoOSTargetFolder,
        asset,
        bytes,
        registeredAssetIds: detail.assets.map((candidate) => candidate.asset_id)
      });
      const state = this.createInfoOSEngine(client).registerOfflineAsset(
        cardId,
        saved,
        this.getInfoOSScope()
      );
      await this.commitInfoOSState(state);
    });
  }

  async removeInfoOSAsset(cardId: string, assetId: string): Promise<void> {
    await this.infoOSSession.runExclusive(async () => {
      const client = this.createInfoOSClient();
      const record = this.settings.infoOSSyncState.entries[cardId];
      const entry = record?.offlineAssets[assetId];
      if (!record || !entry) throw new InfoOSPluginError("not_found", "找不到已登记的本地附件。");
      await this.createInfoOSMaterializer().removeRegisteredAsset({
        cardId, markdownPath: record.markdownPath, targetFolder: this.settings.infoOSTargetFolder,
        entry, registeredAssets: record.offlineAssets
      });
      const state = this.createInfoOSEngine(client).unregisterOfflineAsset(cardId, assetId, this.getInfoOSScope());
      await this.commitInfoOSState(state);
    });
  }

  private requestRefresh(): void {
    if (this.refreshTimer != null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshViews();
    }, 180);
  }

  private requestFileRefresh(file: TFile): void {
    this.pendingFileRefreshes.set(file.path, file);
    if (this.fileRefreshTimer != null) window.clearTimeout(this.fileRefreshTimer);
    this.fileRefreshTimer = window.setTimeout(() => {
      this.fileRefreshTimer = null;
      const files = [...this.pendingFileRefreshes.values()];
      this.pendingFileRefreshes.clear();
      for (const leaf of this.app.workspace.getLeavesOfType(CARD_VIEW_TYPE)) {
        if (!(leaf.view instanceof CardViewerView)) continue;
        void leaf.view.refreshFiles(files);
      }
    }, 180);
  }

  private async openFromContext(): Promise<void> {
    const view = await this.activateView();
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      await view.openSingle(activeFile.path);
      return;
    }
    const last = this.settings.lastView;
    if (last?.mode === "single") await view.openSingle(last.path);
    else await view.openFolder(last?.path ?? "/");
  }

  private async activateView(): Promise<CardViewerView> {
    let leaf = this.app.workspace.getLeavesOfType(CARD_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: CARD_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof CardViewerView)) {
      new Notice("无法打开 Markdown 卡片查看器。");
      throw new Error("Card viewer leaf has unexpected view type");
    }
    return leaf.view;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "InfoOS 操作失败。";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new InfoOSPluginError("cancelled", "InfoOS 离线保存已取消。");
}

function assertDownloadMayCommit(signal?: AbortSignal): void {
  if (!mayCommitInfoOSDownload(signal)) throwIfAborted(signal);
}
