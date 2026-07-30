import type { GraphFile } from "./graph-model";

export type FrontmatterLink = GraphFile["frontmatterLinks"][number];

export function extractFrontmatterLinks(frontmatter: unknown): FrontmatterLink[] {
  const links: FrontmatterLink[] = [];
  const seen = new Set<string>();

  const visit = (value: unknown, field: string): void => {
    if (typeof value === "string") {
      for (const target of extractTargets(value)) {
        const key = `${field}\0${target}`;
        if (!seen.has(key)) {
          seen.add(key);
          links.push({ target, field });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, field);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, field ? `${field}.${key}` : key);
      }
    }
  };

  if (frontmatter && typeof frontmatter === "object") {
    for (const [key, value] of Object.entries(frontmatter as Record<string, unknown>)) {
      visit(value, key);
    }
  }
  return links;
}

function extractTargets(value: string): string[] {
  const targets: string[] = [];
  const pattern = /!?\[\[([^\]]+)\]\]/g;
  for (const match of value.matchAll(pattern)) {
    const raw = match[1];
    if (!raw) continue;
    const target = raw.split("|", 1)[0]?.split(/[\^#]/, 1)[0]?.trim();
    if (target) targets.push(target);
  }
  return targets;
}
