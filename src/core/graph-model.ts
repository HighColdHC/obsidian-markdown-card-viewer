export type GraphFile = {
  path: string;
  title: string;
  folder: string;
  ctime: number;
  excerpt: string;
  bodyLinks: string[];
  frontmatterLinks: Array<{ target: string; field: string }>;
};

export type GraphNodeKind = "internal" | "external" | "missing";

export type GraphNode = {
  id: string;
  path: string;
  title: string;
  folder: string;
  kind: GraphNodeKind;
  ctime: number;
  excerpt: string;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  origins: Array<"body" | "frontmatter">;
  relationTypes: string[];
};

export type GraphModel = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type LinkResolver = (target: string, sourcePath: string) => string | null;

export function buildGraphModel(
  scopeFolder: string,
  files: GraphFile[],
  resolveLink: LinkResolver
): GraphModel {
  const normalizedScope = scopeFolder.replace(/^\/+|\/+$/g, "");
  const inScope = (filePath: string): boolean => {
    if (normalizedScope.length === 0) return true;
    return filePath.startsWith(`${normalizedScope}/`);
  };

  const byPath = new Map(files.map((file) => [file.path, file]));
  const internalFiles = files.filter((file) => inScope(file.path));
  const nodes: GraphNode[] = internalFiles.map((file) => toNode(file, "internal"));
  const addedNodes = new Set(nodes.map((node) => node.id));
  const extraNodes: GraphNode[] = [];
  const edgeMap = new Map<string, GraphEdge>();

  const addTargetNode = (rawTarget: string, sourcePath: string): string => {
    const resolvedPath = resolveLink(rawTarget, sourcePath);
    if (resolvedPath) {
      if (!addedNodes.has(resolvedPath)) {
        const file = byPath.get(resolvedPath);
        extraNodes.push(file ? toNode(file, "external") : {
          id: resolvedPath,
          path: resolvedPath,
          title: basenameWithoutExtension(resolvedPath),
          folder: dirname(resolvedPath),
          kind: "external",
          ctime: 0,
          excerpt: ""
        });
        addedNodes.add(resolvedPath);
      }
      return resolvedPath;
    }

    if (!addedNodes.has(rawTarget)) {
      extraNodes.push({
        id: rawTarget,
        path: rawTarget,
        title: basenameWithoutExtension(rawTarget),
        folder: "",
        kind: "missing",
        ctime: 0,
        excerpt: ""
      });
      addedNodes.add(rawTarget);
    }
    return rawTarget;
  };

  const addEdge = (
    source: string,
    rawTarget: string,
    origin: "body" | "frontmatter",
    relationType?: string
  ): void => {
    const target = addTargetNode(rawTarget, source);
    const id = `${source}->${target}`;
    const existing = edgeMap.get(id);
    if (existing) {
      if (!existing.origins.includes(origin)) existing.origins.push(origin);
      if (relationType && !existing.relationTypes.includes(relationType)) {
        existing.relationTypes.push(relationType);
      }
      return;
    }
    edgeMap.set(id, {
      id,
      source,
      target,
      origins: [origin],
      relationTypes: relationType ? [relationType] : []
    });
  };

  for (const file of internalFiles) {
    for (const target of file.bodyLinks) addEdge(file.path, target, "body");
    for (const link of file.frontmatterLinks) {
      addEdge(file.path, link.target, "frontmatter", link.field);
    }
  }

  return { nodes: [...nodes, ...extraNodes], edges: [...edgeMap.values()] };
}

function toNode(file: GraphFile, kind: GraphNodeKind): GraphNode {
  return {
    id: file.path,
    path: file.path,
    title: file.title,
    folder: file.folder,
    kind,
    ctime: file.ctime,
    excerpt: file.excerpt
  };
}

function basenameWithoutExtension(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.md$/i, "");
}

function dirname(filePath: string): string {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/");
}
