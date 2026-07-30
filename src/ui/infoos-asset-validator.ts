import type { InfoOSOfflineAssetEntry } from "../infoos/contracts";

export type InfoOSImagePlaceholder = {
  assetId: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
};

export type InfoOSAssetRenderContext = {
  sourcePath: string;
  frontmatter: unknown;
  scopeCurrent: boolean;
  entry: { markdownPath: string; offlineAssets: Record<string, InfoOSOfflineAssetEntry> } | undefined;
};

export type InfoOSAssetRenderDecision =
  | { allowed: true; cardId: string; placeholder: InfoOSImagePlaceholder; offline: InfoOSOfflineAssetEntry | undefined }
  | { allowed: false; reason: string };

/** Validates untrusted Markdown metadata before any authenticated client call. */
export function validateInfoOSAssetRender(
  source: string,
  context: InfoOSAssetRenderContext
): InfoOSAssetRenderDecision {
  const placeholder = parseImagePlaceholder(source);
  if (!placeholder) return { allowed: false, reason: "图片占位数据无效。" };
  if (!context.scopeCurrent) return { allowed: false, reason: "该图片不属于当前 InfoOS 范围。" };
  if (!isRecord(context.frontmatter) || context.frontmatter.infoos_managed !== true) {
    return { allowed: false, reason: "只有受管 InfoOS 卡片可以加载远端图片。" };
  }
  const cardId = context.frontmatter.infoos_card_id;
  if (typeof cardId !== "string" || !cardId.trim() || !context.entry) {
    return { allowed: false, reason: "受管 InfoOS 卡片索引无效。" };
  }
  if (context.entry.markdownPath !== context.sourcePath) {
    return { allowed: false, reason: "图片来源不在当前受管卡片路径。" };
  }
  return {
    allowed: true,
    cardId,
    placeholder,
    offline: context.entry.offlineAssets[placeholder.assetId]
  };
}

function parseImagePlaceholder(source: string): InfoOSImagePlaceholder | null {
  try {
    const value = JSON.parse(source) as unknown;
    if (!isRecord(value)
      || value.kind !== "image"
      || value.mode !== "remote"
      || typeof value.asset_id !== "string" || !value.asset_id.trim()
      || typeof value.content_hash !== "string" || !value.content_hash.trim()
      || typeof value.mime_type !== "string" || !value.mime_type.startsWith("image/")
      || typeof value.size_bytes !== "number" || !Number.isSafeInteger(value.size_bytes) || value.size_bytes < 0) {
      return null;
    }
    return { assetId: value.asset_id, contentHash: value.content_hash, mimeType: value.mime_type, sizeBytes: value.size_bytes };
  } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
