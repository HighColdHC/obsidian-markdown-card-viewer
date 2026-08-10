import {
  EMPTY_INFOOS_ASSET_SUMMARY,
  InfoOSPluginError,
  type InfoOSAssetSummary,
  type InfoOSCapabilities,
  type InfoOSCardCatalogItem,
  type InfoOSCardCatalogResponse,
  type InfoOSCardDetail,
  type InfoOSCatalogFilters,
  type InfoOSHealth,
  type InfoOSSourceCatalogItem,
  type InfoOSSourceCatalogResponse,
  type InfoOSPluginErrorCode
} from "./contracts";
import { normalizeInfoOSApiBaseUrl } from "./url-policy";

export type HttpRequest = {
  url: string;
  method: "GET";
  headers: Record<string, string>;
  throw: false;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
};

export type HttpRequester = (request: HttpRequest) => Promise<HttpResponse>;

type InfoOSCatalogCapabilityAdvertisement = {
  capabilities: readonly string[];
  catalog_filters?: readonly string[];
};

export type ListCardsOptions = {
  pageSize?: number;
  pageToken?: string | null;
  filters?: InfoOSCatalogFilters;
  capabilities?: readonly string[] | InfoOSCatalogCapabilityAdvertisement;
  sourceIds?: readonly string[];
};

export class InfoOSRequestError extends InfoOSPluginError {
  override readonly name = "InfoOSRequestError";
}

