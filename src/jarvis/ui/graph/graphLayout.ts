import type { GraphEdge, GraphNode } from './graphTypes';

/**
 * Deterministic 3D layout for the memory graph.
 * Categories claim directions on an outer sphere; members spread on a
 * fibonacci sphere around their cluster centre. Pure and side-effect free so
 * it can be memoised and unit-tested without WebGL.
 */

export type GraphLayout = {
  positions: Map<string, [number, number, number]>;
  clusterCenters: Map<string, [number, number, number]>;
  radius: number;
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

function fibonacciDirection(index: number, total: number): [number, number, number] {
  const y = total <= 1 ? 0 : 1 - (index / (total - 1)) * 2;
  const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * index;
  return [Math.cos(theta) * radiusAtY, y, Math.sin(theta) * radiusAtY];
}

/** Tight halo for sparse real graphs; wider field only when many nodes exist. */
export function haloRadiusForCount(count: number): number {
  if (count <= 4) return 15;
  if (count <= 12) return 18;
  return 26;
}

export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], options: {
  clusterRadius?: number;
} = {}): GraphLayout {
  const clusterRadius = options.clusterRadius ?? haloRadiusForCount(nodes.length);
  const positions = new Map<string, [number, number, number]>();
  const clusterCenters = new Map<string, [number, number, number]>();
  if (nodes.length === 0) {
    return { positions, clusterCenters, radius: clusterRadius };
  }

  // Sparse real graphs: place the few true nodes as intentional satellites
  // with depth, not as a tiny random scatter field. Does not invent edges.
  if (nodes.length <= 4) {
    const satellites: Array<[number, number, number]> = [
      [1.00, 0.26, 0.34],
      [-0.58, -0.22, 0.82],
      [0.46, 0.54, -0.72],
      [-0.84, 0.32, -0.40],
    ];
    const ordered = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
    ordered.forEach((node, index) => {
      const direction = satellites[index] || satellites[0];
      const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
      positions.set(node.id, [
        (direction[0] / length) * clusterRadius,
        (direction[1] / length) * clusterRadius,
        (direction[2] / length) * clusterRadius,
      ]);
    });
    return { positions, clusterCenters, radius: clusterRadius };
  }

  const byCategory = new Map<string, GraphNode[]>();
  for (const node of [...nodes].sort((left, right) => left.id.localeCompare(right.id))) {
    const list = byCategory.get(node.category) || [];
    list.push(node);
    byCategory.set(node.category, list);
  }
  const categories = [...byCategory.keys()].sort();

  categories.forEach((category, categoryIndex) => {
    const members = byCategory.get(category)!;
    // Clusters sit on a horizontal band around the core (never at the poles),
    // so real edges between clusters do not cut straight through the nucleus.
    const azimuth = GOLDEN_ANGLE * 2 * categoryIndex + hashSeed(category) * 0.8;
    const bandY = (categoryIndex % 2 === 0 ? 1 : -1) * (0.14 + 0.11 * (Math.floor(categoryIndex / 2) % 3));
    const jitter = hashSeed(category) * 0.5 - 0.25;
    const center: [number, number, number] = [
      Math.cos(azimuth) * clusterRadius * (1 + jitter * 0.12),
      bandY * clusterRadius,
      Math.sin(azimuth) * clusterRadius * (1 + jitter * 0.12),
    ];
    clusterCenters.set(category, center);

    const spread = 5.5 + Math.sqrt(members.length) * 2.4;
    members.forEach((node, memberIndex) => {
      const local = fibonacciDirection(memberIndex, Math.max(members.length, 2));
      const seed = hashSeed(node.id);
      // Higher-degree nodes sit closer to the cluster centre.
      const degreePull = Math.min(0.55, node.degree * 0.08);
      const localRadius = spread * (0.45 + seed * 0.55) * (1 - degreePull);
      positions.set(node.id, [
        center[0] + local[0] * localRadius,
        center[1] + local[1] * localRadius * 0.85,
        center[2] + local[2] * localRadius,
      ]);
    });
  });

  // Keep referenced-but-unclustered ids from breaking the renderer.
  for (const edge of edges) {
    for (const id of [edge.source, edge.target]) {
      if (!positions.has(id)) {
        const seed = hashSeed(id);
        const dir = fibonacciDirection(Math.floor(seed * 97), 97);
        positions.set(id, [dir[0] * clusterRadius, dir[1] * clusterRadius * 0.6, dir[2] * clusterRadius]);
      }
    }
  }

  return { positions, clusterCenters, radius: clusterRadius };
}

/** Breadth-first shortest path over the undirected edge list. */
export function shortestGraphPath(
  edges: GraphEdge[],
  fromId: string,
  toId: string,
  maxDepth = 8,
): string[] | null {
  if (!fromId || !toId) return null;
  if (fromId === toId) return [fromId];
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source)!.push(edge.target);
    adjacency.get(edge.target)!.push(edge.source);
  }
  if (!adjacency.has(fromId) || !adjacency.has(toId)) return null;
  const previous = new Map<string, string>();
  const visited = new Set([fromId]);
  let frontier = [fromId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const neighbor of adjacency.get(current) || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        previous.set(neighbor, current);
        if (neighbor === toId) {
          const path = [toId];
          let cursor = toId;
          while (cursor !== fromId) {
            cursor = previous.get(cursor)!;
            path.push(cursor);
          }
          return path.reverse();
        }
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return null;
}

/** Edge ids along a node path (for highlight). */
export function edgesOnPath(edges: GraphEdge[], path: string[] | null): Set<string> {
  const found = new Set<string>();
  if (!path || path.length < 2) return found;
  for (let index = 0; index < path.length - 1; index += 1) {
    const a = path[index];
    const b = path[index + 1];
    for (const edge of edges) {
      if ((edge.source === a && edge.target === b) || (edge.source === b && edge.target === a)) {
        found.add(edge.id);
      }
    }
  }
  return found;
}
