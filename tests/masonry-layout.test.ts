import { describe, expect, it } from "vitest";
import { computeMasonryLayout } from "../src/core/masonry-layout";

describe("computeMasonryLayout", () => {
  it("places the next card beneath the shortest column using content heights", () => {
    const positions = computeMasonryLayout([
      { id: "A", height: 300 },
      { id: "B", height: 200 },
      { id: "C", height: 100 }
    ], { containerWidth: 720, preferredWidth: 320, gap: 16, columns: 2 });

    expect(positions).toEqual([
      { id: "A", x: 16, y: 16, width: 336, height: 300 },
      { id: "B", x: 368, y: 16, width: 336, height: 200 },
      { id: "C", x: 368, y: 232, width: 336, height: 100 }
    ]);
  });
});
