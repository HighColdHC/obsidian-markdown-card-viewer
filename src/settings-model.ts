import {
  EMPTY_INFOOS_SYNC_STATE,
  type InfoOSSyncState
} from "./infoos/contracts";

export type LayoutMode = "graph" | "grid" | "masonry" | "list" | "feed";
export type ContentMode = "summary" | "full";

export type GraphViewportState = {
  zoom: number;
  panX: number;
  panY: number;
};

export type FolderViewState = {
  graphLayoutVersion: number;
  feedSeed: number;
  layout: LayoutMode;
  contentMode: ContentMode;
  columns: number;
  selectedPath: string | null;
  listWidth: number;
  graphDetailWidth: number;
  graphViewport: GraphViewportState;
  graphPositions: Record<string, [number, number]>;
};

export type LastViewState =
  | { mode: "single"; path: string }
  | { mode: "folder"; path: string };

export type CardViewerSettings = {
  cardWidth: number;
  cardHeight: number;
  gap: number;
  folderStates: Record<string, FolderViewState>;
  lastView: LastViewState | null;
  infoOSBaseUrl: string;
  infoOSToken: string;
  infoOSTargetFolder: string;
  /** Stable, local-only scope key. It is never sent to InfoOS. */
  infoOSVaultId: string;
  infoOSSyncState: InfoOSSyncState;
};

export const DEFAULT_SETTINGS: CardViewerSettings = {
  cardWidth: 340,
  cardHeight: 480,
  gap: 16,
  folderStates: {},
  lastView: null,
  infoOSBaseUrl: "",
  infoOSToken: "",
  infoOSTargetFolder: "InfoOS",
  infoOSVaultId: "",
  infoOSSyncState: structuredClone(EMPTY_INFOOS_SYNC_STATE)
};

export function normalizeSettings(loaded: Partial<CardViewerSettings> | null): CardViewerSettings {
  const legacyState = loaded?.infoOSSyncState;
  const vaultId = normalizedVaultId(loaded?.infoOSVaultId);
  const sourceSubscriptionDefaultMode = legacyState?.sourceSubscriptionDefaultMode
    ?? (loaded && (
      Boolean(loaded.infoOSBaseUrl?.trim())
      || Boolean(loaded.infoOSToken?.trim())
      || Boolean(legacyState?.sourceApiBaseUrl)
      || Boolean(legacyState?.targetFolder)
      || Boolean(legacyState?.catalog?.order.length)
      || Boolean(Object.keys(legacyState?.entries ?? {}).length)
    ) ? "all" : "selected");
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...loaded,
    folderStates: loaded?.folderStates ?? {},
    infoOSVaultId: vaultId,
    infoOSSyncState: {
      entries: normalizeEntries(legacyState?.entries),
      catalog: {
        items: legacyState?.catalog?.items ?? {},
        order: legacyState?.catalog?.order ?? [],
        refreshedAt: legacyState?.catalog?.refreshedAt ?? null
      },
      lastCompletedAt: legacyState?.lastCompletedAt ?? null,
      sourceApiBaseUrl: legacyState?.sourceApiBaseUrl ?? null,
      // Bind a legacy single-vault index to the newly generated local Vault ID.
      // This preserves the existing materialization inventory on the first v2
      // catalog refresh without ever sending the ID to InfoOS.
      vaultId: legacyState?.vaultId ?? (
        legacyState?.sourceApiBaseUrl || legacyState?.targetFolder ? vaultId : null
      ),
      targetFolder: legacyState?.targetFolder ?? null,
      sourceSubscriptionDefaultMode,
      sourceSubscription: legacyState?.sourceSubscription ? {
        ...legacyState.sourceSubscription,
        selectedSourceIds: [...new Set(legacyState.sourceSubscription.selectedSourceIds ?? [])],
        catalog: legacyState.sourceSubscription.catalog ?? {},
        order: legacyState.sourceSubscription.order ?? [],
        refreshedAt: legacyState.sourceSubscription.refreshedAt ?? null,
        sourceApiBaseUrl: legacyState.sourceSubscription.sourceApiBaseUrl ?? null,
        vaultId: legacyState.sourceSubscription.vaultId ?? null,
        targetFolder: legacyState.sourceSubscription.targetFolder ?? null
      } : undefined
    }
  };
}

function normalizeEntries(entries: CardViewerSettings["infoOSSyncState"]["entries"] | undefined) {
  const normalized: CardViewerSettings["infoOSSyncState"]["entries"] = {};
  for (const [cardId, entry] of Object.entries(entries ?? {})) {
    normalized[cardId] = {
      ...entry,
      offlineAssets: entry.offlineAssets ?? {},
      // Retain v1 assetPaths unchanged for audit/migration visibility.
      assetPaths: entry.assetPaths,
      materializedAt: entry.materializedAt ?? entry.syncedAt ?? new Date(0).toISOString(),
      updatedAt: entry.updatedAt ?? entry.syncedAt ?? new Date(0).toISOString()
    };
  }
  return normalized;
}

function normalizedVaultId(value: string | undefined): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `vault-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createDefaultFolderState(): FolderViewState {
  return {
    graphLayoutVersion: 2,
    feedSeed: Date.now() >>> 0,
    layout: "graph",
    contentMode: "summary",
    columns: 0,
    selectedPath: null,
    listWidth: 280,
    graphDetailWidth: 400,
    graphViewport: { zoom: 1, panX: 0, panY: 0 },
    graphPositions: {}
  };
}
