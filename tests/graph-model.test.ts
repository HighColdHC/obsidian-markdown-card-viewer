import { describe, expect, it } from "vitest";
import { buildGraphModel, type GraphFile } from "../src/core/graph-model";

const files: GraphFile[] = [
  {
    path: "Project/Overview.md",
    title: "Overview",
    folder: "Project",
    ctime: 1,
    excerpt: "Project overview",
    bodyLinks: ["Details", "Details", "Outside", "Missing"],
    frontmatterLinks: [
      { target: "Details", field: "related" },
      { target: "Outside", field: "source.primary" }
    ]
  },
  {
    path: "Project/Sub/Details.md",
    title: "Details",
    folder: "Project/Sub",
    ctime: 2,
    excerpt: "Detail note",
    bodyLinks: [],
    frontmatterLinks: []
  },
  {
    path: "Project/Isolated.md",
    title: "Isolated",
    folder: "Project",
    ctime: 3,
    excerpt: "No links",
    bodyLinks: [],
    frontmatterLinks: []
  },
  {
    path: "Other/Outside.md",
    title: "Outside",
    folder: "Other",
    ctime: 4,
    excerpt: "One-hop context",
    bodyLinks: ["AnotherOutside"],
    frontmatterLinks: []
  }
];

const destinations: Record<string, string> = {
  Details: "Project/Sub/Details.md",
  Outside: "Other/Outside.md"
};

describe("buildGraphModel", () => {
  it("builds recursive internal nodes, one-hop external nodes, missing nodes, and merged directed edges", () => {
    const graph = buildGraphModel("Project", files, (target) => destinations[target] ?? null);

    expect(graph.nodes.map(({ path, kind }) => ({ path, kind }))).toEqual([
      { path: "Project/Overview.md", kind: "internal" },
      { path: "Project/Sub/Details.md", kind: "internal" },
      { path: "Project/Isolated.md", kind: "internal" },
      { path: "Other/Outside.md", kind: "external" },
      { path: "Missing", kind: "missing" }
    ]);

    expect(graph.edges).toEqual([
      {
        id: "Project/Overview.md->Project/Sub/Details.md",
        source: "Project/Overview.md",
        target: "Project/Sub/Details.md",
        origins: ["body", "frontmatter"],
        relationTypes: ["related"]
      },
      {
        id: "Project/Overview.md->Other/Outside.md",
        source: "Project/Overview.md",
        target: "Other/Outside.md",
        origins: ["body", "frontmatter"],
        relationTypes: ["source.primary"]
      },
      {
        id: "Project/Overview.md->Missing",
        source: "Project/Overview.md",
        target: "Missing",
        origins: ["body"],
        relationTypes: []
      }
    ]);
  });
});
