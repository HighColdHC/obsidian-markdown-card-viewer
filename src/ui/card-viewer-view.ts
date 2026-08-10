import { Component, ItemView, TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { createFolderReadModel, getFolder, getMarkdownFile } from "../core/obsidian-read-model";
import { bindExclusiveMediaPlayback, pauseMediaOutside } from "../core/media-playback";
import { createDefaultFolderState, type CardViewerSettings, type FolderViewState, type LayoutMode } from "../settings";
import { CollectionViewController } from "./collection-view";
import { FeedViewController } from "./feed-view";
import { GraphViewController } from "./graph-view";
import { renderMarkdownCard } from "./markdown-card";

export const CARD_VIEW_TYPE = "markdown-card-viewer";

export interface CardViewerHost {
  settings: CardViewerSettings;
  requestSaveSettings(): void;
}

type ViewTarget =
  | { mode: "single"; path: string }
  | { mode: "folder"; path: string };

export class CardViewerView extends ItemView {
  private target: ViewTarget | null = null;
  private readonly navigationHistory: ViewTarget[] = [];
  private renderScope: Component | null = null;
  private detailScope: Component | null = null;
  private collectionController: CollectionViewController | null = null;
  private feedController: FeedViewController | null = null;
  private graphController: GraphViewController | null = null;
  private renderGraphDetail: ((path: string | null) => void) | null = null;
  private generation = 0;
  private releaseMediaPlayback: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly host: CardViewerHost) {
    super(leaf);
  }

  getViewType(): string {
    return CARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    if (!this.target) return "Markdown 卡片";
    const segment = this.target.path.split("/").pop();
    return segment ? `卡片 · ${segment.replace(/\.md$/i, "")}` : "Markdown 卡片";
  }

  getIcon(): string {
    return "layout-grid";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("mcg-view-root");
    this.releaseMediaPlayback?.();
    this.releaseMediaPlayback = bindExclusiveMediaPlayback(this.contentEl);
    this.contentEl.addEventListener("dragover", preventWriteInteraction);
    this.contentEl.addEventListener("drop", preventWriteInteraction);
    const last = this.host.settings.lastView;
    if (last?.mode === "single" && getMarkdownFile(this.app, last.path)) {
      await this.openSingle(last.path, false);
      return;
    }
    if (last?.mode === "folder" && getFolder(this.app, last.path)) {
      await this.openFolder(last.path, false);
      return;
    }
    await this.openFolder("/", false);
  }

  async onClose(): Promise<void> {
    this.resetScopes();
    this.releaseMediaPlayback?.();
    this.releaseMediaPlayback = null;
  }

  getState(): Record<string, unknown> {
    return this.target ? { target: this.target } : {};
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (isViewTargetState(state)) {
      if (state.target.mode === "single") await this.openSingle(state.target.path, false);
      else await this.openFolder(state.target.path, false);
      return;
    }
    await super.setState(state, result);
  }

  async openSingle(path: string, pushHistory = true): Promise<void> {
    const file = getMarkdownFile(this.app, path);
    if (!file) {
      this.showError(`找不到 Markdown 文件：${path}`);
      return;
    }
    this.rememberCurrent(pushHistory);
    this.target = { mode: "single", path: file.path };
    this.host.settings.lastView = this.target;
    this.host.requestSaveSettings();
    await this.renderSingle(file);
  }

  async openFolder(path: string, pushHistory = true): Promise<void> {
    const folder = getFolder(this.app, path);
    if (!folder) {
      this.showError(`找不到文件夹：${path}`);
      return;
    }
    this.rememberCurrent(pushHistory);
    this.target = { mode: "folder", path: folder.path || "/" };
    this.host.settings.lastView = this.target;
    this.host.requestSaveSettings();
    await this.renderFolder(folder.path || "/");
  }

  async refresh(): Promise<void> {
    if (!this.target) return;
    if (this.target.mode === "single") await this.openSingle(this.target.path, false);
    else await this.openFolder(this.target.path, false);
  }

  async refreshFile(file: TFile): Promise<void> {
    await this.refreshFiles([file]);
  }

  async refreshFiles(files: readonly TFile[]): Promise<void> {
    if (!this.target) return;
    if (this.target.mode === "single") {
      const current = files.find((file) => file.path === this.target!.path);
      if (current) await this.renderSingle(current);
      return;
    }
    const folderPath = this.target.path;
    const state = this.folderState(folderPath);
    const insideFolder = files.filter((file) => isPathInsideFolder(file.path, folderPath));
    if (state.layout === "graph") {
      if (!files.some((file) => isPathInsideFolder(file.path, folderPath) || this.graphController?.containsPath(file.path))) return;
      const model = createFolderReadModel(this.app, folderPath, true);
      if (model.graph) this.graphController?.updateModel(model.graph);
      const selected = files.find((file) => state.selectedPath === file.path);
      if (selected) this.renderGraphDetail?.(selected.path);
      return;
    }
    if (state.layout === "feed") {
      insideFolder.forEach((file) => this.feedController?.refreshFile(file));
      return;
    }
    insideFolder.forEach((file) => this.collectionController?.refreshFile(file));
  }

  private rememberCurrent(push: boolean): void {
    if (push && this.target) this.navigationHistory.push({ ...this.target });
  }

  private async navigateBack(): Promise<void> {
    const previous = this.navigationHistory.pop();
    if (!previous) return;
    if (previous.mode === "single") await this.openSingle(previous.path, false);
    else await this.openFolder(previous.path, false);
  }

  private async renderSingle(file: TFile): Promise<void> {
    const generation = ++this.generation;
    this.resetScopes();
    this.contentEl.empty();
    this.applySettingsVariables();
    const toolbar = this.contentEl.createDiv({ cls: "mcg-toolbar" });
    this.addBackButton(toolbar);
    const title = toolbar.createDiv({ cls: "mcg-toolbar-title" });
    title.createDiv({ cls: "mcg-toolbar-heading", text: file.basename });
    title.createDiv({ cls: "mcg-toolbar-subtitle", text: file.path });
    const feedButton = toolbar.createEl("button", {
      cls: "mcg-tool-button",
      text: "刷卡",
      attr: { type: "button", "aria-label": "从当前卡片开始随机刷卡" }
    });
    feedButton.addEventListener("click", () => {
      const folderPath = file.parent?.path || "/";
      const state = this.folderState(folderPath);
      state.layout = "feed";
      state.selectedPath = file.path;
      state.feedSeed = nextFeedSeed(state.feedSeed);
      this.host.requestSaveSettings();
      void this.openFolder(folderPath);
    });
    toolbar.createDiv({ cls: "mcg-readonly-badge", text: "只读" });
    const stage = this.contentEl.createDiv({ cls: "mcg-single-stage" });
    this.renderScope = new Component();
    this.addChild(this.renderScope);
    await renderMarkdownCard(this.app, file, stage, this.renderScope, {
      mode: "full",
      onNavigate: (destination) => void this.openSingle(destination.path)
    });
    if (generation !== this.generation) return;
  }

  private async renderFolder(folderPath: string): Promise<void> {
    ++this.generation;
    this.resetScopes();
    this.contentEl.empty();
    this.applySettingsVariables();
    const state = this.folderState(folderPath);
    const model = createFolderReadModel(this.app, folderPath, state.layout === "graph");
    if (!state.selectedPath || !model.files.some((file) => file.path === state.selectedPath)) {
      state.selectedPath = model.files[0]?.path ?? null;
    }
    const toolbar = this.contentEl.createDiv({ cls: "mcg-toolbar" });
    this.addBackButton(toolbar);
    const title = toolbar.createDiv({ cls: "mcg-toolbar-title" });
    title.createDiv({ cls: "mcg-toolbar-heading", text: folderPath === "/" ? this.app.vault.getName() : folderPath.split("/").pop() ?? folderPath });
    title.createDiv({ cls: "mcg-toolbar-subtitle", text: `${model.files.length.toLocaleString()} 个 Markdown · 包含子文件夹` });
    this.addLayoutButtons(toolbar, folderPath, state);
    if (state.layout === "grid" || state.layout === "masonry") {
      const contentButton = toolbar.createEl("button", {
        cls: "mcg-tool-button",
        text: state.contentMode === "summary" ? "摘要" : "全文",
        attr: { type: "button" }
      });
      contentButton.addEventListener("click", () => {
        state.contentMode = state.contentMode === "summary" ? "full" : "summary";
        this.host.requestSaveSettings();
        void this.renderFolder(folderPath);
      });
    }
    if (state.layout === "feed") {
      const shuffleButton = toolbar.createEl("button", {
        cls: "mcg-tool-button",
        text: "换一批",
        attr: { type: "button", "aria-label": "重新随机排列卡片" }
      });
      shuffleButton.addEventListener("click", () => {
        state.feedSeed = nextFeedSeed(state.feedSeed);
        this.host.requestSaveSettings();
        void this.renderFolder(folderPath);
      });
    }
    toolbar.createDiv({ cls: "mcg-readonly-badge", text: "只读" });
    const content = this.contentEl.createDiv({ cls: "mcg-folder-content" });
    if (model.files.length === 0) {
      const empty = content.createDiv({ cls: "mcg-empty" });
      empty.createEl("h3", { text: "没有 Markdown 文件" });
      empty.createEl("p", { text: "该视图保持只读，不会创建文件。" });
      return;
    }

    this.renderScope = new Component();
    this.addChild(this.renderScope);
    if (state.layout === "graph") {
      if (model.graph) this.renderGraph(content, model.graph, folderPath, state);
    } else if (state.layout === "feed") {
      const controller = new FeedViewController(this.app, content, model.files, state, {
        onOpenSingle: (file) => void this.openSingle(file.path),
        onStateChange: () => this.host.requestSaveSettings()
      });
      this.feedController = controller;
      this.renderScope.addChild(controller);
    } else {
      const controller = new CollectionViewController(
        this.app,
        content,
        model.files,
        state.layout,
        state,
        this.host.settings.cardWidth,
        this.host.settings.cardHeight,
        this.host.settings.gap,
        {
          onOpenSingle: (file) => void this.openSingle(file.path),
          onStateChange: () => this.host.requestSaveSettings()
        }
      );
      this.collectionController = controller;
      this.renderScope.addChild(controller);
    }
  }

  private renderGraph(
    content: HTMLElement,
    graph: NonNullable<ReturnType<typeof createFolderReadModel>["graph"]>,
    _folderPath: string,
    state: FolderViewState
  ): void {
    const layout = content.createDiv({ cls: "mcg-graph-layout" });
    layout.style.setProperty("--mcg-graph-detail-width", `${state.graphDetailWidth}px`);
    const canvas = layout.createDiv({ cls: "mcg-graph-panel" });
    const resizer = layout.createDiv({ cls: "mcg-graph-resizer", attr: { "aria-label": "调整详情宽度" } });
    const detail = layout.createDiv({ cls: "mcg-graph-detail" });
    resizer.addEventListener("pointerdown", (event) => {
      const startX = event.clientX;
      const startWidth = state.graphDetailWidth;
      const move = (moveEvent: PointerEvent): void => {
        state.graphDetailWidth = Math.max(300, Math.min(620, startWidth - (moveEvent.clientX - startX)));
        layout.style.setProperty("--mcg-graph-detail-width", `${state.graphDetailWidth}px`);
      };
      const up = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.host.requestSaveSettings();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    });
    const renderDetail = (path: string | null): void => {
      this.detailScope?.unload();
      if (this.detailScope) this.removeChild(this.detailScope);
      this.detailScope = new Component();
      this.addChild(this.detailScope);
      detail.empty();
      const header = detail.createDiv({ cls: "mcg-detail-header" });
      header.createDiv({ text: "完整 Markdown" });
      header.createDiv({ cls: "mcg-detail-path", text: path ?? "未选择" });
      if (!path) return;
      renderRelationSummary(detail, graph, path);
      const file = getMarkdownFile(this.app, path);
      if (!file) {
        const missing = detail.createDiv({ cls: "mcg-missing-detail" });
        missing.createEl("h3", { text: path.split("/").pop() ?? path });
        missing.createEl("p", { text: "该 WikiLink 目标尚不存在；查看器不会创建文件。" });
        return;
      }
      const body = detail.createDiv({ cls: "mcg-detail-body" });
      void renderMarkdownCard(this.app, file, body, this.detailScope, {
        mode: "full",
        onNavigate: (destination) => void this.openSingle(destination.path)
      });
    };
    const controller = new GraphViewController(this.app, canvas, graph, state, {
      resolveFile: (path) => getMarkdownFile(this.app, path),
      onSelect: (path) => {
        state.selectedPath = path;
        renderDetail(path);
        this.host.requestSaveSettings();
      },
      onOpenSingle: (file) => void this.openSingle(file.path),
      onStateChange: () => this.host.requestSaveSettings()
    });
    this.graphController = controller;
    this.renderGraphDetail = renderDetail;
    this.renderScope?.addChild(controller);
    renderDetail(state.selectedPath);
  }

  private addBackButton(toolbar: HTMLElement): void {
    if (this.navigationHistory.length === 0) return;
    const button = toolbar.createEl("button", {
      cls: "mcg-tool-button is-icon",
      text: "←",
      attr: { type: "button", "aria-label": "返回" }
    });
    button.addEventListener("click", () => void this.navigateBack());
  }

  private addLayoutButtons(toolbar: HTMLElement, folderPath: string, state: FolderViewState): void {
    const group = toolbar.createDiv({ cls: "mcg-layout-buttons" });
    const layouts: Array<[LayoutMode, string]> = [
      ["graph", "图谱"],
      ["grid", "网格"],
      ["masonry", "瀑布流"],
      ["list", "列表"],
      ["feed", "刷卡"]
    ];
    for (const [layout, label] of layouts) {
      const button = group.createEl("button", {
        cls: `mcg-tool-button ${state.layout === layout ? "is-active" : ""}`,
        text: label,
        attr: { type: "button", "aria-pressed": String(state.layout === layout) }
      });
      button.addEventListener("click", () => {
        if (layout === "feed" && state.layout !== "feed") {
          state.feedSeed = nextFeedSeed(state.feedSeed);
        }
        state.layout = layout;
        this.host.requestSaveSettings();
        void this.renderFolder(folderPath);
      });
    }
  }

  private folderState(folderPath: string): FolderViewState {
    const current = this.host.settings.folderStates[folderPath];
    if (current) {
      if (current.graphLayoutVersion !== 2) {
        current.graphLayoutVersion = 2;
        current.graphPositions = {};
        current.graphViewport = { zoom: 1, panX: 0, panY: 0 };
      }
      current.graphDetailWidth ??= 400;
      current.feedSeed ??= nextFeedSeed();
      return current;
    }
    const created = createDefaultFolderState();
    this.host.settings.folderStates[folderPath] = created;
    return created;
  }

  private resetScopes(): void {
    pauseMediaOutside(this.contentEl, null);
    this.collectionController = null;
    this.feedController = null;
    this.graphController = null;
    this.renderGraphDetail = null;
    this.renderScope?.unload();
    if (this.renderScope) this.removeChild(this.renderScope);
    this.renderScope = null;
    this.detailScope?.unload();
    if (this.detailScope) this.removeChild(this.detailScope);
    this.detailScope = null;
  }

  private applySettingsVariables(): void {
    this.contentEl.style.setProperty("--mcg-card-width", `${this.host.settings.cardWidth}px`);
    this.contentEl.style.setProperty("--mcg-card-height", `${this.host.settings.cardHeight}px`);
    this.contentEl.style.setProperty("--mcg-gap", `${this.host.settings.gap}px`);
  }

  private showError(message: string): void {
    this.resetScopes();
    this.contentEl.empty();
    const error = this.contentEl.createDiv({ cls: "mcg-empty is-error" });
    error.createEl("h3", { text: "无法打开卡片视图" });
    error.createEl("p", { text: message });
  }
}

