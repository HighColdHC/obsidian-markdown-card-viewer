---
type: capability
parent: "[[00 - Plugin Boundary]]"
related: "[[06 - Media Card]]"
---

# Markdown Rendering

The card uses Obsidian's native Markdown renderer.

## Content matrix

| Content | Expected |
|---|---|
| WikiLink | Opens inside the card viewer |
| Callout | Uses the active Obsidian theme |
| Task | Visible but disabled |
| Image | Resolves relative to this file |

> [!NOTE] Native callout
> This callout must use Obsidian's active theme and remain read-only.

- [ ] This checkbox must remain read-only
- [x] Completed tasks must also remain read-only

```ts
MarkdownRenderer.render(app, source, container, sourcePath, component);
```

See [[06 - Media Card]] and [[Subfolder/04 - Long Note]].
