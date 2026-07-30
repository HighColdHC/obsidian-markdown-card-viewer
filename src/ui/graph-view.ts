import { Component, TFile, type App } from "obsidian";
import { computeDeterministicGraphLayout } from "../core/graph-layout";
import type { GraphModel, GraphNode } from "../core/graph-model";
import type { FolderViewState } from "../settings";
import { renderMarkdownCard } from "./markdown-card";

type GraphCallbacks = {
  resolveFile: (path: string) => TFile | null;
  onSelect: (path: string) => void;
  onOpenSingle: (file: TFile) => void;
  onStateChange: () => void;
};

type Point = { x: number; y: number };

export class GraphViewController extends Component {
  private readonly viewport: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly nodeLayer: HTMLElement;
  private readonly positions = new Map<string, Point>();
  private readonly nodeKinds = new Map<string, GraphNode["kind"]>();
  private nodeScope: Component | null = null;
  private selectedPath: string | null;
  private initializedViewport = false;

  constructor(
    private readonly app: App,
    container: HTMLElement,
    private model: GraphModel,
    private readonly state: FolderViewState,
    private readonly callbacks: GraphCallbacks
  ) {
    super();
    this.selectedPath = state.selectedPath;
    for (const node of model.nodes) this.nodeKinds.set(node.path, node.kind);
    this.viewport = container.createDiv({ cls: "mcg-graph-viewport" });
    this.viewport.tabIndex = 0;
    this.canvas = this.viewport.createEl("canvas", { cls: "mcg-graph-edges" });
    this.nodeLayer = this.viewport.createDiv({ cls: "mcg-graph-nodes" });
    this.initializePositions();
    this.addControls();
    this.registerInteraction();
    const observer = new ResizeObserver(() => this.render());
    observer.observe(this.viewport);
    this.register(() => observer.disconnect());
    requestAnimationFrame(() => {
      if (!this.initializedViewport) this.fitGraph(false);
      this.render();
    });
  }

  select(path: string): void {
    this.selectedPath = path;
    this.state.selectedPath = path;
    this.render();
  }

  containsPath(path: string): boolean {
    return this.nodeKinds.has(path);
  }

  updateModel(model: GraphModel): void {
    this.model = model;
    this.nodeKinds.clear();
    const currentPaths = new Set(model.nodes.map((node) => node.path));
    for (const path of [...this.positions.keys()]) {
      if (!currentPaths.has(path)) this.positions.delete(path);
    }
    for (const node of model.nodes) this.nodeKinds.set(node.path, node.kind);
    this.initializePositions();
    this.render();
  }

  private initializePositions(): void {
    const automatic = computeDeterministicGraphLayout(this.model);
    this.model.nodes.forEach((node) => {
      const saved = this.state.graphPositions[node.path];
      if (saved) {
        this.positions.set(node.path, { x: saved[0], y: saved[1] });
        return;
      }
      const [x, y] = automatic[node.path] ?? [0, 0];
      this.positions.set(node.path, { x, y });
    });
  }

  private addControls(): void {
    const controls = this.viewport.createDiv({ cls: "mcg-graph-controls" });
    controls.createEl("button", { text: "−", attr: { "aria-label": "缩小图谱" } })
      .addEventListener("click", () => this.zoomBy(0.8));
    controls.createEl("button", { text: "+", attr: { "aria-label": "放大图谱" } })
      .addEventListener("click", () => this.zoomBy(1.25));
    controls.createEl("button", { text: "适应", attr: { "aria-label": "适应全部节点" } })
      .addEventListener("click", () => this.fitGraph(true));
    controls.createEl("button", { text: "定位", attr: { "aria-label": "定位当前节点" } })
      .addEventListener("click", () => this.locateSelected());
    controls.createEl("button", { text: "重排", attr: { "aria-label": "恢复自动布局" } })
      .addEventListener("click", () => {
        this.state.graphPositions = {};
        this.positions.clear();
        this.initializePositions();
        this.fitGraph(true);
      });
  }

