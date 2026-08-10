import { getFrontMatterInfo, normalizePath, TFile, TFolder, type App } from "obsidian";
import { extractFrontmatterLinks } from "./frontmatter-links";
import { buildGraphModel, type GraphFile, type GraphModel } from "./graph-model";

export type FolderReadModel = {
  folderPath: string;
  files: TFile[];
  graph?: GraphModel;
};

export function markdownFilesInFolder(app: App, folderPath: string): TFile[] {
  const normalized = normalizePath(folderPath);
  const prefix = normalized === "/" || normalized.length === 0 ? "" : `${normalized}/`;
  return app.vault.getMarkdownFiles()
    .filter((file) => prefix.length === 0 || file.path.startsWith(prefix))
    .sort((left, right) => left.stat.ctime - right.stat.ctime || left.path.localeCompare(right.path));
}

export function createFolderReadModel(app: App, folderPath: string, includeGraph = true): FolderReadModel {
  const files = markdownFilesInFolder(app, folderPath);
  if (!includeGraph) return { folderPath, files };
  const allMarkdown = app.vault.getMarkdownFiles();
  const graphFiles = allMarkdown.map((file) => toGraphFile(app, file));
  const graph = buildGraphModel(folderPath, graphFiles, (target, sourcePath) =>
    app.metadataCache.getFirstLinkpathDest(target, sourcePath)?.path ?? null
  );
  return { folderPath, files, graph };
}

export function toGraphFile(app: App, file: TFile): GraphFile {
  const cache = app.metadataCache.getFileCache(file);
  const firstHeading = cache?.headings?.find((heading) => heading.level === 1)?.heading;
  return {
    path: file.path,
    title: firstHeading?.trim() || file.basename,
    folder: file.parent?.path ?? "",
    ctime: file.stat.ctime,
    excerpt: "",
    bodyLinks: cache?.links?.map((link) => normalizeLinkTarget(link.link)) ?? [],
    frontmatterLinks: extractFrontmatterLinks(cache?.frontmatter ?? null)
  };
}

export async function readMarkdownBody(app: App, file: TFile): Promise<string> {
  const source = await app.vault.cachedRead(file);
  const info = getFrontMatterInfo(source);
  return info.exists ? source.slice(info.contentStart) : source;
}

export async function readExcerpt(app: App, file: TFile, maxLength = 180): Promise<string> {
  const body = await readMarkdownBody(app, file);
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[\[([^\]|#^]+)(?:[^\]]*)\]\]/g, "$1")
    .replace(/[#>*_`~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength).trim()}…` : plain;
}

export function getMarkdownFile(app: App, path: string): TFile | null {
  const abstract = app.vault.getAbstractFileByPath(normalizePath(path));
  return abstract instanceof TFile && abstract.extension === "md" ? abstract : null;
}

export function getFolder(app: App, path: string): TFolder | null {
  if (!path || path === "/") return app.vault.getRoot();
  const abstract = app.vault.getAbstractFileByPath(normalizePath(path));
  return abstract instanceof TFolder ? abstract : null;
}

function normalizeLinkTarget(target: string): string {
  return target.split(/[\^#]/, 1)[0]?.trim() ?? target;
}
