import type { TFile, Vault } from "obsidian";
import {
  InfoOSPluginError,
  type InfoOSAsset,
  type InfoOSCardDetail,
  type InfoOSOfflineAssetEntry
} from "./contracts";
import {
  INFOOS_MANAGED_END,
  INFOOS_MANAGED_START,
  renderInfoOSManagedBlock,
  renderInfoOSMarkdown,
  type RenderInfoOSMarkdownOptions
} from "./markdown-renderer";

export type VaultFileInfo = {
  path: string;
  size: number;
};

export type VaultWriteAdapter = {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  createFolder(path: string): Promise<void>;
  writeText(path: string, content: string): Promise<void>;
  writeBinary(path: string, content: ArrayBuffer): Promise<void>;
  trash(path: string, system: true): Promise<void>;
  listFiles?(): Promise<VaultFileInfo[]>;
};

export type MaterializeThinInput = {
  detail: InfoOSCardDetail;
  targetFolder: string;
  renderOptions?: RenderInfoOSMarkdownOptions;
};

/** Legacy input shape accepted without materializing its eager `assets` payload. */
export type MaterializeInput = MaterializeThinInput & {
  assets?: Array<{ asset: InfoOSAsset; bytes: ArrayBuffer }>;
};

export type MaterializeResult = {
  markdownPath: string;
  assetPaths: string[];
};

export type SaveOfflineAssetInput = {
  cardId: string;
  markdownPath: string;
  targetFolder: string;
  asset: InfoOSAsset;
  bytes: ArrayBuffer;
  registeredAssetIds: readonly string[];
};

export type RemoveOfflineAssetInput = {
  cardId: string;
  markdownPath: string;
  targetFolder: string;
  entry: InfoOSOfflineAssetEntry;
  registeredAssets: Readonly<Record<string, InfoOSOfflineAssetEntry>>;
};

export type LegacyAudit = {
  managedMarkdownCount: number;
  convertibleToThinCount: number;
  assets: Record<"image" | "video" | "audio" | "other", { count: number; bytes: number }>;
  orphanAssetCount: number;
};

export class InfoOSVaultMaterializer {
  constructor(private readonly vault: VaultWriteAdapter) {}

  exists(path: string): Promise<boolean> {
    return this.vault.exists(path);
  }

  getMarkdownPath(targetFolder: string, cardId: string): string {
    return `${normalizeInfoOSTargetFolder(targetFolder)}/Cards/${safeSegment(cardId)}.md`;
  }

  getOfflineAssetPath(
    targetFolder: string,
    cardId: string,
    asset: Pick<InfoOSAsset, "asset_id" | "content_hash" | "mime_type">
  ): string {
    const target = normalizeInfoOSTargetFolder(targetFolder);
    const extension = extensionFor(asset.mime_type, new ArrayBuffer(0));
    return `${target}/Assets/${safeSegment(cardId)}/`
      + `${safeSegment(asset.asset_id)}--${contentHashToken(asset.content_hash)}.${extension}`;
  }

  async materializeThin(input: MaterializeThinInput): Promise<MaterializeResult> {
    const targetFolder = normalizeInfoOSTargetFolder(input.targetFolder);
    const markdownPath = this.getMarkdownPath(targetFolder, input.detail.card.card_id);
    if (await this.vault.exists(markdownPath)) {
      throw new InfoOSPluginError(
        "conflict",
        `目标卡片 ${markdownPath} 已存在；请使用显式更新。`
      );
    }
    try {
      await ensureFolderTree(this.vault, `${targetFolder}/Cards`);
      await this.vault.writeText(
        markdownPath,
        renderInfoOSMarkdown(input.detail, input.renderOptions)
      );
    } catch (error) {
      if (error instanceof InfoOSPluginError) throw error;
      throw new InfoOSPluginError("write_error", "无法将 InfoOS 卡片写入 Vault。");
    }
    return { markdownPath, assetPaths: [] };
  }

  /**
   * Compatibility name for integrations compiled against v1. Eager asset input is
   * intentionally ignored: L1 is always thin and binary writes require saveOfflineAsset.
   */
  materialize(input: MaterializeInput): Promise<MaterializeResult> {
    return this.materializeThin(input);
  }