export class InfoOSClient {
  private readonly apiBaseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly request: HttpRequester
  ) {
    this.apiBaseUrl = normalizeInfoOSApiBaseUrl(baseUrl);
    if (!token.trim()) {
      throw new InfoOSPluginError("invalid_config", "请填写 InfoOS Token。");
    }
  }

  async getCapabilities(signal?: AbortSignal): Promise<InfoOSCapabilities> {
    return parseCapabilities(await this.requestJson("/capabilities", signal));
  }

  async testConnection(signal?: AbortSignal): Promise<{
    interfaceVersion: string;
    capabilities: string[];
  }> {
    const capabilities = await this.getCapabilities(signal);
    const health = parseHealth(await this.requestJson("/health", signal));
    if (capabilities.interface_version !== "v1" || health.interface_version !== "v1") {
      throw new InfoOSRequestError("invalid_response", "InfoOS 插件接口版本不是 v1。");
    }
    if (health.status !== "ready") {
      throw new InfoOSRequestError("invalid_response", "InfoOS 插件接口尚未就绪。");
    }
    if (!capabilities.capabilities.includes("cards:read")) {
      throw new InfoOSRequestError("forbidden", "Token 缺少 cards:read 权限。");
    }
    return {
      interfaceVersion: capabilities.interface_version,
      capabilities: capabilities.capabilities
    };
  }

  async listCards(options: ListCardsOptions = {}, signal?: AbortSignal):
  Promise<InfoOSCardCatalogResponse> {
    const pageSize = options.pageSize ?? 200;
    if (!Number.isInteger(pageSize) || pageSize < 1) {
      throw new InfoOSPluginError("invalid_config", "InfoOS 分页大小必须为正整数。");
    }
    const query = new URLSearchParams({ page_size: String(pageSize) });
    if (options.pageToken) query.set("page_token", options.pageToken);
    const filters = options.filters;
    const capabilities = options.capabilities ?? [];
    addSupportedFilter(query, "query", filters?.query, capabilities);
    addSupportedFilter(query, "platform", filters?.platform, capabilities);
    addSupportedFilter(query, "completeness", filters?.completeness, capabilities);
    addSupportedFilter(query, "media_kind", filters?.mediaKind, capabilities);
    if (supportsSourceFilter(options.capabilities)) {
      const sourceIds = uniqueSourceIds(options.sourceIds);
      if (sourceIds.length > 100) {
        throw new InfoOSPluginError("invalid_config", "单次卡片请求最多支持 100 个信息源。");
      }
      sourceIds.forEach((sourceId) => query.append("source_id", sourceId));
    }
    return parseCatalog(await this.requestJson(`/cards?${query.toString()}`, signal));
  }

  async listAllCards(options: Omit<ListCardsOptions, "pageToken"> = {}, signal?: AbortSignal):
  Promise<InfoOSCardCatalogItem[]> {
    const sourceIds = supportsSourceFilter(options.capabilities) ? uniqueSourceIds(options.sourceIds) : [];
    if (options.sourceIds?.length && sourceIds.length === 0) return [];
    const batches = sourceIds.length ? chunk(sourceIds, 100) : [[]];
    const cards = new Map<string, InfoOSCardCatalogItem>();
    for (const sourceBatch of batches) {
      const pages = await this.listAllCardsForSourceBatch({ ...options, sourceIds: sourceBatch }, signal);
      pages.forEach((card) => cards.set(card.card_id, card));
    }
    return [...cards.values()].sort(compareCatalogOrder);
  }

  private async listAllCardsForSourceBatch(options: Omit<ListCardsOptions, "pageToken">, signal?: AbortSignal):
  Promise<InfoOSCardCatalogItem[]> {
    const cards: InfoOSCardCatalogItem[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await this.listCards({ ...options, pageToken: cursor }, signal);
      cards.push(...page.items);
      cursor = page.next_page_token;
      if (cursor) {
        if (seenCursors.has(cursor)) {
          throw new InfoOSRequestError("invalid_response", "InfoOS 返回了重复分页游标。");
        }
        seenCursors.add(cursor);
      }
    } while (cursor);
    return cards;
  }

  async listSources(options: { pageSize?: number; pageToken?: string | null } = {}, signal?: AbortSignal): Promise<InfoOSSourceCatalogResponse> {
    const pageSize = options.pageSize ?? 200;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
      throw new InfoOSPluginError("invalid_config", "信息源分页大小必须是 1 到 200 的整数。");
    }
    const query = new URLSearchParams({ page_size: String(pageSize) });
    if (options.pageToken) query.set("page_token", options.pageToken);
    return parseSourceCatalog(await this.requestJson(`/sources?${query.toString()}`, signal));
  }

  async listAllSources(options: { pageSize?: number } = {}, signal?: AbortSignal): Promise<InfoOSSourceCatalogItem[]> {
    const sources = new Map<string, InfoOSSourceCatalogItem>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await this.listSources({ ...options, pageToken: cursor }, signal);
      page.items.forEach((source) => sources.set(source.source_id, source));
      cursor = page.next_page_token;
      if (cursor) {
        if (seenCursors.has(cursor)) throw new InfoOSRequestError("invalid_response", "InfoOS 返回了重复信息源分页游标。");
        seenCursors.add(cursor);
      }
    } while (cursor);
    return [...sources.values()];
  }

  async getCard(cardId: string, signal?: AbortSignal): Promise<InfoOSCardDetail> {
    assertIdentifier(cardId, "卡片");
    const detail = parseCardDetail(
      await this.requestJson(`/cards/${encodeURIComponent(cardId)}`, signal)
    );
    if (detail.card.card_id !== cardId) {
      throw new InfoOSRequestError(
        "conflict",
        "InfoOS 返回的卡片身份与请求不一致。"
      );
    }
    return detail;
  }

  async getAsset(assetIdOrUrl: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const url = this.resolveAssetUrl(assetIdOrUrl);
    const response = await this.performRequest(url, "application/octet-stream", signal);
    if (response.status !== 200) {
      throw new InfoOSRequestError(
        "invalid_response",
        "InfoOS 附件响应不是完整的 200 响应。",
        response.status
      );
    }
    return response.arrayBuffer;
  }

  buildCardDeepLink(cardId: string): string {
    assertIdentifier(cardId, "卡片");
    return this.buildWebDeepLink(cardId);
  }

  buildAssetDeepLink(cardId: string, assetId: string): string {
    assertIdentifier(cardId, "卡片");
    assertIdentifier(assetId, "附件");
    return this.buildWebDeepLink(cardId, assetId);
  }

  private buildWebDeepLink(cardId: string, assetId?: string): string {
    const webBase = new URL(this.apiBaseUrl);
    webBase.pathname = "/";
    webBase.search = "";
    webBase.hash = "";
    webBase.searchParams.set("menu", "cards");
    webBase.searchParams.set("card_id", cardId);
    if (assetId != null) webBase.searchParams.set("asset_id", assetId);
    return webBase.toString();
  }

  getApiBaseUrl(): string {
    return this.apiBaseUrl;
  }

  private async requestJson(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.performRequest(
      `${this.apiBaseUrl}${path}`,
      "application/json",
      signal
    );
    return response.json;
  }

  private async performRequest(
    url: string,
    accept: string,
    signal?: AbortSignal
  ): Promise<HttpResponse> {
    throwIfAborted(signal);
    let response: HttpResponse;
    try {
      response = await this.request({
        url,
        method: "GET",
        headers: {
          Accept: accept,
          Authorization: `Bearer ${this.token}`
        },
        throw: false
      });
    } catch {
      throwIfAborted(signal);
      throw new InfoOSRequestError("network_error", "无法连接 InfoOS，请检查地址和网络。");
    }
    throwIfAborted(signal);
    if (response.status >= 200 && response.status < 300) return response;
    throw mapErrorResponse(response);
  }

  private resolveAssetUrl(assetIdOrUrl: string): string {
    const trimmed = assetIdOrUrl.trim();
    if (!trimmed.includes("/") && !trimmed.includes(":")) {
      assertIdentifier(trimmed, "附件");
      return `${this.apiBaseUrl}/assets/${encodeURIComponent(trimmed)}`;
    }
    let resolved: URL;
    try {
      resolved = new URL(trimmed, `${this.apiBaseUrl}/`);
    } catch {
      throw new InfoOSRequestError("invalid_response", "InfoOS 返回了无效附件地址。");
    }
    const base = new URL(this.apiBaseUrl);
    const assetPrefix = `${base.pathname}/assets/`;
    if (resolved.origin !== base.origin
      || !resolved.pathname.startsWith(assetPrefix)
      || resolved.pathname.length <= assetPrefix.length
      || resolved.username
      || resolved.password
      || resolved.search
      || resolved.hash) {
      throw new InfoOSRequestError("invalid_response", "InfoOS 返回了不安全的附件地址。");
    }
    return resolved.toString();
  }
}

