import { describe, expect, it } from "vitest";
import {
  catalogPresentationMetadata,
  isScopeVisible,
  orderedCatalog,
  restoreAuthoritativeCatalog,
  selectedVisible,
  updateAvailable,
  withTransientCatalog
} from "../src/ui/infoos-view-model";
import type { InfoOSCardCatalogItem, InfoOSSelectiveState, InfoOSSyncState } from "../src/infoos/contracts";

const card = (id: string, platform = "X", images = 0): InfoOSCardCatalogItem => ({
  card_id: id, card_type: "post", version: 1, content_hash: id, title: `Title ${id}`,
  source_platform: platform, source_url: null, published_at: null, updated_at: "2026-01-01", status: "ready",
  completeness_status: "complete", excerpt: `excerpt ${id}`, asset_summary: { image_count: images, video_count: 0, audio_count: 0, other_count: 0 }
});

describe("InfoOS view model", () => {
  it("filters cached catalog locally in preserved catalog order", () => {
    const state = { entries: {}, catalog: { items: { b: card("b", "B", 1), a: card("a") }, order: ["b", "a"], refreshedAt: null }, lastCompletedAt: null, sourceApiBaseUrl: null, vaultId: null, targetFolder: null } satisfies InfoOSSyncState;
    expect(orderedCatalog(state, { query: "", platform: "B", completeness: "", mediaKind: "image" }).map((item) => item.card_id)).toEqual(["b"]);
    expect(orderedCatalog(state, { query: "title", platform: "", completeness: "", mediaKind: "" }).map((item) => item.card_id)).toEqual(["b", "a"]);
  });
  it("marks materialized cards that differ from their cached remote version", () => {
    const remote = card("a");
    expect(updateAvailable({ cardId: "a", version: 0, contentHash: "old", markdownPath: "a.md", offlineAssets: {}, materializedAt: "", updatedAt: "" }, remote)).toBe(true);
  });
  it("keeps selection independent of the active local filter and scopes cache presentation", () => {
    const cards = [card("a"), card("b")];
    expect(selectedVisible(new Set(["a", "missing"]), cards)).toEqual(["a"]);
    const state = { entries: {}, catalog: { items: {}, order: [], refreshedAt: null }, lastCompletedAt: null, sourceApiBaseUrl: "https://infoos.test/api/v1", vaultId: "vault", targetFolder: "InfoOS" } satisfies InfoOSSyncState;
    expect(isScopeVisible(state, { sourceApiBaseUrl: "https://infoos.test/api/v1", vaultId: "vault", targetFolder: "InfoOS" })).toBe(true);
    expect(isScopeVisible(state, { sourceApiBaseUrl: "https://infoos.test/api/v1", vaultId: "other", targetFolder: "InfoOS" })).toBe(false);
  });
  it("keeps a selection when a transient remote query changes visible cards and exposes media metadata", () => {
    expect(selectedVisible(new Set(["a"]), [card("a")])).toEqual(["a"]);
    expect(catalogPresentationMetadata(card("a", "X", 2))).toEqual([
      "X", "complete", "图片 2", "视频 0", "音频 0"
    ]);
  });
  it("materializes against transient query items without persisting them into the authoritative catalog", () => {
    const cached = card("cached");
    const queried = card("body-only");
    const authoritative = {
      entries: {},
      catalog: { items: { cached }, order: ["cached"], refreshedAt: "2026-01-01" },
      lastCompletedAt: null,
      sourceApiBaseUrl: "https://infoos.test/api/v1",
      vaultId: "vault",
      targetFolder: "InfoOS"
    } satisfies InfoOSSyncState;
    const working = withTransientCatalog(authoritative, [queried]);
    expect(working.catalog?.order).toEqual(["cached", "body-only"]);
    expect(working.catalog?.items["body-only"]).toEqual(queried);

    const materializedState = {
      ...working,
      vaultId: working.vaultId ?? null,
      entries: {
        "body-only": {
          cardId: "body-only", version: 1, contentHash: "body-only",
          markdownPath: "InfoOS/body-only.md", offlineAssets: {},
          materializedAt: "2026-01-01", updatedAt: "2026-01-01"
        }
      },
      catalog: working.catalog!
    } satisfies InfoOSSelectiveState;
    const committed = restoreAuthoritativeCatalog(materializedState, authoritative);
    expect(committed.catalog).toEqual(authoritative.catalog);
    expect(committed.entries["body-only"]?.markdownPath).toBe("InfoOS/body-only.md");
  });
});