  async updateManagedBlock(input: MaterializeThinInput & { markdownPath: string }):
  Promise<MaterializeResult> {
    const targetFolder = normalizeInfoOSTargetFolder(input.targetFolder);
    assertManagedMarkdownPath(input.markdownPath, targetFolder, input.detail.card.card_id);
    const existing = await this.readManagedMarkdown(
      input.markdownPath,
      input.detail.card.card_id
    );
    const replacement = renderInfoOSManagedBlock(input.detail, input.renderOptions);
    const updatedBody = replaceManagedBlock(existing, replacement);
    const updated = updateOwnedFrontmatter(updatedBody, {
      infoos_version: String(input.detail.card.version),
      infoos_content_hash: JSON.stringify(input.detail.card.content_hash),
      infoos_materialization: JSON.stringify("thin"),
      infoos_source_platform: yamlScalar(input.detail.card.source_platform),
      infoos_source_url: yamlScalar(safeExternalUrl(input.detail.card.source_url)),
      infoos_published_at: yamlScalar(input.detail.card.published_at),
      infoos_updated_at: yamlScalar(input.detail.card.updated_at)
    });
    try {
      await this.vault.writeText(input.markdownPath, updated);
    } catch {
      throw new InfoOSPluginError("write_error", "无法更新 InfoOS 管理区块。");
    }
    return { markdownPath: input.markdownPath, assetPaths: [] };
  }

  async saveOfflineAsset(input: SaveOfflineAssetInput): Promise<InfoOSOfflineAssetEntry> {
    const targetFolder = normalizeInfoOSTargetFolder(input.targetFolder);
    assertManagedMarkdownPath(input.markdownPath, targetFolder, input.cardId);
    await this.readManagedMarkdown(input.markdownPath, input.cardId);
    if (!input.registeredAssetIds.includes(input.asset.asset_id)) {
      throw new InfoOSPluginError("conflict", "附件未登记在当前卡片详情中。");
    }
    await validateAssetBytes(input.asset, input.bytes, false);
    const assetFolder = `${targetFolder}/Assets/${safeSegment(input.cardId)}`;
    const path = `${assetFolder}/${assetFileName(input.asset, input.bytes)}`;
    let wroteNew = false;
    try {
      await ensureFolderTree(this.vault, assetFolder);
      if (await this.vault.exists(path)) {
        await validateAssetBytes(input.asset, await this.vault.readBinary(path), true);
      } else {
        await this.vault.writeBinary(path, input.bytes);
        wroteNew = true;
      }
      await this.updateOfflineAssetFrontmatter(
        input.markdownPath,
        input.cardId,
        (ids) => [...new Set([...ids, input.asset.asset_id])].sort()
      );
    } catch (error) {
      if (wroteNew) {
        try {
          await this.vault.trash(path, true);
        } catch {
          // The original error is more actionable; the caller retains no index entry.
        }
      }
      if (error instanceof InfoOSPluginError) throw error;
      throw new InfoOSPluginError("write_error", "无法离线保存 InfoOS 附件。");
    }
    return {
      assetId: input.asset.asset_id,
      path,
      contentHash: input.asset.content_hash,
      sizeBytes: input.bytes.byteLength,
      kind: input.asset.kind,
      mimeType: input.asset.mime_type,
      savedAt: new Date().toISOString()
    };
  }