/**
 * Capability names are treated as punctuation-insensitive segments so servers may
 * advertise `cards:filters:query`, `cards.filter.query`, or
 * `catalog_filter_query`. A capability must still mention cards/catalog, filter,
 * and the exact field; broad read capabilities never enable filter transmission.
 */
export function supportsCatalogFilter(
  capabilities: readonly string[] | InfoOSCatalogCapabilityAdvertisement,
  field: "query" | "platform" | "completeness" | "media_kind"
): boolean {
  if ("catalog_filters" in capabilities && capabilities.catalog_filters?.includes(field)) {
    return true;
  }
  const capabilityNames = "capabilities" in capabilities
    ? capabilities.capabilities
    : capabilities;
  const wanted = field === "media_kind" ? ["media", "kind"] : [field];
  return capabilityNames.some((capability) => {
    const segments = capability.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return (segments.includes("cards") || segments.includes("card") || segments.includes("catalog"))
      && (segments.includes("filter") || segments.includes("filters"))
      && wanted.every((segment) => segments.includes(segment));
  });
}

export function supportsSourceFilter(
  capabilities: readonly string[] | InfoOSCatalogCapabilityAdvertisement | undefined
): boolean {
  return capabilities != null
    && "catalog_filters" in capabilities
    && capabilities.catalog_filters?.includes("source_id") === true;
}

export function supportsWebDeepLinks(capabilities: InfoOSCapabilities): boolean {
  return capabilities.web_deep_links === true;
}

function addSupportedFilter(
  query: URLSearchParams,
  name: "query" | "platform" | "completeness" | "media_kind",
  value: string | undefined,
  capabilities: readonly string[] | InfoOSCatalogCapabilityAdvertisement
): void {
  const trimmed = value?.trim();
  if (trimmed && supportsCatalogFilter(capabilities, name)) query.set(name, trimmed);
}