function renderRelationSummary(
  container: HTMLElement,
  graph: NonNullable<ReturnType<typeof createFolderReadModel>["graph"]>,
  path: string
): void {
  const relations = graph.edges.filter((edge) => edge.source === path || edge.target === path);
  if (relations.length === 0) return;
  const details = container.createEl("details", { cls: "mcg-detail-relations" });
  details.createEl("summary", { text: `关系 · ${relations.length}` });
  const list = details.createDiv({ cls: "mcg-detail-relation-list" });
  for (const edge of relations) {
    const outgoing = edge.source === path;
    const peer = outgoing ? edge.target : edge.source;
    const row = list.createDiv({ cls: "mcg-detail-relation" });
    row.createSpan({ cls: "mcg-relation-peer", text: `${outgoing ? "→" : "←"} ${basename(peer)}` });
    const origins = edge.origins.map((origin) => origin === "body" ? "正文" : "属性").join(" + ");
    const fields = edge.relationTypes.length > 0 ? ` · ${edge.relationTypes.join(", ")}` : "";
    row.createSpan({ cls: "mcg-relation-origin", text: `${origins}${fields}` });
  }
}

function basename(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

function isPathInsideFolder(filePath: string, folderPath: string): boolean {
  if (!folderPath || folderPath === "/") return true;
  return filePath.startsWith(`${folderPath}/`);
}

function preventWriteInteraction(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function isViewTargetState(value: unknown): value is { target: ViewTarget } {
  if (!value || typeof value !== "object" || !("target" in value)) return false;
  const target = (value as { target?: unknown }).target;
  if (!target || typeof target !== "object") return false;
  const candidate = target as { mode?: unknown; path?: unknown };
  return (candidate.mode === "single" || candidate.mode === "folder") && typeof candidate.path === "string";
}

function nextFeedSeed(previous = 0): number {
  return ((Date.now() ^ Math.imul(previous || 1, 2_654_435_761)) >>> 0) || 1;
}
