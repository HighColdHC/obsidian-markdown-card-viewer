export type MarkdownPreviewOptions = {
  maxBlocks?: number;
  maxCharacters?: number;
};

export function createMarkdownPreview(markdown: string, options: MarkdownPreviewOptions = {}): string {
  const maxBlocks = options.maxBlocks ?? 4;
  const maxCharacters = options.maxCharacters ?? 720;
  const blocks = splitMarkdownBlocks(markdown.trim());
  if (blocks[0] && /^#\s+\S/.test(blocks[0])) blocks.shift();

  const selected: string[] = [];
  for (const block of blocks) {
    if (selected.length >= maxBlocks) break;
    const candidate = [...selected, block].join("\n\n");
    if (candidate.length <= maxCharacters) {
      selected.push(block);
      continue;
    }
    if (selected.length === 0) return truncate(block, maxCharacters);
    break;
  }
  return selected.join("\n\n");
}

function splitMarkdownBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  const flush = (): void => {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^\s*(```+|~~~+)/)?.[1] ?? null;
    if (marker) fence = fence ? null : marker;
    if (!fence && line.trim().length === 0) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}