function mapErrorResponse(response: HttpResponse): InfoOSRequestError {
  const body = isRecord(response.json) ? response.json : {};
  const serverCode = stringValue(body.code);
  const requestId = stringValue(body.request_id);
  const code = statusCode(response.status, serverCode);
  const messages: Record<InfoOSPluginErrorCode, string> = {
    invalid_config: "InfoOS 配置无效。",
    insecure_url: "InfoOS 请求地址不安全。",
    network_error: "无法连接 InfoOS。",
    unauthorized: "Token 无效、已撤销或未填写。",
    forbidden: "Token 权限不足。",
    not_found: "InfoOS 中不存在请求的卡片或附件。",
    range_not_satisfiable: "InfoOS 无法满足请求的附件范围。",
    rate_limited: "InfoOS 请求过于频繁，请稍后重试。",
    invalid_response: "InfoOS 返回了无法识别的响应。",
    server_error: "InfoOS 服务暂时不可用。",
    checksum_mismatch: "InfoOS 附件校验失败。",
    conflict: "InfoOS 内容发生冲突，未执行覆盖。",
    cancelled: "InfoOS 请求已取消。",
    path_collision: "目标路径存在非受管文件。",
    write_error: "写入 Vault 失败。",
    sync_busy: "已有 InfoOS 操作正在进行。"
  };
  return new InfoOSRequestError(
    code,
    messages[code],
    response.status,
    serverCode,
    requestId
  );
}

function statusCode(status: number, serverCode?: string): InfoOSPluginErrorCode {
  if (serverCode === "checksum_mismatch" || serverCode === "checksum_failed") {
    return "checksum_mismatch";
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 416) return "range_not_satisfiable";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "invalid_response";
}

function parseCapabilities(value: unknown): InfoOSCapabilities {
  if (!isRecord(value)
    || typeof value.interface_version !== "string"
    || typeof value.card_schema !== "string"
    || !isStringArray(value.capabilities)
    || typeof value.default_page_size !== "number"
    || typeof value.max_page_size !== "number"
    || typeof value.source_schema !== "string"
    || !optionalStringArray(value, "source_catalog_fields")
    || !isStringArray(value.catalog_filters)
    || !optionalStringArray(value, "catalog_fields")
    || typeof value.web_deep_links !== "boolean") {
    throw new InfoOSRequestError("invalid_response", "InfoOS capabilities 响应结构无效。");
  }
  return value as InfoOSCapabilities;
}

function parseHealth(value: unknown): InfoOSHealth {
  if (!isRecord(value)
    || typeof value.status !== "string"
    || typeof value.interface_version !== "string") {
    throw new InfoOSRequestError("invalid_response", "InfoOS health 响应结构无效。");
  }
  return value as InfoOSHealth;
}

function parseCatalog(value: unknown): InfoOSCardCatalogResponse {
  if (!isRecord(value)
    || !Array.isArray(value.items)
    || !(value.next_page_token === null || typeof value.next_page_token === "string")) {
    throw new InfoOSRequestError("invalid_response", "InfoOS 卡片目录响应结构无效。");
  }
  return {
    items: value.items.map((item) => parseCatalogItem(item)),
    next_page_token: value.next_page_token
  };
}

function parseCatalogItem(value: unknown, strictExtendedFields = false): InfoOSCardCatalogItem {
  if (!isRecord(value)
    || typeof value.card_id !== "string"
    || !isResponseIdentifier(value.card_id)
    || typeof value.card_type !== "string"
    || !isNonNegativeInteger(value.version)
    || typeof value.content_hash !== "string"
    || typeof value.title !== "string"
    || !(value.source_platform === null || typeof value.source_platform === "string")
    || !(value.published_at === null || typeof value.published_at === "string")
    || typeof value.updated_at !== "string"
    || typeof value.status !== "string") {
    throw new InfoOSRequestError("invalid_response", "InfoOS 卡片目录项结构无效。");
  }
  if (strictExtendedFields
    && (!("source_url" in value)
      || !("completeness_status" in value)
      || !("excerpt" in value)
      || !("asset_summary" in value))) {
    throw new InfoOSRequestError("invalid_response", "InfoOS 卡片详情缺少目录字段。");
  }
  const sourceUrl = nullableRecordString(value, "source_url");
  const completeness = nullableRecordString(value, "completeness_status");
  const excerpt = nullableRecordString(value, "excerpt");
  if (!(value.source_id === null || typeof value.source_id === "string")) {
    throw new InfoOSRequestError("invalid_response", "InfoOS 卡片信息源字段无效。");
  }
  return {
    card_id: value.card_id,
    card_type: value.card_type,
    version: value.version,
    content_hash: value.content_hash,
    title: value.title,
    source_platform: value.source_platform,
    source_url: sourceUrl,
    published_at: value.published_at,
    updated_at: value.updated_at,
    status: value.status,
    completeness_status: completeness,
    excerpt,
    asset_summary: parseAssetSummary(value.asset_summary),
    source_id: value.source_id
  };
}

