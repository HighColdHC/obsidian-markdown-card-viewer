export type FeedOrderOptions = {
  seed: number;
  pinnedPath?: string | null;
};

export function createFeedOrder(paths: string[], options: FeedOrderOptions): string[] {
  const pinned = options.pinnedPath && paths.includes(options.pinnedPath) ? options.pinnedPath : null;
  const shuffled = paths.filter((path) => path !== pinned);
  const random = seededRandom(options.seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return pinned ? [pinned, ...shuffled] : shuffled;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
