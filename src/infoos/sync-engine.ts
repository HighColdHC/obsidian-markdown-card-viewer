import {
  EMPTY_INFOOS_CATALOG_CACHE,
  InfoOSPluginError,
  type InfoOSCardCatalogItem,
  type InfoOSCardDetail,
  type InfoOSCatalogFilters,
  type InfoOSCapabilities,
  type InfoOSOfflineAssetEntry,
  type InfoOSSelectiveState,
  type InfoOSSyncEntry,
  type InfoOSSyncState
} from "./contracts";
import { normalizeInfoOSApiBaseUrl } from "./url-policy";
import {
  normalizeInfoOSTargetFolder,
  type MaterializeResult
} from "./vault-materializer";

export type InfoOSSyncClient = {
  listAllCards(options?: {
    pageSize?: number;
    filters?: InfoOSCatalogFilters;
    capabilities?: readonly string[] | InfoOSCapabilities;
    sourceIds?: readonly string[];
  }, signal?: AbortSignal): Promise<InfoOSCardCatalogItem[]>;
  getCard(cardId: string, signal?: AbortSignal): Promise<InfoOSCardDetail>;
};

export type InfoOSSyncMaterializer = {
  exists(path: string): Promise<boolean>;
  getMarkdownPath(targetFolder: string, cardId: string): string;
  materializeThin(input: {
    detail: InfoOSCardDetail;
    targetFolder: string;
    renderOptions?: {
      cardDeepLink?: string | null;
      assetDeepLinks?: Readonly<Record<string, string>>;
    };
  }): Promise<MaterializeResult>;
  updateManagedBlock(input: {
    detail: InfoOSCardDetail;
    targetFolder: string;
    markdownPath: string;
    renderOptions?: {
      cardDeepLink?: string | null;
      assetDeepLinks?: Readonly<Record<string, string>>;
    };
  }): Promise<MaterializeResult>;
};

export type InfoOSStateScope = {
  sourceApiBaseUrl: string;
  vaultId: string;
  targetFolder: string;
};

export type InfoOSSyncFailure = {
  cardId: string;
  code: string;
  message: string;
};

export type InfoOSSyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  updateAvailable: number;
  failed: number;
  failures: InfoOSSyncFailure[];
  state: InfoOSSelectiveState;
};

export type CatalogRefreshResult = InfoOSSyncResult & {
  catalogCount: number;
  addedToCatalog: number;
  changedInCatalog: number;
};

type CompleteInfoOSSyncState = InfoOSSelectiveState;

export class InfoOSSyncEngine {
  private running = false;

  constructor(
    private readonly client: InfoOSSyncClient,
    private readonly materializer: InfoOSSyncMaterializer,
    private readonly getState: () => InfoOSSyncState
  ) {}

  async refreshCatalog(
    scope: InfoOSStateScope,
    options: {
      pageSize?: number;
      filters?: InfoOSCatalogFilters;
      capabilities?: readonly string[] | InfoOSCapabilities;
      sourceIds?: readonly string[];
      selectedSourceMode?: boolean;
      signal?: AbortSignal;
    } = {}
  ): Promise<CatalogRefreshResult> {
    return await this.exclusive(async () => {
      const normalized = normalizeScope(scope);
      const previous = normalizeState(this.getState());
      const sameScope = isSameScope(previous, normalized);
      const cards = options.selectedSourceMode && options.sourceIds?.length === 0 ? []
        : await this.client.listAllCards({ pageSize: options.pageSize, filters: options.filters,
          capabilities: options.capabilities, sourceIds: options.sourceIds }, options.signal);
      const items: Record<string, InfoOSCardCatalogItem> = {};
      const order: string[] = [];
      let addedToCatalog = 0;
      let changedInCatalog = 0;
      let unchanged = 0;
      for (const card of cards) {
        if (items[card.card_id]) {
          throw new InfoOSPluginError(
            "invalid_response",
            `InfoOS 目录包含重复卡片 ${card.card_id}。`
          );
        }
        items[card.card_id] = card;
        order.push(card.card_id);
        const old = sameScope ? previous.catalog.items[card.card_id] : undefined;
        if (!old) addedToCatalog += 1;
        else if (old.version !== card.version || old.content_hash !== card.content_hash) {
          changedInCatalog += 1;
        } else {
          unchanged += 1;
        }
      }
      const now = new Date().toISOString();
      const state: InfoOSSelectiveState = {
        entries: sameScope ? { ...previous.entries } : {},
        catalog: { items, order, refreshedAt: now },
        lastCompletedAt: now,
        sourceSubscriptionDefaultMode: previous.sourceSubscriptionDefaultMode,
        sourceSubscription: isSourceSubscriptionForScope(previous.sourceSubscription, normalized)
          ? cloneSourceSubscription(previous.sourceSubscription)
          : undefined,
        ...normalized
      };
      const updateAvailable = Object.values(state.entries).filter((entry) => {
        const remote = items[entry.cardId];
        return remote != null
          && (remote.version !== entry.version || remote.content_hash !== entry.contentHash);
      }).length;
      return {
        catalogCount: cards.length,
        addedToCatalog,
        changedInCatalog,
        created: 0,
        updated: 0,
        unchanged,
        updateAvailable,
        failed: 0,
        failures: [],
        state
      };
    });
  }

