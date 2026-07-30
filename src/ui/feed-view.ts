import { Component, TFile, type App } from "obsidian";
import { createFeedOrder } from "../core/feed-order";
import { pauseMediaOutside } from "../core/media-playback";
import type { FolderViewState } from "../settings";
import { renderMarkdownCard } from "./markdown-card";

type FeedCallbacks = {
  onOpenSingle: (file: TFile) => void;
  onStateChange: () => void;
};

type RenderedFeedItem = {
  element: HTMLElement;
  scope: Component;
};

export class FeedViewController extends Component {
  private readonly order: TFile[];
  private readonly shell: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly rendered = new Map<number, RenderedFeedItem>();
  private itemHeight = 1;
  private currentIndex = 0;
  private scrollFrame: number | null = null;
  private wheelLocked = false;

  constructor(
    private readonly app: App,
    container: HTMLElement,
    files: TFile[],
    private readonly state: FolderViewState,
    private readonly callbacks: FeedCallbacks
  ) {
    super();
    const byPath = new Map(files.map((file) => [file.path, file]));
    this.order = createFeedOrder(files.map((file) => file.path), {
      seed: state.feedSeed,
      pinnedPath: state.selectedPath
    }).map((path) => byPath.get(path)!).filter(Boolean);

    this.shell = container.createDiv({ cls: "mcg-feed-shell" });
    this.scroller = this.shell.createDiv({ cls: "mcg-feed-scroller", attr: { tabindex: "0", "aria-label": "随机刷卡" } });
    this.surface = this.scroller.createDiv({ cls: "mcg-feed-surface" });
    const controls = this.shell.createDiv({ cls: "mcg-feed-controls" });
    controls.createEl("button", { text: "↑", attr: { type: "button", "aria-label": "上一张卡片" } })
      .addEventListener("click", () => this.goTo(this.currentIndex - 1));
    this.progress = controls.createDiv({ cls: "mcg-feed-progress" });
    controls.createEl("button", { text: "↓", attr: { type: "button", "aria-label": "下一张卡片" } })
      .addEventListener("click", () => this.goTo(this.currentIndex + 1));
    this.shell.createDiv({ cls: "mcg-feed-hint", text: "滚轮 / ↑↓ 刷卡" });

    this.registerDomEvent(this.scroller, "scroll", () => this.scheduleScrollUpdate(), { passive: true });
    this.registerDomEvent(this.scroller, "wheel", (event) => this.handleWheel(event), { passive: false });
    this.registerDomEvent(this.scroller, "keydown", (event) => this.handleKeydown(event));
    const observer = new ResizeObserver(() => this.layout());
    observer.observe(this.scroller);
    this.register(() => observer.disconnect());
    requestAnimationFrame(() => {
      this.layout();
      this.goTo(0, false);
      this.scroller.focus({ preventScroll: true });
    });
  }

  refreshFile(file: TFile): void {
    const index = this.order.findIndex((candidate) => candidate.path === file.path);
    if (index < 0 || !this.rendered.has(index)) return;
    this.release(index);
    this.mount(index);
  }

  private layout(): void {
    const nextHeight = Math.max(1, this.scroller.clientHeight);
    const changed = nextHeight !== this.itemHeight;
    this.itemHeight = nextHeight;
    this.surface.style.height = `${this.order.length * this.itemHeight}px`;
    for (const [index, item] of this.rendered) {
      item.element.style.top = `${index * this.itemHeight}px`;
      item.element.style.height = `${this.itemHeight}px`;
    }
    if (changed) this.scroller.scrollTop = this.currentIndex * this.itemHeight;
    this.renderWindow();
    this.updateProgress();
  }

  private scheduleScrollUpdate(): void {
    if (this.scrollFrame != null) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = null;
      const index = clamp(Math.round(this.scroller.scrollTop / this.itemHeight), 0, Math.max(0, this.order.length - 1));
      const changed = index !== this.currentIndex;
      if (changed) {
        this.currentIndex = index;
        const file = this.order[index];
        if (file) this.state.selectedPath = file.path;
        this.callbacks.onStateChange();
      }
      this.renderWindow();
      if (changed) this.pauseInactiveMedia();
      this.updateProgress();
    });
  }

  private renderWindow(): void {
    const start = Math.max(0, this.currentIndex - 2);
    const end = Math.min(this.order.length - 1, this.currentIndex + 2);
    for (const index of [...this.rendered.keys()]) {
      if (index < start || index > end) this.release(index);
    }
    for (let index = start; index <= end; index += 1) {
      if (!this.rendered.has(index)) this.mount(index);
    }
  }

  private mount(index: number): void {
    const file = this.order[index];
    if (!file) return;
    const element = this.surface.createDiv({ cls: "mcg-feed-item" });
    element.dataset.index = String(index);
    element.dataset.path = file.path;
    element.style.top = `${index * this.itemHeight}px`;
    element.style.height = `${this.itemHeight}px`;
    const label = element.createDiv({ cls: "mcg-feed-card-label" });
    label.createDiv({ cls: "mcg-feed-card-path", text: file.path });
    label.createDiv({ cls: "mcg-feed-card-position", text: `${index + 1} / ${this.order.length}` });
    const frame = element.createDiv({ cls: "mcg-feed-card-frame" });
    const scope = new Component();
    this.addChild(scope);
    this.rendered.set(index, { element, scope });
    void renderMarkdownCard(this.app, file, frame, scope, {
      mode: "full",
      onNavigate: this.callbacks.onOpenSingle
    });
  }

  private release(index: number): void {
    const item = this.rendered.get(index);
    if (!item) return;
    item.scope.unload();
    this.removeChild(item.scope);
    item.element.remove();
    this.rendered.delete(index);
  }

  private goTo(index: number, smooth = true): void {
    if (this.order.length === 0) return;
    const next = clamp(index, 0, this.order.length - 1);
    this.currentIndex = next;
    const file = this.order[next];
    if (file) this.state.selectedPath = file.path;
    this.scroller.scrollTo({ top: next * this.itemHeight, behavior: smooth ? "smooth" : "auto" });
    this.renderWindow();
    this.pauseInactiveMedia();
    this.updateProgress();
    this.callbacks.onStateChange();
  }

  private handleWheel(event: WheelEvent): void {
    if (Math.abs(event.deltaY) < 8 || this.wheelLocked) return;
    const body = event.target instanceof Element ? event.target.closest<HTMLElement>(".mcg-card-body") : null;
    if (body) {
      const canScrollDown = body.scrollTop + body.clientHeight < body.scrollHeight - 2;
      const canScrollUp = body.scrollTop > 2;
      if ((event.deltaY > 0 && canScrollDown) || (event.deltaY < 0 && canScrollUp)) return;
    }
    event.preventDefault();
    this.wheelLocked = true;
    this.goTo(this.currentIndex + (event.deltaY > 0 ? 1 : -1));
    window.setTimeout(() => { this.wheelLocked = false; }, 420);
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === " ") {
      event.preventDefault();
      this.goTo(this.currentIndex + 1);
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      this.goTo(this.currentIndex - 1);
    }
  }

  private updateProgress(): void {
    const file = this.order[this.currentIndex];
    this.progress.textContent = file ? `${this.currentIndex + 1} / ${this.order.length}` : "0 / 0";
  }

  private pauseInactiveMedia(): void {
    pauseMediaOutside(this.shell, this.rendered.get(this.currentIndex)?.element ?? null);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