  async removeRegisteredAsset(input: RemoveOfflineAssetInput): Promise<void> {
    const targetFolder = normalizeInfoOSTargetFolder(input.targetFolder);
    assertManagedMarkdownPath(input.markdownPath, targetFolder, input.cardId);
    await this.readManagedMarkdown(input.markdownPath, input.cardId);
    const registered = input.registeredAssets[input.entry.assetId];
    if (!registered || registered.path !== input.entry.path) {
      throw new InfoOSPluginError("conflict", "附件不在当前离线资产索引中。");
    }
    const assetPrefix = `${targetFolder}/Assets/${safeSegment(input.cardId)}/`;
    if (!input.entry.path.startsWith(assetPrefix)
      || input.entry.path.length <= assetPrefix.length
      || input.entry.path.endsWith(".md")
      || input.entry.path.slice(assetPrefix.length).includes("/")
      || input.entry.path.slice(assetPrefix.length).includes("..")
      || input.entry.path.includes("\\")) {
      throw new InfoOSPluginError("conflict", "拒绝移除非受管附件路径。");
    }
    try {
      await this.vault.trash(input.entry.path, true);
      await this.updateOfflineAssetFrontmatter(
        input.markdownPath,
        input.cardId,
        (ids) => ids.filter((id) => id !== input.entry.assetId)
      );
    } catch (error) {
      if (error instanceof InfoOSPluginError) throw error;
      throw new InfoOSPluginError(
        "write_error",
        "无法移除本地附件；离线资产索引未自动修改，请人工检查。"
      );
    }
  }

  async auditManagedTarget(targetFolder: string): Promise<LegacyAudit> {
    if (!this.vault.listFiles) {
      throw new InfoOSPluginError("invalid_config", "当前 Vault adapter 不支持只读审计。");
    }
    const target = normalizeInfoOSTargetFolder(targetFolder);
    const cardPrefix = `${target}/Cards/`;
    const assetPrefix = `${target}/Assets/`;
    const files = await this.vault.listFiles();
    const managedCardSegments = new Set<string>();
    let managedMarkdownCount = 0;
    let convertibleToThinCount = 0;
    for (const file of files.filter((candidate) =>
      candidate.path.startsWith(cardPrefix) && candidate.path.endsWith(".md"))) {
      try {
        const markdown = await this.vault.read(file.path);
        if (frontmatterBoolean(markdown, "infoos_managed")) {
          managedMarkdownCount += 1;
          managedCardSegments.add(file.path.slice(cardPrefix.length, -3));
          if (frontmatterStringFromMarkdown(markdown, "infoos_materialization") !== "thin") {
            convertibleToThinCount += 1;
          }
        }
      } catch {
        // A read failure is reported as an unconvertible card, never mutated.
      }
    }
    const assets: LegacyAudit["assets"] = {
      image: { count: 0, bytes: 0 },
      video: { count: 0, bytes: 0 },
      audio: { count: 0, bytes: 0 },
      other: { count: 0, bytes: 0 }
    };
    let orphanAssetCount = 0;
    for (const file of files.filter((candidate) => candidate.path.startsWith(assetPrefix))) {
      const relative = file.path.slice(assetPrefix.length);
      const cardSegment = relative.split("/")[0] ?? "";
      if (!managedCardSegments.has(cardSegment)) orphanAssetCount += 1;
      const kind = kindFromPath(file.path);
      assets[kind].count += 1;
      assets[kind].bytes += file.size;
    }
    return {
      managedMarkdownCount,
      convertibleToThinCount,
      assets,
      orphanAssetCount
    };
  }

  private async readManagedMarkdown(path: string, cardId: string): Promise<string> {
    if (!await this.vault.exists(path)) {
      throw new InfoOSPluginError("not_found", `受管 Markdown ${path} 不存在。`);
    }
    const existing = await this.vault.read(path);
    if (!frontmatterBoolean(existing, "infoos_managed")
      || frontmatterStringFromMarkdown(existing, "infoos_card_id") !== cardId) {
      throw new InfoOSPluginError("path_collision", "目标 Markdown 不属于该 InfoOS 卡片。");
    }
    assertIntactManagedBlock(existing);
    return existing;
  }

  private async updateOfflineAssetFrontmatter(
    markdownPath: string,
    cardId: string,
    update: (ids: string[]) => string[]
  ): Promise<void> {
    const markdown = await this.readManagedMarkdown(markdownPath, cardId);
    const ids = frontmatterStringArray(markdown, "infoos_offline_assets");
    await this.vault.writeText(markdownPath, updateOwnedFrontmatter(markdown, {
      infoos_offline_assets: JSON.stringify(update(ids))
    }));
  }
}

