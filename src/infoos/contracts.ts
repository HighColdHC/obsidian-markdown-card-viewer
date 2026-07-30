export type InfoOSPluginErrorCode =
  | "invalid_config"
  | "insecure_url"
  | "network_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "range_not_satisfiable"
  | "rate_limited"
  | "invalid_response"
  | "server_error"
  | "checksum_mismatch"
  | "conflict"
  | "cancelled"
  | "path_collision"
  | "write_error"
  | "sync_busy";

export class InfoOSPluginError extends Error {
  constructor(
    readonly code: InfoOSPluginErrorCode,
    message: string,
    readonly status?: number,
    readonly serverCode?: string,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "InfoOSPluginError";
  }
}

export type InfoOSCapabilities = {
  interface_version: string;
  card_schema: string;
  capabilities: string[];
  default_page_size: number;
  max_page_size: number;
};

export type InfoOSHealth = {
  status: string;
  interface_version: string;
};

export type InfoOSAssetSummary = {
  image_count: number;
  video_count: number;
  audio_count: number;
  other_count: number;
  total_size_bytes?: number | null;
  poster_asset_id?: string | null;
};

export const EMPTY_INFOOS_ASSET_SUMMARY: InfoOSAssetSummary = {
  image_count: 0,
  video_count: 0,
  audio_count: 0,
  other_count: 0
};

export type InfoOSCardCatalogItem = {
  card_id: string;
  card_type: string;
  version: number;
  content_hash: string;
  title: string;
  source_platform: string | null;
  source_url: string | null;
  published_at: string | null;
  updated_at: string;
  status: string;
  completeness_status: string | null;
  excerpt: string | null;
  asset_summary: InfoOSAssetSummary;
};

export type InfoOSCardCatalogResponse = {
  items: InfoOSCardCatalogItem[];
  next_page_token: string | null;
};

export type InfoOSCatalogFilters = {
  query?: string;
  platform?: string;
  completeness?: string;
  mediaKind?: string;
};

export type InfoOSCard = InfoOSCardCatalogItem & {
  source_type: string | null;
  source_author: string | null;
  captured_at: string | null;
  missing_reasons: unknown[];
  processor_version: string | null;
  raw_connector_id: string | null;
  raw_item_id: string | null;
  source_run_id: string | null;
};

export type InfoOSBlock = {
  block_id: string;
  position: number;
  layer: string;
  kind: string;
  original_kind: string | null;
  status: string;
  body: string;
  segments: unknown[];
  source_url: string | null;
  provenance: unknown;
};

export type InfoOSAsset = {
  asset_id: string;
  kind: string;
  mime_type: string;
  size_bytes: number | null;
  content_hash: string;
  status: string;
  url: string;
  title?: string | null;
  source_url?: string | null;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
};

export type InfoOSCardDetail = {
  schema: "infoos.information-card.v1";
  card: InfoOSCard;
  blocks: InfoOSBlock[];
  assets: InfoOSAsset[];
};

export type InfoOSOfflineAssetEntry = {
  assetId: string;
  path: string;
  contentHash: string;
  sizeBytes: number;
  kind: string;
  mimeType: string;
  savedAt: string;
};

export type InfoOSSyncEntry = {
  cardId: string;
  version: number;
  contentHash: string;
  markdownPath: string;
  offlineAssets: Record<string, InfoOSOfflineAssetEntry>;
  materializedAt: string;
  updatedAt: string;
  /** Legacy v1 fields retained only so stored settings can be normalized safely. */
  assetPaths?: string[];
  syncedAt?: string;
};

export type InfoOSCatalogCache = {
  items: Record<string, InfoOSCardCatalogItem>;
  order: string[];
  refreshedAt: string | null;
};

export type InfoOSSyncState = {
  entries: Record<string, InfoOSSyncEntry>;
  /** Optional only while v1 plugin settings are migrated; every v2 write includes it. */
  catalog?: InfoOSCatalogCache;
  lastCompletedAt: string | null;
  sourceApiBaseUrl: string | null;
  /** Optional only while v1 plugin settings are migrated; every v2 write includes it. */
  vaultId?: string | null;
  targetFolder: string | null;
};

export type InfoOSSelectiveState = InfoOSSyncState & {
  catalog: InfoOSCatalogCache;
  vaultId: string | null;
};

export const EMPTY_INFOOS_CATALOG_CACHE: InfoOSCatalogCache = {
  items: {},
  order: [],
  refreshedAt: null
};

export const EMPTY_INFOOS_SYNC_STATE: InfoOSSelectiveState = {
  entries: {},
  catalog: { ...EMPTY_INFOOS_CATALOG_CACHE },
  lastCompletedAt: null,
  sourceApiBaseUrl: null,
  vaultId: null,
  targetFolder: null
};
