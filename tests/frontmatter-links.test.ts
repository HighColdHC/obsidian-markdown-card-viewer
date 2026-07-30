import { describe, expect, it } from "vitest";
import { extractFrontmatterLinks } from "../src/core/frontmatter-links";

describe("extractFrontmatterLinks", () => {
  it("extracts nested WikiLinks with stable field paths and normalized targets", () => {
    expect(extractFrontmatterLinks({
      source: "[[Primary Source|来源]]",
      relations: {
        parent: "[[Parent#Section]]",
        related: ["plain", "[[First]] and ![[Second^block]]"]
      },
      count: 3
    })).toEqual([
      { target: "Primary Source", field: "source" },
      { target: "Parent", field: "relations.parent" },
      { target: "First", field: "relations.related" },
      { target: "Second", field: "relations.related" }
    ]);
  });
});