  async materializeSelected(
    cardIds: readonly string[],
    scope: InfoOSStateScope,
    options: {
      signal?: AbortSignal;
      cardDeepLink?: (cardId: string) => string;
      assetDeepLink?: (cardId: string, assetId: string) => string;
    } = {}
  ): Promise<InfoOSSyncResult> {
    return await this.exclusive(async () => {
      const normalized = normalizeScope(scope);
      const previous = normalizeState(this.getState());
      const state = stateForScope(previous, normalized);
      const result = emptyResult(state);
      for (const cardId of uniqueIds(cardIds)) {
        try {
          throwIfAborted(options.signal);
          const catalog = state.catalog.items[cardId];
          if (!catalog) {
            throw new InfoOSPluginError("not_found", `远端目录中不存在卡片 ${cardId}。`);
          }
          const old = state.entries[cardId];
          if (old) {
            const exists = await this.materializer.exists(old.markdownPath);
            if (!exists) {
              throw new InfoOSPluginError(
                "conflict",
                `卡片 ${cardId} 的物化索引存在，但 Markdown 已缺失。`
              );
            }
            if (old.version === catalog.version && old.contentHash === catalog.content_hash) {
              result.unchanged += 1;
            } else {
              result.updateAvailable += 1;
            }
            continue;
          }
          const detail = await this.client.getCard(cardId, options.signal);
          assertDetailMatchesCatalog(detail, catalog);
          const materialized = await this.materializer.materializeThin({
            detail,
            targetFolder: normalized.targetFolder,
            renderOptions: {
              cardDeepLink: options.cardDeepLink?.(cardId) ?? null,
              assetDeepLinks: buildAssetDeepLinks(detail, options.assetDeepLink)
            }
          });
          const now = new Date().toISOString();
          state.entries[cardId] = {
            cardId,
            version: detail.card.version,
            contentHash: detail.card.content_hash,
            markdownPath: materialized.markdownPath,
            offlineAssets: {},
            materializedAt: now,
            updatedAt: now
          };
          result.created += 1;
        } catch (error) {
          recordFailure(result, cardId, error);
        }
      }
      state.lastCompletedAt = new Date().toISOString();
      return result;
    });
  }