export class ObsidianVaultWriteAdapter implements VaultWriteAdapter {
  constructor(private readonly vault: Vault) {}

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.vault.getAbstractFileByPath(path) !== null);
  }

  async read(path: string): Promise<string> {
    const file = this.vault.getAbstractFileByPath(path) as TFile | null;
    if (!file) throw new Error(`Missing file: ${path}`);
    return await this.vault.cachedRead(file);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.vault.getAbstractFileByPath(path) as TFile | null;
    if (!file) throw new Error(`Missing file: ${path}`);
    return await this.vault.readBinary(file);
  }

  async createFolder(path: string): Promise<void> {
    if (!this.vault.getAbstractFileByPath(path)) await this.vault.createFolder(path);
  }

  async writeText(path: string, content: string): Promise<void> {
    const existing = this.vault.getAbstractFileByPath(path) as TFile | null;
    if (existing) await this.vault.modify(existing, content);
    else await this.vault.create(path, content);
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    const existing = this.vault.getAbstractFileByPath(path) as TFile | null;
    if (existing) await this.vault.modifyBinary(existing, content);
    else await this.vault.createBinary(path, content);
  }

  async trash(path: string, system: true): Promise<void> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!file) throw new Error(`Missing file: ${path}`);
    await this.vault.trash(file, system);
  }

  listFiles(): Promise<VaultFileInfo[]> {
    return Promise.resolve(this.vault.getFiles().map((file) => ({
      path: file.path,
      size: file.stat.size
    })));
  }
}

export function normalizeInfoOSTargetFolder(input: string): string {
  const normalized = input.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    throw new InfoOSPluginError("invalid_config", "请填写 InfoOS 目标文件夹。");
  }
  if (normalized.includes("\\")) {
    throw new InfoOSPluginError("invalid_config", "InfoOS 目标文件夹不能包含反斜杠。");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new InfoOSPluginError("invalid_config", "InfoOS 目标文件夹不安全。");
  }
  return parts.join("/");
}

function assertManagedMarkdownPath(path: string, targetFolder: string, cardId: string): void {
  const expected = `${targetFolder}/Cards/${safeSegment(cardId)}.md`;
  if (path !== expected) {
    throw new InfoOSPluginError("conflict", "Markdown 路径不在当前受管卡片目录。");
  }
}

function safeSegment(input: string): string {
  const normalized = input
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\.\./g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 72) || "item";
  return `${normalized}--${shortHash(input)}`;
}

function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function assetFileName(asset: InfoOSAsset, bytes: ArrayBuffer): string {
  const hash = contentHashToken(asset.content_hash);
  return `${safeSegment(asset.asset_id)}--${hash}.${extensionFor(asset.mime_type, bytes)}`;
}

function extensionFor(mimeType: string, bytes: ArrayBuffer): string {
  const mapping: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "application/pdf": "pdf",
    "text/plain": "txt"
  };
  return mapping[mimeType.toLowerCase()] ?? extensionFromMagic(bytes) ?? "bin";
}

function extensionFromMagic(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 16));
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (ascii(bytes, 0, 3) === "GIF") return "gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  if (ascii(bytes, 4, 4) === "ftyp") return "mp4";
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  if (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0)) {
    return "mp3";
  }
  if (ascii(bytes, 0, 4) === "%PDF") return "pdf";
  return null;
}

function startsWith(value: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => value[index] === byte);
}

function ascii(value: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...value.slice(offset, offset + length));
}

function contentHashToken(value: string): string {
  const sha256 = value.match(/^(?:sha256:)?([a-f0-9]{64})$/i)?.[1];
  if (!sha256) {
    throw new InfoOSPluginError("checksum_mismatch", "InfoOS 附件缺少有效 SHA-256。");
  }
  return sha256.toLowerCase();
}

export async function validateAssetBytes(
  asset: InfoOSAsset,
  bytes: ArrayBuffer,
  existing = false
): Promise<void> {
  const fail = (): never => {
    throw new InfoOSPluginError(
      existing ? "path_collision" : "checksum_mismatch",
      existing
        ? `已存在的附件 ${asset.asset_id} 与 InfoOS 内容不一致。`
        : `InfoOS 附件 ${asset.asset_id} 的大小或哈希不一致。`
    );
  };
  if (asset.size_bytes == null || asset.size_bytes !== bytes.byteLength) fail();
  const expected = asset.content_hash.match(/^(?:sha256:)?([a-f0-9]{64})$/i)?.[1];
  if (!expected) fail();
  const expectedHash = expected as string;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const actual = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== expectedHash.toLowerCase()) fail();
}

