import type { GraphModel } from "./graph-model";

export type GraphLayout = Record<string, [number, number]>;

type ComponentLayout = {
  positions: GraphLayout;
  width: number;
  height: number;
};

export function computeDeterministicGraphLayout(model: GraphModel): GraphLayout {
  const adjacency = buildAdjacency(model);
  const components = connectedComponents(model.nodes.map((node) => node.path), adjacency)
    .sort((left, right) => right.length - left.length || left[0]!.localeCompare(right[0]!));
  const result: GraphLayout = {};
  const shelfWidth = Math.max(1800, Math.ceil(Math.sqrt(model.nodes.length)) * 260);
  let cursorX = 200;
  let cursorY = 200;
  let rowHeight = 0;

  for (const component of components) {
    const local = component.length <= 80
      ? layoutLayeredComponent(component, adjacency)
      : layoutLargeComponent(component, adjacency);
    if (cursorX > 200 && cursorX + local.width > shelfWidth) {
      cursorX = 200;
      cursorY += rowHeight + 420;
      rowHeight = 0;
    }
    for (const [path, [x, y]] of Object.entries(local.positions)) {
      result[path] = [cursorX + x, cursorY + y];
    }
    cursorX += local.width + 620;
    rowHeight = Math.max(rowHeight, local.height);
  }
  return result;
}

function buildAdjacency(model: GraphModel): Map<string, Set<string>> {
  const adjacency = new Map(model.nodes.map((node) => [node.path, new Set<string>()]));
  for (const edge of model.edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  return adjacency;
}

function connectedComponents(paths: string[], adjacency: Map<string, Set<string>>): string[][] {
  const remaining = new Set(paths);
  const components: string[][] = [];
  for (const seed of [...paths].sort()) {
    if (!remaining.delete(seed)) continue;
    const component: string[] = [];
    const queue = [seed];
    for (let index = 0; index < queue.length; index += 1) {
      const path = queue[index]!;
      component.push(path);
      for (const neighbor of [...(adjacency.get(path) ?? [])].sort()) {
        if (!remaining.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    components.push(component.sort());
  }
  return components;
}

function layoutLayeredComponent(paths: string[], adjacency: Map<string, Set<string>>): ComponentLayout {
  const root = [...paths].sort((left, right) =>
    (adjacency.get(right)?.size ?? 0) - (adjacency.get(left)?.size ?? 0) || left.localeCompare(right)
  )[0]!;
  const levels = breadthFirstLevels(root, new Set(paths), adjacency);
  const positions: GraphLayout = {};
  let maximumRows = 1;
  for (let level = 0; level < levels.length; level += 1) {
    const entries = levels[level]!;
    maximumRows = Math.max(maximumRows, entries.length);
    for (let index = 0; index < entries.length; index += 1) {
      positions[entries[index]!] = [level * 260, (index - (entries.length - 1) / 2) * 130 + maximumRows * 65];
    }
  }
  return {
    positions,
    width: Math.max(190, (levels.length - 1) * 260 + 190),
    height: Math.max(100, maximumRows * 130)
  };
}

function layoutLargeComponent(paths: string[], adjacency: Map<string, Set<string>>): ComponentLayout {
  const root = [...paths].sort((left, right) =>
    (adjacency.get(right)?.size ?? 0) - (adjacency.get(left)?.size ?? 0) || left.localeCompare(right)
  )[0]!;
  const order = breadthFirstLevels(root, new Set(paths), adjacency).flat();
  const columns = Math.max(2, Math.ceil(Math.sqrt(order.length * 1.6)));
  const positions: GraphLayout = {};
  order.forEach((path, index) => {
    positions[path] = [(index % columns) * 230, Math.floor(index / columns) * 110];
  });
  return {
    positions,
    width: columns * 230,
    height: Math.ceil(order.length / columns) * 110
  };
}

function breadthFirstLevels(
  root: string,
  component: Set<string>,
  adjacency: Map<string, Set<string>>
): string[][] {
  const seen = new Set([root]);
  const levels: string[][] = [[root]];
  while (seen.size < component.size) {
    const previous = levels.at(-1) ?? [];
    const next = new Set<string>();
    for (const path of previous) {
      for (const neighbor of adjacency.get(path) ?? []) {
        if (component.has(neighbor) && !seen.has(neighbor)) next.add(neighbor);
      }
    }
    if (next.size === 0) {
      const fallback = [...component].filter((path) => !seen.has(path)).sort()[0];
      if (!fallback) break;
      next.add(fallback);
    }
    const sorted = [...next].sort();
    sorted.forEach((path) => seen.add(path));
    levels.push(sorted);
  }
  return levels;
}