function parseSourceCatalog(value: unknown): InfoOSSourceCatalogResponse {
  if (!isRecord(value) || value.schema !== "infoos.source-catalog.v1" || !Array.isArray(value.items)
    || !(value.next_page_token === null || typeof value.next_page_token === "string")) {
    throw new InfoOSRequestError("invalid_response", "InfoOS 信息源目录响应结构无效。");
  }
  return { schema: value.schema, items: value.items.map(parseSourceCatalogItem), next_page_token: value.next_page_token };
}

function parseSourceCatalogItem(value: unknown): InfoOSSourceCatalogItem {
  if (!isRecord(value) || typeof value.source_id !== "string" || !isResponseIdentifier(value.source_id)
    || typeof value.display_name !== "string" || typeof value.platform !== "string" || typeof value.source_type !== "string"
    || !isNonNegativeInteger(value.card_count) || !(value.latest_card_updated_at === null || typeof value.latest_card_updated_at === "string")) {
    throw new InfoOSRequestError("invalid_response", "InfoOS 信息源目录项结构无效。");
  }
  return {
    source_id: value.source_id,
    display_name: value.display_name,
    platform: value.platform,
    source_type: value.source_type,
    card_count: value.card_count,
    latest_card_updated_at: value.latest_card_updated_at
  };
}

function parseAssetSummary(value: unknown): InfoOSAssetSummary {
  if (value == null) return { ...EMPTY_INFOOS_ASSET_SUMMARY };
  if (!isRecord(value)) {
    throw new InfoOSRequestError("invalid_response", "InfoOS 资产摘要结构无效。");
  }
  const count = (name: string): number => {
    const candidate = value[name];
    if (candidate == null) return 0;
    if (!Number.isInteger(candidate) || (candidate as number) < 0) {
      throw new InfoOSRequestError("invalid_response", "InfoOS 资产摘要数量无效。");
    }
    return candidate as number;
  };
  const total = value.total_size_bytes;
  if (!(total == null || (Number.isInteger(total) && (total as number) >= 0))) {
    throw new InfoOSRequestError("invalid_response", "InfoOS 资产摘要大小无效。");
  }
  return {
    image_count: count("image_count"),
    video_count: count("video_count"),
    audio_count: count("audio_count"),
    other_count: count("other_count"),
    ...(total == null ? {} : { total_size_bytes: total as number }),
    ...(!("poster_asset_id" in value)
      ? {}
      : { poster_asset_id: nullableString(value.poster_asset_id) })
  };
}

function parseCardDetail(value: unknown): InfoOSCardDetail {
  if (!isRecord(value)
    || value.schema !== "infoos.information-card.v1"
    || !isRecord(value.card)
    || !Array.isArray(value.blocks)
    || !Array.isArray(value.assets)) {
    throw new InfoOSRequestError("invalid_response", "InfoOS 卡片详情响应结构无效。");
  }
  const card = value.card;
  const requiredNullableCardFields = [
    "source_type",
    "source_author",
    "captured_at",
    "processor_version",
    "raw_connector_id",
    "raw_item_id",
    "source_run_id"
  ] as const;
  if (!requiredNullableCardFields.every((field) => field in card)
    || !("missing_reasons" in card)
    || !Array.isArray(card.missing_reasons)) {
    throw new InfoOSRequestError("invalid_response", "InfoOS 卡片详情字段无效。");
  }
  return {
    schema: value.schema,
    card: {
      ...parseCatalogItem(card, true),
      source_type: nullableString(card.source_type),
      source_author: nullableString(card.source_author),
      captured_at: nullableString(card.captured_at),
      missing_reasons: card.missing_reasons,
      processor_version: nullableString(card.processor_version),
      raw_connector_id: nullableString(card.raw_connector_id),
      raw_item_id: nullableString(card.raw_item_id),
      source_run_id: nullableString(card.source_run_id)
    },
    blocks: value.blocks.map(parseBlock),
    assets: value.assets.map(parseAsset)
  };
}

