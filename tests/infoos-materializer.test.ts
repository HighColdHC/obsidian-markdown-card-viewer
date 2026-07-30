import { describe, expect, it } from "vitest";
import type {
  InfoOSCardDetail,
  InfoOSOfflineAssetEntry
} from "../src/infoos/contracts";
import {
  InfoOSVaultMaterializer,
  type VaultFileInfo,
  type VaultWriteAdapter
} from "../src/infoos/vault-materializer";
import { InfoOSDownloadSession } from "../src/ui/infoos-download-control";

describe("InfoOSVaultMaterializer", () => {
  it("previews the same deterministic offline path used for a known MIME type", async () => {
    const vault = new MemoryVault();
    const materializer = new InfoOSVaultMaterializer(vault);
    const detail = cardDetail();
    const preview = materializer.getOfflineAssetPath(
      "InfoOS",
      detail.card.card_id,
      detail.assets[0]!
    );
    const thin = await materializer.materializeThin({ detail, targetFolder: "InfoOS" });
    const saved = await materializer.saveOfflineAsset({
      cardId: detail.card.card_id,
      markdownPath: thin.markdownPath,
      targetFolder: "InfoOS",
      asset: detail.assets[0]!,
      bytes: bytes("image"),
      registeredAssetIds: [detail.assets[0]!.asset_id]
    });

    expect(saved.path).toBe(preview);
  });

  it("materializes one thin Markdown with remote placeholders and no binary writes", async () => {
    const vault = new MemoryVault();
    const materializer = new InfoOSVaultMaterializer(vault);
    const detail = cardDetail();

    const result = await materializer.materialize({
      detail,
      targetFolder: "InfoOS",
      assets: [{ asset: detail.assets[0]!, bytes: bytes("image") }],
      renderOptions: {
        cardDeepLink: "https://infoos.example.com/?menu=cards&card_id=card-1"
      }
    });
    const markdown = vault.text.get(result.markdownPath)!;

    expect(result.assetPaths).toEqual([]);
    expect(vault.binary.size).toBe(0);
    expect(markdown).toContain("infoos_materialization: \"thin\"");
    expect(markdown).toContain("infoos_offline_assets: []");
    expect(markdown).toContain("<!-- infoos:managed:start -->");
    expect(markdown).toContain("第一段原始正文");
    expect(markdown).toContain("```infoos-asset");
    expect(markdown).toContain("\"mode\":\"remote\"");
    expect(markdown).toContain("在 InfoOS 播放");
    expect(markdown).toContain("?menu=cards&card_id=card-1");
    expect(markdown).not.toContain("![[");
    expect(markdown).not.toContain("token=");
  });

  it("preserves user bytes outside markers during explicit update", async () => {
    const vault = new MemoryVault();
    const materializer = new InfoOSVaultMaterializer(vault);
    const first = await materializer.materializeThin({
      detail: cardDetail(),
      targetFolder: "InfoOS"
    });
    const userSuffix = "\n\nUser annotation  \n[[My Link]]\n";
    vault.text.set(first.markdownPath, vault.text.get(first.markdownPath)! + userSuffix);
    const changed = cardDetail();
    changed.card.version = 2;
    changed.card.content_hash = "new-hash";
    changed.blocks[0]!.body = "更新后的远端正文";

    await materializer.updateManagedBlock({
      detail: changed,
      targetFolder: "InfoOS",
      markdownPath: first.markdownPath
    });

    const updated = vault.text.get(first.markdownPath)!;
    expect(updated).toContain("infoos_version: 2");
    expect(updated).toContain("更新后的远端正文");
    expect(updated.endsWith(userSuffix)).toBe(true);
  });

  it("escapes remote managed sentinels so update and offline save remain operable", async () => {
    const vault = new MemoryVault();
    const materializer = new InfoOSVaultMaterializer(vault);
    const detail = cardDetail();
    detail.blocks[0]!.body = [
      "remote before",
      "<!-- infoos:managed:start -->",
      "remote middle",
      "<!-- infoos:managed:end -->",
      "remote after"
    ].join("\n");
    const first = await materializer.materializeThin({ detail, targetFolder: "InfoOS" });
    const initial = vault.text.get(first.markdownPath)!;
    expect(initial.match(/<!-- infoos:managed:start -->/g)).toHaveLength(1);
    expect(initial.match(/<!-- infoos:managed:end -->/g)).toHaveLength(1);
    expect(initial).toContain("<!-- infoos&#58;managed:start -->");
    expect(initial).toContain("<!-- infoos&#58;managed:end -->");

    detail.card.version = 2;
    detail.card.content_hash = "updated-hash";
    await materializer.updateManagedBlock({
      detail,
      targetFolder: "InfoOS",
      markdownPath: first.markdownPath
    });
    await expect(materializer.saveOfflineAsset({
      cardId: detail.card.card_id,
      markdownPath: first.markdownPath,
      targetFolder: "InfoOS",
      asset: detail.assets[0]!,
      bytes: bytes("image"),
      registeredAssetIds: [detail.assets[0]!.asset_id]
    })).resolves.toMatchObject({ assetId: "asset-1" });
  });

  it("stops on damaged markers and never overwrites an unmanaged collision", async () => {
    const vault = new MemoryVault();
    const materializer = new InfoOSVaultMaterializer(vault);
    const path = materializer.getMarkdownPath("InfoOS", "card-1");
    vault.text.set(path, "# user file");
    await expect(materializer.materializeThin({
      detail: cardDetail(),
      targetFolder: "InfoOS"
    })).rejects.toMatchObject({ code: "conflict" });
    expect(vault.text.get(path)).toBe("# user file");

    vault.text.set(path, managedMarkdown().replace("<!-- infoos:managed:end -->", ""));
    await expect(materializer.updateManagedBlock({
      detail: cardDetail(),
      targetFolder: "InfoOS",
      markdownPath: path
    })).rejects.toMatchObject({ code: "conflict" });
  });

  it("saves only one selected asset after exact size and SHA validation", async () => {
    const vault = new MemoryVault();
    const materializer = new InfoOSVaultMaterializer(vault);
    const result = await materializer.materializeThin({
      detail: cardDetail(),
      targetFolder: "InfoOS"
    });
    const asset = cardDetail().assets[0]!;
    const entry = await materializer.saveOfflineAsset({
      cardId: "card-1",
      markdownPath: result.markdownPath,
      targetFolder: "InfoOS",
      asset,
      bytes: bytes("image"),
      registeredAssetIds: ["asset-1", "asset-video"]
    });

    expect(vault.binary.size).toBe(1);
    expect(entry.path).toMatch(/^InfoOS\/Assets\/card-1--[a-f0-9]+\/asset-1--[a-f0-9]+--6105d6cc.*\.png$/);
    expect(vault.text.get(result.markdownPath))
      .toContain('infoos_offline_assets: ["asset-1"]');

    await expect(materializer.saveOfflineAsset({
      cardId: "card-1",
      markdownPath: result.markdownPath,
      targetFolder: "InfoOS",
      asset: { ...asset, size_bytes: 999 },
      bytes: bytes("image"),
      registeredAssetIds: ["asset-1"]
    })).rejects.toMatchObject({ code: "checksum_mismatch" });
    expect(vault.binary.size).toBe(1);
  });

  it("finishes a consistent local commit after cancellation has been closed", async () => {
    const vault = new MemoryVault();
    const materializer = new InfoOSVaultMaterializer(vault);
    const result = await materializer.materializeThin({
      detail: cardDetail(),
      targetFolder: "InfoOS"
    });
    const download = new InfoOSDownloadSession();
    expect(download.beginCommit()).toBe(true);

    const cancellationAttempts: boolean[] = [];
    const writeBinary = vault.writeBinary.bind(vault);
    const writeText = vault.writeText.bind(vault);
    vault.writeBinary = async (path, content) => {
      cancellationAttempts.push(download.cancel());
      await writeBinary(path, content);
    };
    vault.writeText = async (path, content) => {
      cancellationAttempts.push(download.cancel());
      await writeText(path, content);
    };

    const saved = await materializer.saveOfflineAsset({
      cardId: "card-1",
      markdownPath: result.markdownPath,
      targetFolder: "InfoOS",
      asset: cardDetail().assets[0]!,
      bytes: bytes("image"),
      registeredAssetIds: ["asset-1"]
    });
    const settingsIndex = new Map<string, InfoOSOfflineAssetEntry>();
    cancellationAttempts.push(download.cancel());
    settingsIndex.set(saved.assetId, saved);
    download.complete();

    expect(cancellationAttempts).toEqual([false, false, false]);
    expect(vault.binary.has(saved.path)).toBe(true);
    expect(vault.text.get(result.markdownPath)).toContain('infoos_offline_assets: ["asset-1"]');
    expect(settingsIndex.get("asset-1")).toEqual(saved);
    expect(download.phase).toBe("complete");
  });

  it("trashes only a registered managed asset and never Markdown or an unmanaged path", async () => {
    const vault = new MemoryVault();
    const materializer = new InfoOSVaultMaterializer(vault);
    const result = await materializer.materializeThin({
      detail: cardDetail(),
      targetFolder: "InfoOS"
    });
    const saved = await materializer.saveOfflineAsset({
      cardId: "card-1",
      markdownPath: result.markdownPath,
      targetFolder: "InfoOS",
      asset: cardDetail().assets[0]!,
      bytes: bytes("image"),
      registeredAssetIds: ["asset-1"]
    });
    const registered = { "asset-1": saved };

    const unsafe: InfoOSOfflineAssetEntry = { ...saved, path: result.markdownPath };
    await expect(materializer.removeRegisteredAsset({
      cardId: "card-1",
      markdownPath: result.markdownPath,
      targetFolder: "InfoOS",
      entry: unsafe,
      registeredAssets: { "asset-1": unsafe }
    })).rejects.toMatchObject({ code: "conflict" });
    expect(vault.trashed).toEqual([]);

    await materializer.removeRegisteredAsset({
      cardId: "card-1",
      markdownPath: result.markdownPath,
      targetFolder: "InfoOS",
      entry: saved,
      registeredAssets: registered
    });
    expect(vault.trashed).toEqual([{ path: saved.path, system: true }]);
    expect(vault.text.has(result.markdownPath)).toBe(true);
    expect(vault.text.get(result.markdownPath)).toContain("infoos_offline_assets: []");
  });

  it("provides a read-only legacy audit without mutations", async () => {
    const vault = new MemoryVault();
    const materializer = new InfoOSVaultMaterializer(vault);
    const result = await materializer.materializeThin({
      detail: cardDetail(),
      targetFolder: "InfoOS"
    });
    const cardSegment = result.markdownPath.slice("InfoOS/Cards/".length, -3);
    vault.text.set("InfoOS/Cards/legacy.md", `---
infoos_managed: true
infoos_card_id: "legacy"
---

# Legacy full materialization
`);
    vault.binary.set(`InfoOS/Assets/${cardSegment}/legacy.mp4`, new ArrayBuffer(10));
    vault.binary.set("InfoOS/Assets/orphan/file.jpg", new ArrayBuffer(4));
    const before = vault.writes.length;

    const audit = await materializer.auditManagedTarget("InfoOS");

    expect(audit).toMatchObject({
      managedMarkdownCount: 2,
      convertibleToThinCount: 1,
      orphanAssetCount: 1,
      assets: {
        image: { count: 1, bytes: 4 },
        video: { count: 1, bytes: 10 }
      }
    });
    expect(vault.writes).toHaveLength(before);
    expect(vault.trashed).toEqual([]);
  });
});

