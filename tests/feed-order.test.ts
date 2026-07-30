import { describe, expect, it } from "vitest";
import { createFeedOrder } from "../src/core/feed-order";

describe("createFeedOrder", () => {
  it("keeps the current card first and randomizes the remaining cards reproducibly", () => {
    const files = ["A.md", "B.md", "C.md", "D.md", "E.md", "F.md", "G.md", "H.md"];

    const first = createFeedOrder(files, { seed: 42, pinnedPath: "C.md" });
    const repeated = createFeedOrder(files, { seed: 42, pinnedPath: "C.md" });
    const reshuffled = createFeedOrder(files, { seed: 43, pinnedPath: "C.md" });

    expect(first[0]).toBe("C.md");
    expect(new Set(first)).toEqual(new Set(files));
    expect(repeated).toEqual(first);
    expect(reshuffled).not.toEqual(first);
    expect(files).toEqual(["A.md", "B.md", "C.md", "D.md", "E.md", "F.md", "G.md", "H.md"]);
  });

  it("does not invent a pinned card outside the viewing scope", () => {
    expect(createFeedOrder(["A.md", "B.md"], { seed: 9, pinnedPath: "Outside.md" }).sort()).toEqual(["A.md", "B.md"]);
  });
});
