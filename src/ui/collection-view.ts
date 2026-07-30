import { Component, TFile, type App } from "obsidian";
import { computeMasonryLayout } from "../core/masonry-layout";
import type { ContentMode, FolderViewState, LayoutMode } from "../settings";
import { renderMarkdownCard } from "./markdown-card";

type CollectionCallbacks = {
  onOpenSingle: (file: TFile) => void;
  onStateChange: () => void;
};

type PositionedFile = {
  file: TFile;
  x: number;
  y: number;
  width: number;
  height: number;
};

export class CollectionViewController extends Component {
  private readonly cardScopes = new Map<string, Component>();
  private listReaderRefresh: (() => void) | null = null;
  private readerScope: Component | null = null;
  private lastSignature = "";
  private readonly measuredHeights = new Map<string, number>();
  private layoutRevision = 0;
  private renderQueued = false;
  private renderCollection: (() => void) | null = null;

  constructor(
    private readonly app: App,
    private readonly container: HTMLElement,
    private readonly files: TFile[],
    private readonly layout: Exclude<LayoutMode, "graph" | "feed">,
    private readonly state: FolderViewState,
    private readonly cardWidth: number,
    private readonly cardHeight: number,
    private readonly gap: number,
    private readonly callbacks: CollectionCallbacks
  ) {
    super();
    if (layout === "list") this.mountList();
    else this.mountVirtualCards();
  }

  refreshFile(file: TFile): void {
    if (this.layout === "list") {
      if (this.state.selectedPath === file.path) this.listReaderRefresh?.();
      return;
    }
    const wrapper = [...this.container.querySelectorAll<HTMLElement>(".mcg-positioned-card")]
      .find((element) => element.dataset.path === file.path);
    if (!wrapper) return;
    this.releaseCardScope(file.path);
    wrapper.empty();
    this.mountCard(wrapper, file);
  }

  private mountVirtualCards(): void {
    const scroller = this.container.createDiv({ cls: `mcg-collection-scroll is-${this.layout}` });
    const surface = scroller.createDiv({ cls: "mcg-virtual-surface" });
    const render = (): void => {
      const positions = this.layout === "grid"
        ? gridPositions(this.files, scroller.clientWidth, this.cardWidth, gridCardHeight(this.cardHeight, this.state.contentMode), this.gap, this.state.columns)
        : masonryPositions(this.files, scroller.clientWidth, this.cardWidth, this.cardHeight, this.gap, this.state.columns, this.state.contentMode, this.measuredHeights);
      const totalHeight = positions.reduce((maximum, item) => Math.max(maximum, item.y + item.height), 0) + this.gap;
      surface.style.height = `${totalHeight}px`;
      const top = scroller.scrollTop - 500;
      const bottom = scroller.scrollTop + scroller.clientHeight + 500;
      const visible = positions.filter((item) => item.y + item.height >= top && item.y <= bottom);
      const signature = `${scroller.clientWidth}:${this.state.contentMode}:${this.layoutRevision}:${visible.map((item) => item.file.path).join("|")}`;
      if (signature === this.lastSignature) return;
      this.lastSignature = signature;
      this.resetCardScopes();
      surface.empty();
      for (const item of visible) {
        const wrapper = surface.createDiv({ cls: "mcg-positioned-card" });
        wrapper.addClass(`is-${this.layout}`);
        wrapper.dataset.path = item.file.path;
        wrapper.style.left = `${item.x}px`;
        wrapper.style.top = `${item.y}px`;
        wrapper.style.width = `${item.width}px`;
        wrapper.style.height = `${item.height}px`;
        wrapper.addEventListener("click", (event) => {
          if (isInteractiveCardTarget(event.target)) return;
          this.callbacks.onOpenSingle(item.file);
        });
        this.mountCard(wrapper, item.file);
      }
    };
    this.renderCollection = render;
    this.registerDomEvent(scroller, "scroll", render, { passive: true });
    const observer = new ResizeObserver(render);
    observer.observe(scroller);
    this.register(() => observer.disconnect());
    requestAnimationFrame(render);
  }