class MemoryVault implements VaultWriteAdapter {
  readonly text = new Map<string, string>();
  readonly binary = new Map<string, ArrayBuffer>();
  readonly folders = new Set<string>();
  readonly writes: string[] = [];
  readonly trashed: Array<{ path: string; system: boolean }> = [];

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.text.has(path) || this.binary.has(path) || this.folders.has(path));
  }

  read(path: string): Promise<string> {
    const value = this.text.get(path);
    if (value == null) throw new Error(`missing ${path}`);
    return Promise.resolve(value);
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    const value = this.binary.get(path);
    if (value == null) throw new Error(`missing ${path}`);
    return Promise.resolve(value);
  }

  createFolder(path: string): Promise<void> {
    this.folders.add(path);
    return Promise.resolve();
  }

  writeText(path: string, content: string): Promise<void> {
    this.writes.push(path);
    this.text.set(path, content);
    return Promise.resolve();
  }

  writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.writes.push(path);
    this.binary.set(path, content);
    return Promise.resolve();
  }

  trash(path: string, system: true): Promise<void> {
    this.trashed.push({ path, system });
    this.binary.delete(path);
    return Promise.resolve();
  }

  listFiles(): Promise<VaultFileInfo[]> {
    return Promise.resolve([
      ...[...this.text.entries()].map(([path, value]) => ({
        path,
        size: new TextEncoder().encode(value).byteLength
      })),
      ...[...this.binary.entries()].map(([path, value]) => ({
        path,
        size: value.byteLength
      }))
    ]);
  }
}

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

