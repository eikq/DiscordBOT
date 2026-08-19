/** Shared types for the /jarvis-lab knowledge graph (frontend view models). */

export type GraphNodeKind = 'entity' | 'fact' | 'episode' | 'observation' | 'artifact';

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  category: string;
  label: string;
  status: string;
  confidence: number;
  importance: number;
  privacyClass: string;
  firstSeen?: number;
  lastConfirmed?: number;
  degree: number;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
  kind: 'fact-subject' | 'relationship' | 'link' | 'evidence';
};

export type GraphSnapshot = {
  attached: boolean;
  reason?: string;
  generatedAt: number;
  counts: {
    entities: number;
    facts: number;
    episodes: number;
    observations: number;
    relationships: number;
    links: number;
  };
  truncated: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/**
 * Category colors (hex) — cyan→violet memory language, teal for devices,
 * restrained accents elsewhere. Keep in sync with jarvis-lab.css swatches.
 */
export const GRAPH_CATEGORY_COLORS: Record<string, string> = {
  person: '#7dd3fc',
  project: '#a78bfa',
  organization: '#c4b5fd',
  place: '#93c5fd',
  device: '#5eead4',
  other: '#67e8f9',
  fact: '#22d3ee',
  episode: '#8b5cf6',
  observation: '#3b82f6',
  artifact: '#e879f9',
};

export const GRAPH_EDGE_COLORS: Record<GraphEdge['kind'], string> = {
  'fact-subject': '#38bdf8',
  relationship: '#7dd3fc',
  link: '#a78bfa',
  evidence: '#2dd4bf',
};

export function graphCategoryColor(category: string): string {
  return GRAPH_CATEGORY_COLORS[category] || GRAPH_CATEGORY_COLORS.other;
}

export function graphCategoriesOf(nodes: GraphNode[]): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    counts.set(node.category, (counts.get(node.category) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}