  private registerInteraction(): void {
    this.registerDomEvent(this.viewport, "wheel", (event) => {
      event.preventDefault();
      const rect = this.viewport.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const oldZoom = this.state.graphViewport.zoom;
      const nextZoom = clamp(oldZoom * (event.deltaY > 0 ? 0.88 : 1.12), 0.02, 2.2);
      const worldX = (cursorX - this.state.graphViewport.panX) / oldZoom;
      const worldY = (cursorY - this.state.graphViewport.panY) / oldZoom;
      this.state.graphViewport.zoom = nextZoom;
      this.state.graphViewport.panX = cursorX - worldX * nextZoom;
      this.state.graphViewport.panY = cursorY - worldY * nextZoom;
      this.render();
      this.callbacks.onStateChange();
    }, { passive: false });

    this.registerDomEvent(this.viewport, "pointerdown", (event) => {
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".mcg-graph-node") : null;
      const start = { x: event.clientX, y: event.clientY };
      if (target?.dataset.path) {
        const path = target.dataset.path;
        const original = this.positions.get(path);
        if (!original) return;
        this.select(path);
        this.callbacks.onSelect(path);
        const move = (moveEvent: PointerEvent): void => {
          const zoom = this.state.graphViewport.zoom;
          const next = {
            x: original.x + (moveEvent.clientX - start.x) / zoom,
            y: original.y + (moveEvent.clientY - start.y) / zoom
          };
          this.positions.set(path, next);
          this.render();
        };
        const up = (): void => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          const point = this.positions.get(path);
          if (point) this.state.graphPositions[path] = [point.x, point.y];
          this.callbacks.onStateChange();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up, { once: true });
        return;
      }

      const originalPan = {
        x: this.state.graphViewport.panX,
        y: this.state.graphViewport.panY
      };
      const move = (moveEvent: PointerEvent): void => {
        this.state.graphViewport.panX = originalPan.x + moveEvent.clientX - start.x;
        this.state.graphViewport.panY = originalPan.y + moveEvent.clientY - start.y;
        this.render();
      };
      const up = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.callbacks.onStateChange();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    });

    this.registerDomEvent(this.viewport, "dblclick", (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".mcg-graph-node") : null;
      if (!target?.dataset.path) return;
      const file = this.callbacks.resolveFile(target.dataset.path);
      if (file) this.callbacks.onOpenSingle(file);
    });
  }

  private zoomBy(factor: number): void {
    const rect = this.viewport.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const oldZoom = this.state.graphViewport.zoom;
    const nextZoom = clamp(oldZoom * factor, 0.02, 2.2);
    const worldX = (centerX - this.state.graphViewport.panX) / oldZoom;
    const worldY = (centerY - this.state.graphViewport.panY) / oldZoom;
    this.state.graphViewport.zoom = nextZoom;
    this.state.graphViewport.panX = centerX - worldX * nextZoom;
    this.state.graphViewport.panY = centerY - worldY * nextZoom;
    this.render();
    this.callbacks.onStateChange();
  }

  private fitGraph(save: boolean): void {
    const points = [...this.positions.values()];
    if (points.length === 0) return;
    const rect = this.viewport.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const width = Math.max(240, maxX - minX + 260);
    const height = Math.max(180, maxY - minY + 180);
    const zoom = clamp(Math.min(rect.width / width, rect.height / height), 0.02, 1.15);
    this.state.graphViewport.zoom = zoom;
    this.state.graphViewport.panX = rect.width / 2 - ((minX + maxX) / 2) * zoom;
    this.state.graphViewport.panY = rect.height / 2 - ((minY + maxY) / 2) * zoom;
    this.initializedViewport = true;
    this.render();
    if (save) this.callbacks.onStateChange();
  }

  private render(): void {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    if (width === 0 || height === 0) return;
    this.drawEdges(width, height);
    this.renderNodes(width, height);
  }

  private drawEdges(width: number, height: number): void {
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * ratio);
    this.canvas.height = Math.floor(height * ratio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const { zoom, panX, panY } = this.state.graphViewport;
    const colors = getComputedStyle(this.viewport);
    const normalColor = colors.getPropertyValue("--text-faint").trim() || "#596271";
    const accentColor = colors.getPropertyValue("--interactive-accent").trim() || "#9b8afb";
    for (const edge of this.model.edges) {
      const source = this.positions.get(edge.source);
      const target = this.positions.get(edge.target);
      if (!source || !target) continue;
      const sx = source.x * zoom + panX;
      const sy = source.y * zoom + panY;
      const tx = target.x * zoom + panX;
      const ty = target.y * zoom + panY;
      if (!lineTouchesViewport(sx, sy, tx, ty, width, height, 100)) continue;
      const highlighted = edge.source === this.selectedPath || edge.target === this.selectedPath;
      const angle = Math.atan2(ty - sy, tx - sx);
      const targetPadding = (zoom < 0.45 ? 68 : 105) * zoom;
      const endX = tx - Math.cos(angle) * targetPadding;
      const endY = ty - Math.sin(angle) * targetPadding;
      context.globalAlpha = this.selectedPath ? (highlighted ? 1 : 0.14) : 0.58;
      context.strokeStyle = highlighted ? accentColor : normalColor;
      context.fillStyle = highlighted ? accentColor : normalColor;
      context.lineWidth = highlighted ? 2 : 1;
      context.setLineDash(this.nodeKind(edge.target) === "missing" ? [6, 5] : []);
      context.beginPath();
      context.moveTo(sx, sy);
      context.lineTo(endX, endY);
      context.stroke();
      drawArrowhead(context, endX, endY, angle, highlighted ? 8 : 6);
    }
    context.globalAlpha = 1;
    context.setLineDash([]);
  }

  private renderNodes(width: number, height: number): void {
    this.nodeScope?.unload();
    if (this.nodeScope) this.removeChild(this.nodeScope);
    this.nodeScope = new Component();
    this.addChild(this.nodeScope);
    this.nodeLayer.empty();

    const { zoom, panX, panY } = this.state.graphViewport;
    const lod = zoom < 0.45 ? "far" : zoom < 1.35 ? "medium" : "near";
    const adjacent = this.adjacentPaths();
    const margin = lod === "near" ? 360 : 180;
    const visible: Array<{ node: GraphNode; x: number; y: number }> = [];
    for (const node of this.model.nodes) {
      const point = this.positions.get(node.path);
      if (!point) continue;
      const x = point.x * zoom + panX;
      const y = point.y * zoom + panY;
      if (x < -margin || y < -margin || x > width + margin || y > height + margin) continue;
      visible.push({ node, x, y });
    }
    const maximumNodes = lod === "far" ? 700 : lod === "medium" ? 320 : 80;
    for (const { node, x, y } of sampleVisibleNodes(visible, maximumNodes, this.selectedPath)) {
      const element = this.nodeLayer.createDiv({
        cls: `mcg-graph-node is-${node.kind} is-${lod} ${node.path === this.selectedPath ? "is-selected" : ""} ${adjacent.has(node.path) ? "is-adjacent" : ""} ${this.selectedPath && node.path !== this.selectedPath && !adjacent.has(node.path) ? "is-dimmed" : ""}`
      });
      element.dataset.path = node.path;
      element.tabIndex = 0;
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      if (lod === "near") {
        const file = this.callbacks.resolveFile(node.path);
        if (file) {
          void renderMarkdownCard(this.app, file, element, this.nodeScope, {
            mode: "full",
            compact: true,
            onNavigate: (destination) => this.callbacks.onOpenSingle(destination)
          });
          continue;
        }
      }
      renderSimpleNode(element, node, lod);
    }
  }

  private nodeKind(path: string): GraphNode["kind"] | null {
    return this.nodeKinds.get(path) ?? null;
  }

  private adjacentPaths(): Set<string> {
    const adjacent = new Set<string>();
    if (!this.selectedPath) return adjacent;
    for (const edge of this.model.edges) {
      if (edge.source === this.selectedPath) adjacent.add(edge.target);
      if (edge.target === this.selectedPath) adjacent.add(edge.source);
    }
    return adjacent;
  }

  private locateSelected(): void {
    const path = this.selectedPath ?? this.model.nodes[0]?.path;
    if (!path) return;
    const point = this.positions.get(path);
    if (!point) return;
    const rect = this.viewport.getBoundingClientRect();
    this.state.graphViewport.zoom = Math.max(this.state.graphViewport.zoom, 0.75);
    this.state.graphViewport.panX = rect.width / 2 - point.x * this.state.graphViewport.zoom;
    this.state.graphViewport.panY = rect.height / 2 - point.y * this.state.graphViewport.zoom;
    this.render();
    this.callbacks.onStateChange();
  }
}

