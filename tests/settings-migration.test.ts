import { describe, expect, it } from "vitest";
import { normalizeSettings, type CardViewerSettings } from "../src/settings-model";

describe("normalizeSettings", () => {
  it("adds InfoOS defaults without losing legacy viewer settings", () => {
    const settings = normalizeSettings({
      cardWidth: 420,
      cardHeight: 600,
      gap: 20,
      folderStates: {},
      lastView: { mode: "single", path: "note.md" }
    } as unknown as Partial<CardViewerSettings>);

    expect(settings.cardWidth).toBe(420);
    expect(settings.lastView).toEqual({ mode: "single", path: "note.md" });
    expect(settings.infoOSBaseUrl).toBe("");
    expect(settings.infoOSToken).toBe("");
    expect(settings.infoOSTargetFolder).toBe("InfoOS");
    expect(settings.infoOSVaultId).toBeTruthy();
    expect(settings.infoOSSyncState).toMatchObject({
      entries: {}, catalog: { items: {}, order: [], refreshedAt: null },
      lastCompletedAt: null, sourceApiBaseUrl: null, vaultId: null, targetFolder: null
    });
  });

  it("preserves legacy eager asset paths as audit-only data while adding v2 state", () => {
    const settings = normalizeSettings({
      infoOSBaseUrl: "https://infoos.example.com",
      infoOSTargetFolder: "InfoOS",
      infoOSSyncState: { entries: {
        old: { cardId: "old", version: 1, contentHash: "hash", markdownPath: "InfoOS/Cards/old.md", assetPaths: ["InfoOS/Assets/old/a.jpg"], syncedAt: "2026-01-01T00:00:00.000Z" }
      }, lastCompletedAt: null, sourceApiBaseUrl: "https://infoos.example.com/api/plugin/v1", targetFolder: "InfoOS" }
    } as unknown as Partial<CardViewerSettings>);
    expect(settings.infoOSSyncState.entries.old.assetPaths).toEqual(["InfoOS/Assets/old/a.jpg"]);
    expect(settings.infoOSSyncState.entries.old.offlineAssets).toEqual({});
    expect(settings.infoOSSyncState.catalog?.order).toEqual([]);
    expect(settings.infoOSSyncState.vaultId).toBe(settings.infoOSVaultId);
  });
});
