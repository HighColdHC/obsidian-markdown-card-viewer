import type { InfoOSAsset, InfoOSCardDetail } from "./contracts";

export const INFOOS_MANAGED_START = "<!-- infoos:managed:start -->";
export const INFOOS_MANAGED_END = "<!-- infoos:managed:end -->";

export type RenderInfoOSMarkdownOptions = {
  offlineAssetIds?: readonly string[];
  cardDeepLink?: string | null;
  assetDeepLinks?: Readonly<Record<string, string>>;
};

export function renderInfoOSMarkdown(
  detail: InfoOSCardDetail,
  options: RenderInfoOSMarkdownOptions = {}
): string {
  const { card } = detail;
  const offlineAssetIds = [...new Set(options.offlineAssetIds ?? [])].sort();
  const frontmatter: Array<[string, string | number | boolean | null | readonly string[]]> = [
    ["infoos_managed", true],
    ["infoos_card_id", card.card_id],
    ["infoos_version", card.version],
    ["infoos_content_hash", card.content_hash],
    ["infoos_materialization", "thin"],
    ["infoos_source_platform", card.source_platform],
    ["infoos_source_url", safeExternalUrl(card.source_url)],
    ["infoos_published_at", card.published_at],
    ["infoos_updated_at", card.updated_at],
    ["infoos_offline_assets", offlineAssetIds]
  ];
  return [
    "---",
    ...frontmatter.map(([key, value]) => `${key}: ${yamlScalar(value)}`),
    "---",
    "",
    renderInfoOSManagedBlock(detail, options),
    ""
  ].join("\n");
}

export function renderInfoOSManagedBlock(
  detail: InfoOSCardDetail,
  options: RenderInfoOSMarkdownOptions = {}
): string {
  const lines = [
    INFOOS_MANAGED_START,
    "",
    `# ${plainHeading(detail.card.title || detail.card.card_id)}`,
    ""
  ];
  const blocks = [...detail.blocks].sort((a, b) =>
    a.position - b.position || a.block_id.localeCompare(b.block_id));
  for (const block of blocks) {
    if (block.body.trim()) lines.push(escapeManagedSentinels(block.body), "");
  }

  if (detail.assets.length > 0) {
    lines.push("## 资产", "");
    for (const asset of detail.assets) {
      lines.push(...renderRemoteAsset(
        asset,
        options.assetDeepLinks?.[asset.asset_id] ?? options.cardDeepLink ?? undefined
      ), "");
    }
  }

  const sourceUrl = safeExternalUrl(detail.card.source_url);
  const cardUrl = safeExternalUrl(options.cardDeepLink ?? null);
  if (sourceUrl || cardUrl) {
    lines.push("## 链接", "");
    if (sourceUrl) lines.push(`[返回原始来源](<${sourceUrl}>)`);
    if (cardUrl) lines.push(`[在 InfoOS 打开](<${cardUrl}>)`);
    lines.push("");
  }
  lines.push(INFOOS_MANAGED_END);
  return lines.join("\n").trimEnd();
}

function escapeManagedSentinels(value: string): string {
  return value
    .split(INFOOS_MANAGED_START).join("<!-- infoos&#58;managed:start -->")
    .split(INFOOS_MANAGED_END).join("<!-- infoos&#58;managed:end -->");
}

function renderRemoteAsset(asset: InfoOSAsset, deepLink?: string): string[] {
  const metadata = [
    `- 类型：${asset.kind}`,
    `- MIME：${asset.mime_type}`,
    ...(asset.size_bytes == null ? [] : [`- 大小：${asset.size_bytes} bytes`]),
    ...(asset.duration_seconds == null ? [] : [`- 时长：${asset.duration_seconds} 秒`])
  ];
  const title = plainHeading(asset.title || asset.asset_id);
  if (asset.kind === "image") {
    return [
      `### ${title}`,
      "",
      "```infoos-asset",
      JSON.stringify({
        asset_id: asset.asset_id,
        kind: "image",
        mode: "remote",
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
        content_hash: asset.content_hash
      }),
      "```",
      "",
      ...metadata,
      ...assetLinks(asset, deepLink)
    ];
  }
  return [
    `### ${title}`,
    "",
    ...metadata,
    ...assetLinks(asset, deepLink)
  ];
}

function assetLinks(asset: InfoOSAsset, deepLink?: string): string[] {
  const links: string[] = [];
  const infoOSUrl = safeExternalUrl(deepLink ?? null);
  const sourceUrl = safeExternalUrl(asset.source_url ?? null);
  if (infoOSUrl) {
    links.push(`[${asset.kind === "video" || asset.kind === "audio"
      ? "在 InfoOS 播放"
      : "在 InfoOS 打开"}](<${infoOSUrl}>)`);
  }
  if (sourceUrl) links.push(`[打开原始媒体](<${sourceUrl}>)`);
  return links;
}

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password) return null;
    if ([...url.searchParams.keys()].some(isSensitiveQueryParameter)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isSensitiveQueryParameter(name: string): boolean {
  return /^(?:access_?token|token|api_?key|authorization|auth|bearer)$/i.test(name);
}

function plainHeading(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function yamlScalar(
  value: string | number | boolean | null | readonly string[]
): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