  async updateSelected(
    cardIds: readonly string[],
    scope: InfoOSStateScope,
    options: {
      signal?: AbortSignal;
      cardDeepLink?: (cardId: string) => string;
      assetDeepLink?: (cardId: string, assetId: string) => string;
    } = {}
  ): Promise<InfoOSSyncResult> {
    return await this.exclusive(async () => {
      const normalized = normalizeScope(scope);
      const previous = normalizeState(this.getState());
      const state = stateForScope(previous, normalized);
      const result = emptyResult(state);
      for (const cardId of uniqueIds(cardIds)) {
        try {
          throwIfAborted(options.signal);
          const catalog = state.catalog.items[cardId];
          const old = state.entries[cardId];
          if (!catalog || !old) {
            throw new InfoOSPluginError("not_found", `卡片 ${cardId} 尚未物化。`);
          }
          if (old.version === catalog.version && old.contentHash === catalog.content_hash) {
            result.unchanged += 1;
            continue;
          }
          const detail = await this.client.getCard(cardId, options.signal);
          assertDetailMatchesCatalog(detail, catalog);
          await this.materializer.updateManagedBlock({
            detail,
            targetFolder: normalized.targetFolder,
            markdownPath: old.markdownPath,
            renderOptions: {
              cardDeepLink: options.cardDeepLink?.(cardId) ?? null,
              assetDeepLinks: buildAssetDeepLinks(detail, options.assetDeepLink)
            }
          });
          state.entries[cardId] = {
            ...old,
            version: detail.card.version,
            contentHash: detail.card.content_hash,
            updatedAt: new Date().toISOString()
          };
          result.updated += 1;
        } catch (error) {
          recordFailure(result, cardId, error);
        }
      }
      state.lastCompletedAt = new Date().toISOString();
      return result;
    });
  }

  stopTracking(cardIds: readonly string[], scope: InfoOSStateScope): InfoOSSyncState {
    const normalized = normalizeScope(scope);
    const state = stateForScope(normalizeState(this.getState()), normalized);
    for (const cardId of uniqueIds(cardIds)) delete state.entries[cardId];
    return state;
  }

  registerOfflineAsset(
    cardId: string,
    entry: InfoOSOfflineAssetEntry,
    scope: InfoOSStateScope
  ): InfoOSSyncState {
    const state = stateForScope(normalizeState(this.getState()), normalizeScope(scope));
    const card = state.entries[cardId];
    if (!card) throw new InfoOSPluginError("not_found", `卡片 ${cardId} 尚未物化。`);
    state.entries[cardId] = {
      ...card,
      offlineAssets: { ...card.offlineAssets, [entry.assetId]: entry },
      updatedAt: new Date().toISOString()
    };
    return state;
  }

  unregisterOfflineAsset(
    cardId: string,
    assetId: string,
    scope: InfoOSStateScope
  ): InfoOSSyncState {
    const state = stateForScope(normalizeState(this.getState()), normalizeScope(scope));
    const card = state.entries[cardId];
    if (!card) throw new InfoOSPluginError("not_found", `卡片 ${cardId} 尚未物化。`);
    const offlineAssets = { ...card.offlineAssets };
    delete offlineAssets[assetId];
    state.entries[cardId] = {
      ...card,
      offlineAssets,
      updatedAt: new Date().toISOString()
    };
    return state;
  }

  /**
   * Deprecated v1 entry point. It is deliberately a catalog-only refresh and
   * never requests details or writes the Vault.
   */
  async sync(targetFolder: string, sourceApiBaseUrl: string): Promise<InfoOSSyncResult> {
    const previous = normalizeState(this.getState());
    return await this.refreshCatalog({
      targetFolder,
      sourceApiBaseUrl,
      vaultId: previous.vaultId ?? "legacy-unidentified-vault"
    });
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.running) {
      throw new InfoOSPluginError("sync_busy", "已有 InfoOS 操作正在进行。");
    }
    this.running = true;
    try {
      return await operation();
    } finally {
      this.running = false;
    }
  }

}

function normalizeScope(scope: InfoOSStateScope): InfoOSStateScope {
  const vaultId = scope.vaultId.trim();
  if (!vaultId) throw new InfoOSPluginError("invalid_config", "无法识别当前 Vault。");
  return {
    sourceApiBaseUrl: normalizeInfoOSApiBaseUrl(scope.sourceApiBaseUrl),
    vaultId,
    targetFolder: normalizeInfoOSTargetFolder(scope.targetFolder)
  };
}

function isSameScope(state: InfoOSSyncState, scope: InfoOSStateScope): boolean {
  return state.sourceApiBaseUrl === scope.sourceApiBaseUrl
    && state.vaultId === scope.vaultId
    && state.targetFolder === scope.targetFolder;
}

