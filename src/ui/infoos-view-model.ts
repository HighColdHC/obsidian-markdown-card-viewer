import {
  EMPTY_INFOOS_CATALOG_CACHE,
  type InfoOSCardCatalogItem,
  type InfoOSSelectiveState,
  type InfoOSSyncEntry,
  type InfoOSSyncState
} from "../infoos/contracts";

export type InfoOSLocalFilters = {
  query: string;
  platform: string;
  completeness: string;
  mediaKind: string;
};

export const EMPTY_INFOOS_FILTERS: InfoOSLocalFilters = {
  query: "", platform: "", completeness: "", mediaKind: ""
};

export function isScopeVisible(state: InfoOSSyncState, scope: {
  sourceApiBaseUrl: string; vaultId: string; targetFolder: string;
}): boolean {
  return state.sourceApiBaseUrl === scope.sourceApiBaseUrl
    && state.vaultId === scope.vaultId
    && state.targetFolder === scope.targetFolder;
}

export function orderedCatalog(state: InfoOSSyncState, filters: InfoOSLocalFilters): InfoOSCardCatalogItem[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return (state.catalog?.order ?? []).map((id) => state.catalog?.items[id]).filter(
    (card): card is InfoOSCardCatalogItem => card != null && matches(card, query, filters)
  );
}

export function matches(card: InfoOSCardCatalogItem, query: string, filters: InfoOSLocalFilters): boolean {
  if (filters.platform && card.source_platform !== filters.platform) return false;
  if (filters.completeness && card.completeness_status !== filters.completeness) return false;
  if (filters.mediaKind && mediaCount(card, filters.mediaKind) === 0) return false;
  if (!query) return true;
  return [card.title, card.excerpt, card.source_platform, card.card_type]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(query));
}

export function mediaCount(card: InfoOSCardCatalogItem, kind: string): number {
  const summary = card.asset_summary;
  return kind === "image" ? summary.image_count
    : kind === "video" ? summary.video_count
      : kind === "audio" ? summary.audio_count
        : kind === "other" ? summary.other_count : 0;
}

export function updateAvailable(entry: InfoOSSyncEntry, remote: InfoOSCardCatalogItem | undefined): boolean {
  return remote != null && (entry.version !== remote.version || entry.contentHash !== remote.content_hash);
}

export function selectedVisible(selected: ReadonlySet<string>, cards: readonly InfoOSCardCatalogItem[]): string[] {
  const visible = new Set(cards.map((card) => card.card_id));
  return [...selected].filter((id) => visible.has(id));
}

export function uniqueValues(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}

export function catalogPresentationMetadata(card: InfoOSCardCatalogItem): string[] {
  const assets = card.asset_summary;
  return [
    card.source_platform,
    card.completeness_status,
    card.published_at ? `发布：${card.published_at}` : null,
    `图片 ${assets.image_count}`,
    `视频 ${assets.video_count}`,
    `音频 ${assets.audio_count}`,
    assets.other_count ? `其他 ${assets.other_count}` : null
  ].filter((value): value is string => value != null);
}

/**
 * Makes transient server-query results eligible for selective materialization
 * without changing the authoritative scoped catalog cache.
 */
export function withTransientCatalog(
  state: InfoOSSyncState,
  cards: readonly InfoOSCardCatalogItem[]
): InfoOSSyncState {
  if (!cards.length) return state;
  const catalog = state.catalog ?? EMPTY_INFOOS_CATALOG_CACHE;
  const transientItems = Object.fromEntries(cards.map((card) => [card.card_id, card]));
  return {
    ...state,
    catalog: {
      ...catalog,
      items: { ...catalog.items, ...transientItems },
      order: [...new Set([...catalog.order, ...cards.map((card) => card.card_id)])]
    }
  };
}

export function restoreAuthoritativeCatalog(
  state: InfoOSSelectiveState,
  authoritative: InfoOSSyncState
): InfoOSSelectiveState {
  return {
    ...state,
    catalog: authoritative.catalog ?? { ...EMPTY_INFOOS_CATALOG_CACHE, items: {}, order: [] }
  };
}
