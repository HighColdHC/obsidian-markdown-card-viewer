export type MasonryItem = {
  id: string;
  height: number;
};

export type MasonryLayoutOptions = {
  containerWidth: number;
  preferredWidth: number;
  gap: number;
  columns: number;
};

export type MasonryPosition = MasonryItem & {
  x: number;
  y: number;
  width: number;
};

export function computeMasonryLayout(items: MasonryItem[], options: MasonryLayoutOptions): MasonryPosition[] {
  const columns = options.columns > 0
    ? options.columns
    : Math.max(1, Math.floor((options.containerWidth - options.gap) / (options.preferredWidth + options.gap)));
  const width = Math.max(220, (options.containerWidth - options.gap * (columns + 1)) / columns);
  const heights = Array.from({ length: columns }, () => options.gap);
  return items.map((item) => {
    const column = indexOfMinimum(heights);
    const position = {
      ...item,
      x: options.gap + column * (width + options.gap),
      y: heights[column] ?? options.gap,
      width
    };
    heights[column] = position.y + position.height + options.gap;
    return position;
  });
}

function indexOfMinimum(values: number[]): number {
  let index = 0;
  for (let cursor = 1; cursor < values.length; cursor += 1) {
    if ((values[cursor] ?? Infinity) < (values[index] ?? Infinity)) index = cursor;
  }
  return index;
}
