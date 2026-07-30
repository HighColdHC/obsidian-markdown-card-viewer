import { describe, expect, it } from "vitest";
import { validateInfoOSAssetRender } from "../src/ui/infoos-asset-validator";
import { InfoOSDownloadSession, mayCommitInfoOSDownload } from "../src/ui/infoos-download-control";

const source = JSON.stringify({ asset_id: "image-1", kind: "image", mode: "remote", mime_type: "image/jpeg", size_bytes: 12, content_hash: "hash" });
const context = {
  sourcePath: "InfoOS/Cards/card.md", scopeCurrent: true,
  frontmatter: { infoos_managed: true, infoos_card_id: "card" },
  entry: { markdownPath: "InfoOS/Cards/card.md", offlineAssets: {} }
};

describe("InfoOS asset render validator", () => {
  it("allows only a complete image placeholder tied to the current managed entry", () => {
    expect(validateInfoOSAssetRender(source, context)).toMatchObject({ allowed: true, cardId: "card" });
  });
  it("rejects unmanaged or mismatched Markdown before client work is possible", () => {
    expect(validateInfoOSAssetRender(source, { ...context, frontmatter: { infoos_card_id: "card" } })).toEqual(expect.objectContaining({ allowed: false }));
    expect(validateInfoOSAssetRender(source, { ...context, entry: { ...context.entry, markdownPath: "Clipper/note.md" } })).toEqual(expect.objectContaining({ allowed: false }));
    expect(validateInfoOSAssetRender('{"asset_id":"image-1"}', context)).toEqual(expect.objectContaining({ allowed: false }));
  });
  it("does not permit a post-transport commit after cancellation", () => {
    expect(mayCommitInfoOSDownload({ aborted: false })).toBe(true);
    expect(mayCommitInfoOSDownload({ aborted: true })).toBe(false);
  });
  it("closes cancellation before the first local commit write", () => {
    const cancelled = new InfoOSDownloadSession();
    expect(cancelled.cancel()).toBe(true);
    expect(cancelled.beginCommit()).toBe(false);
    expect(cancelled.signal.aborted).toBe(true);

    const committing = new InfoOSDownloadSession();
    expect(committing.beginCommit()).toBe(true);
    expect(committing.phase).toBe("committing");
    expect(committing.cancel()).toBe(false);
    expect(committing.signal.aborted).toBe(false);
    committing.complete();
    expect(committing.phase).toBe("complete");
  });
});