function isSourceSubscriptionForScope(
  subscription: InfoOSSyncState["sourceSubscription"],
  scope: InfoOSStateScope
): boolean {
  return subscription?.sourceApiBaseUrl === scope.sourceApiBaseUrl
    && subscription.vaultId === scope.vaultId
    && subscription.targetFolder === scope.targetFolder;
}

function stateForScope(
  previous: CompleteInfoOSSyncState,
  scope: InfoOSStateScope
): CompleteInfoOSSyncState {
  if (isSameScope(previous, scope)) {
    return {
      ...previous,
      entries: { ...previous.entries },
      catalog: {
        ...previous.catalog,
        items: { ...previous.catalog.items },
        order: [...previous.catalog.order]
      },
      sourceSubscription: cloneSourceSubscription(previous.sourceSubscription)
    };
  }
  return {
    entries: {},
    catalog: { ...EMPTY_INFOOS_CATALOG_CACHE, items: {}, order: [] },
    lastCompletedAt: null,
    sourceSubscriptionDefaultMode: previous.sourceSubscriptionDefaultMode,
    ...scope
  };
}

function normalizeState(value: InfoOSSyncState): CompleteInfoOSSyncState {
  const entries: Record<string, InfoOSSyncEntry> = {};
  for (const [cardId, entry] of Object.entries(value.entries ?? {})) {
    entries[cardId] = {
      ...entry,
      offlineAssets: entry.offlineAssets ?? {},
      materializedAt: entry.materializedAt ?? entry.syncedAt ?? new Date(0).toISOString(),
      updatedAt: entry.updatedAt ?? entry.syncedAt ?? new Date(0).toISOString()
    };
  }
  return {
    entries,
    catalog: value.catalog ?? { ...EMPTY_INFOOS_CATALOG_CACHE, items: {}, order: [] },
    lastCompletedAt: value.lastCompletedAt ?? null,
    sourceApiBaseUrl: value.sourceApiBaseUrl ?? null,
    vaultId: value.vaultId ?? null,
    targetFolder: value.targetFolder ?? null,
    sourceSubscriptionDefaultMode: value.sourceSubscriptionDefaultMode,
    sourceSubscription: cloneSourceSubscription(value.sourceSubscription)
  };
}

function cloneSourceSubscription(
  subscription: InfoOSSyncState["sourceSubscription"]
): InfoOSSyncState["sourceSubscription"] {
  return subscription ? {
    ...subscription,
    selectedSourceIds: [...subscription.selectedSourceIds],
    catalog: Object.fromEntries(Object.entries(subscription.catalog)
      .map(([sourceId, source]) => [sourceId, { ...source }])),
    order: [...subscription.order]
  } : undefined;
}

function assertDetailMatchesCatalog(
  detail: InfoOSCardDetail,
  catalog: InfoOSCardCatalogItem
): void {
  if (detail.card.card_id !== catalog.card_id
    || detail.card.version !== catalog.version
    || detail.card.content_hash !== catalog.content_hash) {
    throw new InfoOSPluginError(
      "conflict",
      `卡片 ${catalog.card_id} 的目录与详情版本不一致。`
    );
  }
}

function emptyResult(state: CompleteInfoOSSyncState): InfoOSSyncResult {
  return {
    created: 0,
    updated: 0,
    unchanged: 0,
    updateAvailable: 0,
    failed: 0,
    failures: [],
    state
  };
}

function recordFailure(result: InfoOSSyncResult, cardId: string, error: unknown): void {
  result.failed += 1;
  result.failures.push({
    cardId,
    code: error instanceof InfoOSPluginError ? error.code : "unknown_error",
    message: error instanceof Error ? error.message : "未知错误"
  });
}

function uniqueIds(cardIds: readonly string[]): string[] {
  return [...new Set(cardIds.map((id) => id.trim()).filter(Boolean))];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new InfoOSPluginError("cancelled", "InfoOS 操作已取消。");
}

function buildAssetDeepLinks(
  detail: InfoOSCardDetail,
  builder?: (cardId: string, assetId: string) => string
): Record<string, string> | undefined {
  if (!builder) return undefined;
  return Object.fromEntries(detail.assets.map((asset) => [
    asset.asset_id,
    builder(detail.card.card_id, asset.asset_id)
  ]));
}
