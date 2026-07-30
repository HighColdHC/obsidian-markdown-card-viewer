import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_INFOOS_SYNC_STATE,
  type InfoOSCardCatalogItem,
  type InfoOSCardDetail,
  type InfoOSSyncState
} from "../src/infoos/contracts";
import { InfoOSSyncEngine, type InfoOSStateScope } from "../src/infoos/sync-engine";

describe("InfoOSSyncEngine selective materialization", () => {
  it("refreshes a 1000-card L0 catalog with zero detail requests and Vault calls", async () => {
    const catalog = Array.from({ length: 1000 }, (_, index) => catalogItem(`card-${index}`));
    const client = {
      listAllCards: vi.fn().mockResolvedValue(catalog),
      getCard: vi.fn()
    };
    const materializer = materializerMock();
    const engine = new InfoOSSyncEngine(client, materializer, () =>
      structuredClone(EMPTY_INFOOS_SYNC_STATE));

    const result = await engine.refreshCatalog(scope());

    expect(result.catalogCount).toBe(1000);
    expect(result.created).toBe(0);
    expect(result.state.catalog.order).toHaveLength(1000);
    expect(client.getCard).not.toHaveBeenCalled();
    expect(materializer.exists).not.toHaveBeenCalled();
    expect(materializer.materializeThin).not.toHaveBeenCalled();
    expect(materializer.updateManagedBlock).not.toHaveBeenCalled();
  });

  it("requests details and writes thin Markdown only for selected cards", async () => {
    let state = stateWithCatalog(["card-1", "card-2", "card-3"]);
    const client = {
      listAllCards: vi.fn(),
      getCard: vi.fn((id: string) => {
        const detail = cardDetail(id);
        detail.assets = [{
          asset_id: "asset-1",
          kind: "image",
          mime_type: "image/png",
          size_bytes: 1,
          content_hash: `sha256:${"a".repeat(64)}`,
          status: "ready",
          url: "/api/plugin/v1/assets/asset-1"
        }];
        return Promise.resolve(detail);
      })
    };
    const materializer = materializerMock();
    const engine = new InfoOSSyncEngine(client, materializer, () => state);

    const result = await engine.materializeSelected(["card-2"], scope(), {
      cardDeepLink: (cardId) => `https://infoos.test/?menu=cards&card_id=${cardId}`,
      assetDeepLink: (cardId, assetId) =>
        `https://infoos.test/?menu=cards&card_id=${cardId}&asset_id=${assetId}`
    });
    state = result.state;

    expect(result).toMatchObject({ created: 1, failed: 0 });
    expect(client.getCard).toHaveBeenCalledOnce();
    expect(client.getCard).toHaveBeenCalledWith("card-2", undefined);
    expect(materializer.materializeThin).toHaveBeenCalledOnce();
    expect(state.entries["card-2"]?.offlineAssets).toEqual({});
    expect(materializer.materializeThin).toHaveBeenCalledWith(expect.objectContaining({
      renderOptions: expect.objectContaining({
        assetDeepLinks: {
          "asset-1": "https://infoos.test/?menu=cards&card_id=card-2&asset_id=asset-1"
        }
      })
    }));
  });

  it("refreshes unchanged catalog data without any Vault call", async () => {
    const state = stateWithCatalog(["card-1"]);
    const client = {
      listAllCards: vi.fn().mockResolvedValue([catalogItem("card-1")]),
      getCard: vi.fn()
    };
    const materializer = materializerMock();
    const engine = new InfoOSSyncEngine(client, materializer, () => state);

    const result = await engine.refreshCatalog(scope());

    expect(result.unchanged).toBe(1);
    expect(materializer.exists).not.toHaveBeenCalled();
    expect(materializer.materializeThin).not.toHaveBeenCalled();
  });

  it("marks a changed materialized card update-available until explicit update", async () => {
    const state = stateWithCatalog(["card-1"]);
    state.entries["card-1"] = entry("card-1", 1, "hash-card-1");
    const changed = { ...catalogItem("card-1"), version: 2, content_hash: "new-hash" };
    const client = {
      listAllCards: vi.fn().mockResolvedValue([changed]),
      getCard: vi.fn().mockResolvedValue(cardDetail("card-1", 2, "new-hash"))
    };
    const materializer = materializerMock();
    const engine = new InfoOSSyncEngine(client, materializer, () => state);

    const refreshed = await engine.refreshCatalog(scope());
    expect(refreshed.updateAvailable).toBe(1);
    expect(materializer.updateManagedBlock).not.toHaveBeenCalled();
    state.catalog = refreshed.state.catalog;

    const selectedAgain = await engine.materializeSelected(["card-1"], scope());
    expect(selectedAgain.updateAvailable).toBe(1);
    expect(client.getCard).not.toHaveBeenCalled();

    const updated = await engine.updateSelected(["card-1"], scope());
    expect(updated.updated).toBe(1);
    expect(client.getCard).toHaveBeenCalledOnce();
    expect(materializer.updateManagedBlock).toHaveBeenCalledOnce();
    expect(updated.state.entries["card-1"]?.contentHash).toBe("new-hash");
  });

  it("isolates per-card failures and resets cache/index when any scope binding changes", async () => {
    const state = stateWithCatalog(["card-1", "card-2"]);
    const client = {
      listAllCards: vi.fn(),
      getCard: vi.fn()
        .mockRejectedValueOnce(new Error("unavailable"))
        .mockResolvedValueOnce(cardDetail("card-2"))
    };
    const materializer = materializerMock();
    const engine = new InfoOSSyncEngine(client, materializer, () => state);
    const selected = await engine.materializeSelected(["card-1", "card-2"], scope());
    expect(selected).toMatchObject({ created: 1, failed: 1 });

    client.listAllCards.mockResolvedValue([]);
    const switched = await engine.refreshCatalog({ ...scope(), vaultId: "vault-2" });
    expect(switched.state.entries).toEqual({});
    expect(switched.state.catalog.items).toEqual({});
  });

  it("rejects concurrent operations", async () => {
    let release!: () => void;
    const blocked = new Promise<InfoOSCardCatalogItem[]>((resolve) => {
      release = () => resolve([]);
    });
    const engine = new InfoOSSyncEngine({
      listAllCards: vi.fn().mockReturnValue(blocked),
      getCard: vi.fn()
    }, materializerMock(), () => structuredClone(EMPTY_INFOOS_SYNC_STATE));
    const first = engine.refreshCatalog(scope());
    await expect(engine.refreshCatalog(scope())).rejects.toMatchObject({ code: "sync_busy" });
    release();
    await first;
  });
});

