import { Component, MarkdownRenderer, TFile, type App } from "obsidian";
import { createMarkdownPreview } from "../core/markdown-preview";
import { readMarkdownBody } from "../core/obsidian-read-model";

export type CardRenderMode = "summary" | "full";

export type CardRenderOptions = {
  mode: CardRenderMode;
  compact?: boolean;
  className?: string;
  onNavigate: (file: TFile) => void;
};

export async function renderMarkdownCard(
  app: App,
  file: TFile,
  container: HTMLElement,
  parent: Component,
  options: CardRenderOptions
): Promise<Component> {
  const scope = new Component();
  parent.addChild(scope);

  const card = container.createDiv({
    cls: `mcg-card is-${options.mode} ${options.compact ? "is-compact" : ""} ${options.className ?? ""}`.trim()
  });
  card.dataset.path = file.path;
  const hasPrimaryHeading = Boolean(app.metadataCache.getFileCache(file)?.headings?.some((item) => item.level === 1));
  if (options.mode === "summary" || !hasPrimaryHeading) {
    const header = card.createDiv({ cls: "mcg-card-header" });
    header.createDiv({ cls: "mcg-card-path", text: file.path });
    header.createEl("h2", { text: titleForFile(app, file) });
  }

  const body = card.createDiv({ cls: "mcg-card-body markdown-rendered" });
  if (options.mode === "full") renderProperties(app, file, body);

  if (options.mode === "summary") {
    const markdown = createMarkdownPreview(await readMarkdownBody(app, file));
    if (markdown) await MarkdownRenderer.render(app, markdown, body, file.path, scope);
    else body.createEl("p", { cls: "mcg-empty-summary", text: "空白笔记" });
  } else {
    const markdown = await readMarkdownBody(app, file);
    await MarkdownRenderer.render(app, markdown, body, file.path, scope);
  }

  makeRenderedContentReadonly(body);
  scope.registerDomEvent(card, "click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const internalLink = target?.closest("a.internal-link");
    if (!internalLink) return;
    const linktext = internalLink.getAttribute("data-href") ?? internalLink.getAttribute("href");
    if (!linktext) return;
    const destination = app.metadataCache.getFirstLinkpathDest(linktext, file.path);
    if (!destination) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    options.onNavigate(destination);
  });
  scope.registerDomEvent(card, "dragover", (event) => event.preventDefault());
  scope.registerDomEvent(card, "drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  return scope;
}

function titleForFile(app: App, file: TFile): string {
  const heading = app.metadataCache.getFileCache(file)?.headings?.find((item) => item.level === 1)?.heading;
  return heading?.trim() || file.basename;
}

function renderProperties(app: App, file: TFile, container: HTMLElement): void {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) return;
  const entries = Object.entries(frontmatter).filter(([key]) => key !== "position");
  if (entries.length === 0) return;

  const details = container.createEl("details", { cls: "mcg-properties" });
  details.createEl("summary", { text: `属性 · ${entries.length}` });
  const list = details.createEl("dl");
  for (const [key, value] of entries) {
    list.createEl("dt", { text: key });
    list.createEl("dd", { text: formatProperty(value) });
  }
}

function formatProperty(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function makeRenderedContentReadonly(container: HTMLElement): void {
  for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    checkbox.disabled = true;
    checkbox.setAttribute("aria-readonly", "true");
  }
  container.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true });
}
