export type ContextEvidence = {
  contextSource?: 'working-memory' | 'owner-semantic-memory' | 'workspace-registry' | 'resource-catalog' | 'research-session';
  resolvedReferent?: string;
  aliasSource?: string;
  resourceAuthority?: string;
};

export function formatContextEvidence(evidence: ContextEvidence | undefined): string {
  if (!evidence) return '';
  return [
    evidence.contextSource ? `context source: ${evidence.contextSource}` : '',
    evidence.resolvedReferent ? `resolved referent: ${evidence.resolvedReferent}` : '',
    evidence.aliasSource ? `alias source: ${evidence.aliasSource}` : '',
    evidence.resourceAuthority ? `resource authority: ${evidence.resourceAuthority}` : '',
  ].filter(Boolean).join(' · ');
}