function cardDetail(): InfoOSCardDetail {
  return {
    schema: "infoos.information-card.v1",
    card: {
      card_id: "card-1",
      card_type: "information",
      version: 1,
      content_hash: "hash-card-1",
      title: "完整卡片",
      source_platform: "rss",
      source_url: "https://example.com/post?tracking=removed",
      published_at: "2026-07-30T00:00:00Z",
      updated_at: "2026-07-30T01:00:00Z",
      status: "active",
      completeness_status: "complete",
      excerpt: "摘要",
      asset_summary: {
        image_count: 1,
        video_count: 1,
        audio_count: 0,
        other_count: 0
      },
      source_type: "rss",
      source_author: "作者",
      captured_at: "2026-07-30T01:00:00Z",
      missing_reasons: [],
      processor_version: "v1",
      raw_connector_id: null,
      raw_item_id: null,
      source_run_id: null
    },
    blocks: [{
      block_id: "block-1",
      position: 1,
      layer: "original",
      kind: "markdown",
      original_kind: "article",
      status: "ready",
      body: "第一段原始正文",
      segments: [],
      source_url: null,
      provenance: null
    }],
    assets: [{
      asset_id: "asset-1",
      kind: "image",
      mime_type: "image/png",
      size_bytes: 5,
      content_hash: "sha256:6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d",
      status: "ready",
      url: "/api/plugin/v1/assets/asset-1",
      title: "配图"
    }, {
      asset_id: "asset-video",
      kind: "video",
      mime_type: "video/mp4",
      size_bytes: 100,
      content_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "ready",
      url: "/api/plugin/v1/assets/asset-video",
      title: "视频",
      duration_seconds: 42,
      source_url: "https://video.example.com/watch?id=removed"
    }]
  };
}

function managedMarkdown(): string {
  return `---
infoos_managed: true
infoos_card_id: "card-1"
infoos_version: 1
infoos_content_hash: "hash-card-1"
infoos_materialization: "thin"
infoos_source_platform: "rss"
infoos_source_url: null
infoos_published_at: null
infoos_updated_at: "2026-07-30T01:00:00Z"
infoos_offline_assets: []
---

<!-- infoos:managed:start -->
body
<!-- infoos:managed:end -->
`;
}