function drawArrowhead(context: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number): void {
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x - Math.cos(angle - Math.PI / 6) * size, y - Math.sin(angle - Math.PI / 6) * size);
  context.lineTo(x - Math.cos(angle + Math.PI / 6) * size, y - Math.sin(angle + Math.PI / 6) * size);
  context.closePath();
  context.fill();
}

function sampleVisibleNodes<T extends { node: GraphNode }>(items: T[], limit: number, selectedPath: string | null): T[] {
  if (items.length <= limit) return items;
  const sampled: T[] = [];
  const selected = selectedPath ? items.find((item) => item.node.path === selectedPath) : undefined;
  const stride = items.length / limit;
  for (let index = 0; index < limit; index += 1) {
    const item = items[Math.floor(index * stride)];
    if (item && item.node.path !== selectedPath) sampled.push(item);
  }
  if (selected) sampled.push(selected);
  return sampled;
}

function renderSimpleNode(element: HTMLElement, node: GraphNode, lod: "far" | "medium" | "near"): void {
  if (lod !== "far") {
    element.createDiv({ cls: "mcg-node-kind", text: node.kind === "internal" ? node.folder : node.kind });
  }
  element.createDiv({ cls: "mcg-node-title", text: node.title });
  if (lod === "medium") {
    element.createDiv({ cls: "mcg-node-excerpt", text: node.excerpt || node.path });
  }
}

function lineTouchesViewport(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  height: number,
  margin: number
): boolean {
  return Math.max(x1, x2) >= -margin
    && Math.min(x1, x2) <= width + margin
    && Math.max(y1, y2) >= -margin
    && Math.min(y1, y2) <= height + margin;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
