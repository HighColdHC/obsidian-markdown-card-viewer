import { describe, expect, it } from "vitest";
import { computeDeterministicGraphLayout } from "../src/core/graph-layout";
import type { GraphModel } from "../src/core/graph-model";

const graph: GraphModel = {
  nodes: [
    { id: "A.md", path: "A.md", title: "A", folder: "", kind: "internal", ctime: 1, excerpt: "" },
    { id: "B.md", path: "B.md", title: "B", folder: "", kind: "internal", ctime: 2, excerpt: "" },
    { id: "C.md", path: "C.md", title: "C", folder: "", kind: "internal", ctime: 3, excerpt: "" },
    { id: "Outside.md", path: "Outside.md", title: "Outside", folder: "", kind: "external", ctime: 4, excerpt: "" }
  ],
  edges: [
    { id: "A.md->B.md", source: "A.md", target: "B.md", origins: ["body"], relationTypes: [] },
    { id: "B.md->Outside.md", source: "B.md", target: "Outside.md", origins: ["frontmatter"], relationTypes: ["source"] }
  ]
};

describe("computeDeterministicGraphLayout", () => {
  it("keeps linked nodes in the same compact component and isolated nodes separate", () => {
    const first = computeDeterministicGraphLayout(graph);
    const second = computeDeterministicGraphLayout(graph);

    expect(second).toEqual(first);
    expect(distance(first["A.md"], first["B.md"])).toBeLessThan(500);
    expect(distance(first["B.md"], first["Outside.md"])).toBeLessThan(500);
    expect(distance(first["A.md"], first["C.md"])).toBeGreaterThan(500);
  });
});

function distance(left: [number, number], right: [number, number]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}