async function ensureFolderTree(vault: VaultWriteAdapter, path: string): Promise<void> {
  const parts = path.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!await vault.exists(current)) await vault.createFolder(current);
  }
}

function assertIntactManagedBlock(markdown: string): void {
  const starts = occurrences(markdown, INFOOS_MANAGED_START);
  const ends = occurrences(markdown, INFOOS_MANAGED_END);
  if (starts.length !== 1 || ends.length !== 1 || starts[0]! >= ends[0]!) {
    throw new InfoOSPluginError("conflict", "InfoOS 管理区块边界损坏，未执行更新。");
  }
}

function replaceManagedBlock(markdown: string, replacement: string): string {
  assertIntactManagedBlock(markdown);
  const start = markdown.indexOf(INFOOS_MANAGED_START);
  const end = markdown.indexOf(INFOOS_MANAGED_END, start) + INFOOS_MANAGED_END.length;
  return `${markdown.slice(0, start)}${replacement}${markdown.slice(end)}`;
}

function occurrences(value: string, needle: string): number[] {
  const positions: number[] = [];
  let position = 0;
  while ((position = value.indexOf(needle, position)) !== -1) {
    positions.push(position);
    position += needle.length;
  }
  return positions;
}

function extractFrontmatter(markdown: string): { body: string; start: number; end: number } | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match || match.index == null || match[1] == null) return null;
  return { body: match[1], start: match.index, end: match.index + match[0].length };
}

function frontmatterBoolean(markdown: string, key: string): boolean {
  const frontmatter = extractFrontmatter(markdown)?.body;
  return frontmatter != null && new RegExp(`^${key}:\\s*true\\s*$`, "m").test(frontmatter);
}

function frontmatterStringFromMarkdown(markdown: string, key: string): string | null {
  const frontmatter = extractFrontmatter(markdown)?.body;
  if (frontmatter == null) return null;
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  if (!match?.[1]) return null;
  const value = match[1].trim();
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return value;
  }
}

function frontmatterStringArray(markdown: string, key: string): string[] {
  const raw = frontmatterStringFromMarkdown(markdown, key);
  if (raw === null) {
    const body = extractFrontmatter(markdown)?.body;
    const match = body?.match(new RegExp(`^${key}:\\s*(\\[.*\\])\\s*$`, "m"));
    if (!match?.[1]) return [];
    try {
      const parsed: unknown = JSON.parse(match[1]);
      return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
        ? parsed
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function updateOwnedFrontmatter(
  markdown: string,
  values: Readonly<Record<string, string>>
): string {
  const frontmatter = extractFrontmatter(markdown);
  if (!frontmatter) throw new InfoOSPluginError("conflict", "InfoOS frontmatter 缺失。");
  let body = frontmatter.body;
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${key}:.*$`, "m");
    if (!pattern.test(body)) {
      throw new InfoOSPluginError("conflict", `InfoOS frontmatter 缺少 ${key}。`);
    }
    body = body.replace(pattern, `${key}: ${value}`);
  }
  return `${markdown.slice(0, frontmatter.start)}---\n${body}\n---\n${markdown.slice(frontmatter.end)}`;
}

function yamlScalar(value: string | null): string {
  return value === null ? "null" : JSON.stringify(value);
}

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password) return null;
    if ([...url.searchParams.keys()].some((name) =>
      /^(?:access_?token|token|api_?key|authorization|auth|bearer)$/i.test(name))) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function kindFromPath(path: string): "image" | "video" | "audio" | "other" {
  const extension = path.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(extension ?? "")) return "image";
  if (["mp4", "webm", "mov", "mkv"].includes(extension ?? "")) return "video";
  if (["mp3", "m4a", "ogg", "wav", "flac"].includes(extension ?? "")) return "audio";
  return "other";
}