function materializerMock() {
  return {
    exists: vi.fn().mockResolvedValue(true),
    getMarkdownPath: vi.fn((folder: string, id: string) => `${folder}/Cards/${id}.md`),
    materializeThin: vi.fn(({ detail }: { detail: InfoOSCardDetail }) =>
      Promise.resolve({ markdownPath: `InfoOS/Cards/${detail.card.card_id}.md`, assetPaths: [] })),
    updateManagedBlock: vi.fn().mockResolvedValue({
      markdownPath: "InfoOS/Cards/card-1.md",
      assetPaths: []
    })
  };
}

function scope(): InfoOSStateScope {
  return {
    sourceApiBaseUrl: "https://infoos.example.com",
    vaultId: "vault-1",
    targetFolder: "InfoOS"
  };
}

function stateWithCatalog(ids: string[]): InfoOSSyncState {
  const items = Object.fromEntries(ids.map((id) => [id, catalogItem(id)]));
  return {
    entries: {},
    catalog: { items, order: ids, refreshedAt: "2026-07-30T00:00:00Z" },
    lastCompletedAt: "2026-07-30T00:00:00Z",
    sourceApiBaseUrl: "https://infoos.example.com/api/plugin/v1",
    vaultId: "vault-1",
    targetFolder: "InfoOS"
  };
}

function entry(cardId: string, version: number, contentHash: string) {
  return {
    cardId,
    version,
    contentHash,
    markdownPath: `InfoOS/Cards/${cardId}.md`,
    offlineAssets: {},
    materializedAt: "2026-07-30T00:00:00Z",
    updatedAt: "2026-07-30T00:00:00Z"
  };
}

function catalogItem(cardId: string): InfoOSCardCatalogItem {
  return {
    card_id: cardId,
    card_type: "information",
    version: 1,
    content_hash: `hash-${cardId}`,
    title: cardId,
    source_platform: "rss",
    source_url: "https://example.com/post",
    published_at: null,
    updated_at: "2026-07-30T00:00:00Z",
    status: "active",
    completeness_status: "complete",
    excerpt: "摘要",
    asset_summary: {
      image_count: 0,
      video_count: 0,
      audio_count: 0,
      other_count: 0
    }
  };
}

function cardDetail(
  cardId: string,
  version = 1,
  contentHash = `hash-${cardId}`
): InfoOSCardDetail {
  return {
    schema: "infoos.information-card.v1",
    card: {
      ...catalogItem(cardId),
      version,
      content_hash: contentHash,
      source_type: "rss",
      source_author: null,
      captured_at: null,
      missing_reasons: [],
      processor_version: null,
      raw_connector_id: null,
      raw_item_id: null,
      source_run_id: null
    },
    blocks: [],
    assets: []
  };
}
