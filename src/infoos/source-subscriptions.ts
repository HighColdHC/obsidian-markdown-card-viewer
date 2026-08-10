import type {
  InfoOSSourceCatalogItem,
  InfoOSSourceSubscription,
  InfoOSSyncState
} from "./contracts";

export type InfoOSSourceScope = {
  sourceApiBaseUrl: string;
  vaultId: string;
  targetFolder: string;
};

export function sourceSubscriptionForScope(
  state: InfoOSSyncState,
  scope: InfoOSSourceScope,
  migratedMode: "all" | "selected" = "selected"
): InfoOSSourceSubscription {
  const current = state.sourceSubscription;
  if (current && isSourceSubscriptionCurrent(current, scope)) {
    return {
      ...current,
      selectedSourceIds: [...current.selectedSourceIds],
      catalog: { ...current.catalog },
      order: [...current.order]
    };
  }
  return {
    mode: migratedMode,
    selectedSourceIds: [],
    catalog: {},
    order: [],
    refreshedAt: null,
    ...scope
  };
}

export function isSourceSubscriptionCurrent(
  subscription: InfoOSSourceSubscription | undefined,
  scope: InfoOSSourceScope
): boolean {
  return subscription?.sourceApiBaseUrl === scope.sourceApiBaseUrl
    && subscription.vaultId === scope.vaultId
    && subscription.targetFolder === scope.targetFolder;
}

export function sourceSubscriptionWithCatalog(
  subscription: InfoOSSourceSubscription,
  sources: readonly InfoOSSourceCatalogItem[]
): InfoOSSourceSubscription {
  const catalog = Object.fromEntries(sources.map((source) => [source.source_id, source]));
  return {
    ...subscription,
    catalog,
    order: sources.map((source) => source.source_id),
    refreshedAt: new Date().toISOString()
  };
}

export function sourceSubscriptionWithSelection(
  subscription: InfoOSSourceSubscription,
  mode: "all" | "selected",
  ids: readonly string[]
): InfoOSSourceSubscription {
  return {
    ...subscription,
    mode,
    selectedSourceIds: [...new Set(ids)].sort((a, b) => a.localeCompare(b))
  };
}

export function visibleSources(
  subscription: InfoOSSourceSubscription,
  query: string,
  platform: string
): InfoOSSourceCatalogItem[] {
  const needle = query.trim().toLocaleLowerCase();
  return subscription.order
    .map((id) => subscription.catalog[id])
    .filter((source): source is InfoOSSourceCatalogItem => Boolean(source)
      && (!platform || source.platform === platform)
      && (!needle || [source.display_name, source.platform, source.source_type]
        .some((value) => value.toLocaleLowerCase().includes(needle))));
}

export function hasLegacyInfoOSState(state: InfoOSSyncState): boolean {
  return Boolean(
    state.sourceApiBaseUrl
    || state.targetFolder
    || state.catalog?.order.length
    || Object.keys(state.entries).length
  );
}

export function defaultSourceSubscriptionMode(state: InfoOSSyncState): "all" | "selected" {
  return state.sourceSubscriptionDefaultMode
    ?? (!state.sourceSubscription && hasLegacyInfoOSState(state) ? "all" : "selected");
}
