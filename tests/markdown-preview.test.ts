import { describe, expect, it } from "vitest";
import { createMarkdownPreview } from "../src/core/markdown-preview";

describe("createMarkdownPreview", () => {
  it("removes the duplicated primary heading while preserving native Markdown blocks", () => {
    const markdown = `# Markdown Rendering

The card uses Obsidian's native Markdown renderer.

> [!NOTE] Native callout
> This stays a real callout.

| Content | Expected |
|---|---|
| WikiLink | Native link |

## Later section

This should not enter the compact preview.`;

    expect(createMarkdownPreview(markdown, { maxBlocks: 3, maxCharacters: 800 })).toBe(`The card uses Obsidian's native Markdown renderer.

> [!NOTE] Native callout
> This stays a real callout.

| Content | Expected |
|---|---|
| WikiLink | Native link |`);
  });

  it("keeps a useful fallback for a long first paragraph", () => {
    const markdown = `# Title

${"Useful sentence. ".repeat(30)}`;

    const preview = createMarkdownPreview(markdown, { maxBlocks: 3, maxCharacters: 90 });

    expect(preview.startsWith("Useful sentence. Useful sentence.")).toBe(true);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(91);
  });
});
