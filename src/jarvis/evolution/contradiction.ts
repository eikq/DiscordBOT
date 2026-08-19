export type MemoryFact = {
  id: string;
  statement: string;
  confidence: number;
  kind: string;
};

export type ContradictionResolution = {
  action: 'keep_both_pending_review' | 'prefer_newer_if_same_kind' | 'reject_untrusted';
  reason: string;
};

export function resolveMemoryContradiction(
  existing: MemoryFact,
  incoming: MemoryFact,
  incomingActor: 'owner' | 'webpage' | 'model' | 'system',
): ContradictionResolution {
  if (incomingActor === 'webpage') {
    return {
      action: 'reject_untrusted',
      reason: 'Webpage content cannot overwrite trusted memory.',
    };
  }
  if (existing.kind !== incoming.kind) {
    return {
      action: 'keep_both_pending_review',
      reason: 'Different memory kinds stay separate until the owner reviews the contradiction.',
    };
  }
  return {
    action: 'keep_both_pending_review',
    reason: 'Contradicting memories are not auto-merged.',
  };
}