  private mountList(): void {
    const root = this.container.createDiv({ cls: "mcg-list-view" });
    root.style.setProperty("--mcg-list-width", `${this.state.listWidth}px`);
    const rail = root.createDiv({ cls: "mcg-list-rail" });
    const resizer = root.createDiv({ cls: "mcg-list-resizer" });
    const reader = root.createDiv({ cls: "mcg-list-reader" });
    const surface = rail.createDiv({ cls: "mcg-list-surface" });
    const rowHeight = 56;
    surface.style.height = `${this.files.length * rowHeight}px`;

    const selected = (): TFile | null => {
      const current = this.files.find((file) => file.path === this.state.selectedPath);
      return current ?? this.files[0] ?? null;
    };
    const renderReader = (): void => {
      const file = selected();
      reader.empty();
      if (!file) {
        reader.createDiv({ cls: "mcg-empty", text: "该文件夹没有 Markdown 文件。" });
        return;
      }
      this.state.selectedPath = file.path;
      this.resetReaderScope();
      this.readerScope = new Component();
      this.addChild(this.readerScope);
      void renderMarkdownCard(this.app, file, reader, this.readerScope, {
        mode: "full",
        onNavigate: this.callbacks.onOpenSingle
      });
    };
    this.listReaderRefresh = renderReader;
    const renderRows = (): void => {
      const start = Math.max(0, Math.floor(rail.scrollTop / rowHeight) - 4);
      const end = Math.min(this.files.length, Math.ceil((rail.scrollTop + rail.clientHeight) / rowHeight) + 4);
      surface.empty();
      for (let index = start; index < end; index += 1) {
        const file = this.files[index];
        if (!file) continue;
        const button = surface.createEl("button", {
          cls: `mcg-list-item ${file.path === this.state.selectedPath ? "is-selected" : ""}`,
          attr: { type: "button" }
        });
        button.style.top = `${index * rowHeight}px`;
        button.createDiv({ cls: "mcg-list-title", text: file.basename });
        button.createDiv({ cls: "mcg-list-path", text: file.parent?.path ?? "" });
        button.addEventListener("click", () => {
          this.state.selectedPath = file.path;
          renderRows();
          renderReader();
          this.callbacks.onStateChange();
        });
      }
    };
    this.registerDomEvent(rail, "scroll", renderRows, { passive: true });
    this.registerDomEvent(resizer, "pointerdown", (event) => {
      const startX = event.clientX;
      const startWidth = this.state.listWidth;
      const move = (moveEvent: PointerEvent): void => {
        this.state.listWidth = Math.max(180, Math.min(520, startWidth + moveEvent.clientX - startX));
        root.style.setProperty("--mcg-list-width", `${this.state.listWidth}px`);
      };
      const up = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.callbacks.onStateChange();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    });
    renderRows();
    renderReader();
  }

  private mountCard(wrapper: HTMLElement, file: TFile): void {
    const scope = new Component();
    this.addChild(scope);
    this.cardScopes.set(file.path, scope);
    void renderMarkdownCard(this.app, file, wrapper, scope, {
      mode: this.state.contentMode,
      compact: true,
      onNavigate: this.callbacks.onOpenSingle
    }).then(() => this.measureMasonryCard(wrapper, file));
  }

  private measureMasonryCard(wrapper: HTMLElement, file: TFile): void {
    if (this.layout !== "masonry" || this.state.contentMode !== "summary") return;
    requestAnimationFrame(() => {
      const card = wrapper.querySelector<HTMLElement>(".mcg-card");
      const header = card?.querySelector<HTMLElement>(".mcg-card-header");
      const body = card?.querySelector<HTMLElement>(".mcg-card-body");
      if (!card || !body || !wrapper.isConnected) return;
      const measured = Math.max(230, Math.min(this.cardHeight, (header?.offsetHeight ?? 0) + body.scrollHeight + 2));
      const previous = this.measuredHeights.get(file.path);
      if (previous != null && Math.abs(previous - measured) < 4) return;
      this.measuredHeights.set(file.path, measured);
      this.layoutRevision += 1;
      this.queueCollectionRender();
    });
  }

  private queueCollectionRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderCollection?.();
    });
  }

  private releaseCardScope(path: string): void {
    const scope = this.cardScopes.get(path);
    if (!scope) return;
    scope.unload();
    this.removeChild(scope);
    this.cardScopes.delete(path);
  }

  private resetCardScopes(): void {
    for (const path of [...this.cardScopes.keys()]) this.releaseCardScope(path);
  }

  private resetReaderScope(): void {
    this.readerScope?.unload();
    if (this.readerScope) this.removeChild(this.readerScope);
    this.readerScope = null;
  }
}

function gridPositions(
  files: TFile[],
  containerWidth: number,
  cardWidth: number,
  cardHeight: number,
  gap: number,
  configuredColumns: number
): PositionedFile[] {
  const columns = configuredColumns > 0
    ? configuredColumns
    : Math.max(1, Math.floor((containerWidth - gap) / (cardWidth + gap)));
  const width = Math.max(220, (containerWidth - gap * (columns + 1)) / columns);
  return files.map((file, index) => ({
    file,
    x: gap + (index % columns) * (width + gap),
    y: gap + Math.floor(index / columns) * (cardHeight + gap),
    width,
    height: cardHeight
  }));
}

function masonryPositions(
  files: TFile[],
  containerWidth: number,
  cardWidth: number,
  cardHeight: number,
  gap: number,
  configuredColumns: number,
  contentMode: ContentMode,
  measuredHeights: Map<string, number>
): PositionedFile[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return computeMasonryLayout(files.map((file) => ({
    id: file.path,
    height: contentMode === "full" ? cardHeight : measuredHeights.get(file.path) ?? estimateSummaryHeight(file, cardHeight)
  })), {
    containerWidth,
    preferredWidth: cardWidth,
    gap,
    columns: configuredColumns
  }).map((position) => ({ ...position, file: byPath.get(position.id)! }));
}

function gridCardHeight(cardHeight: number, contentMode: ContentMode): number {
  return contentMode === "summary" ? Math.min(cardHeight, 340) : cardHeight;
}

function estimateSummaryHeight(file: TFile, maximum: number): number {
  return Math.max(240, Math.min(maximum, 250 + Math.sqrt(Math.max(0, file.stat.size)) * 2.2));
}

function isInteractiveCardTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("a, button, input, textarea, select, details, summary"));
}
