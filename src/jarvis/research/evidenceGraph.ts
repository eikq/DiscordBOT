import type { EvidenceRecord, SourceRecord } from './types';

export type EvidenceGraphNode =
  | { id: string; kind: 'claim'; label: string }
  | { id: string; kind: 'evidence'; label: string; support: 'support' | 'contradiction' | 'duplicate' }
  | { id: string; kind: 'source'; label: string; domain: string };

export type EvidenceGraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: 'supported_by' | 'from_source';
};

export type EvidenceGraph = {
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
};

export function buildEvidenceGraph(sources: SourceRecord[], evidence: EvidenceRecord[]): EvidenceGraph {
  const nodes: EvidenceGraphNode[] = [];
  const edges: EvidenceGraphEdge[] = [];
  const sourceIds = new Set(sources.map(item => item.sourceId));
  for (const source of sources) {
    nodes.push({ id: source.sourceId, kind: 'source', label: source.domain, domain: source.domain });
  }
  for (const item of evidence) {
    const claimId = `claim_${hash(item.claim)}`;
    if (!nodes.some(node => node.id === claimId)) {
      nodes.push({ id: claimId, kind: 'claim', label: item.claim.slice(0, 80) });
    }
    nodes.push({
      id: item.evidenceId,
      kind: 'evidence',
      label: item.excerpt.slice(0, 80),
      support: item.kind === 'CONFLICTING' ? 'contradiction' : item.kind === 'INFERENCE' ? 'duplicate' : 'support',
    });
    edges.push({ id: `e_${claimId}_${item.evidenceId}`, source: claimId, target: item.evidenceId, relation: 'supported_by' });
    if (sourceIds.has(item.sourceId)) {
      edges.push({ id: `e_${item.evidenceId}_${item.sourceId}`, source: item.evidenceId, target: item.sourceId, relation: 'from_source' });
    }
  }
  return { nodes, edges };
}

function hash(value: string): string {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) total = (total + value.charCodeAt(i) * (i + 1)) % 1_000_003;
  return total.toString(16);
}