function parseBlock(value: unknown): InfoOSCardDetail["blocks"][number] {
  if (!isRecord(value)
    || typeof value.block_id !== "string"
    || !isResponseIdentifier(value.block_id)
    || !isNonNegativeInteger(value.position)
    || typeof value.layer !== "string"
    || typeof value.kind !== "string"
    || !(value.original_kind === null || typeof value.original_kind === "string")
    || typeof value.status !== "string"
    || typeof value.body !== "string"
    || !Array.isArray(value.segments)
    || !(value.source_url === null || typeof value.source_url === "string")
    || !("provenance" in value)) {
    throw new InfoOSRequestError("invalid_response", "InfoOS 卡片区块结构无效。");
  }
  return {
    block_id: value.block_id,
    position: value.position,
    layer: value.layer,
    kind: value.kind,
    original_kind: value.original_kind,
    status: value.status,
    body: value.body,
    segments: value.segments,
    source_url: value.source_url,
    provenance: value.provenance
  };
}

function parseAsset(value: unknown): InfoOSCardDetail["assets"][number] {
  if (!isRecord(value)
    || typeof value.asset_id !== "string"
    || !isResponseIdentifier(value.asset_id)
    || typeof value.kind !== "string"
    || typeof value.mime_type !== "string"
    || !isNullableNonNegativeInteger(value.size_bytes)
    || typeof value.content_hash !== "string"
    || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(value.content_hash)
    || typeof value.status !== "string"
    || typeof value.url !== "string"
    || !optionalNullableString(value, "title")
    || !optionalNullableString(value, "source_url")
    || !optionalNullableNonNegativeInteger(value, "duration_seconds")
    || !optionalNullableNonNegativeInteger(value, "width")
    || !optionalNullableNonNegativeInteger(value, "height")) {
    throw new InfoOSRequestError("invalid_response", "InfoOS 卡片资产结构无效。");
  }
  return {
    asset_id: value.asset_id,
    kind: value.kind,
    mime_type: value.mime_type,
    size_bytes: value.size_bytes,
    content_hash: value.content_hash,
    status: value.status,
    url: value.url,
    ...("title" in value ? { title: value.title as string | null } : {}),
    ...("source_url" in value ? { source_url: value.source_url as string | null } : {}),
    ...("duration_seconds" in value
      ? { duration_seconds: value.duration_seconds as number | null }
      : {}),
    ...("width" in value ? { width: value.width as number | null } : {}),
    ...("height" in value ? { height: value.height as number | null } : {})
  };
}

function optionalNullableString(value: Record<string, unknown>, key: string): boolean {
  return !(key in value) || value[key] === null || typeof value[key] === "string";
}

function optionalNullableNonNegativeInteger(
  value: Record<string, unknown>,
  key: string
): boolean {
  return !(key in value) || isNullableNonNegativeInteger(value[key]);
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isResponseIdentifier(value: string): boolean {
  return Boolean(value.trim()) && !/[\u0000-\u001f/?#\\]/.test(value);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new InfoOSRequestError("cancelled", "InfoOS 请求已取消。");
  }
}

function assertIdentifier(value: string, label: string): void {
  if (!value.trim() || /[\u0000-\u001f/?#\\]/.test(value)) {
    throw new InfoOSPluginError("invalid_config", `${label} ID 无效。`);
  }
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new InfoOSRequestError("invalid_response", "InfoOS 字符串字段无效。");
  }
  return value;
}

function nullableRecordString(value: Record<string, unknown>, key: string): string | null {
  return key in value ? nullableString(value[key]) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function optionalStringArray(value: Record<string, unknown>, key: string): boolean { return !(key in value) || isStringArray(value[key]); }
function uniqueSourceIds(ids: readonly string[] | undefined): string[] {
  return [...new Set((ids ?? []).map((id) => id.trim()).filter((id) => id && !/[\u0000-\u001f/?#\\]/.test(id)))].sort((a, b) => a.localeCompare(b));
}
function chunk<T>(items: readonly T[], size: number): T[][] { return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size)); }

function compareCatalogOrder(a: InfoOSCardCatalogItem, b: InfoOSCardCatalogItem): number {
  if (a.updated_at < b.updated_at) return -1;
  if (a.updated_at > b.updated_at) return 1;
  if (a.card_id < b.card_id) return -1;
  if (a.card_id > b.card_id) return 1;
  return 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
