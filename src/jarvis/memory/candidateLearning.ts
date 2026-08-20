import { canonicalMemoryId } from '../../bot/memory/jarvis/ids';
import { isUntrustedMemorySource } from '../../bot/memory/jarvis/trust';
import type { JarvisMemoryStore } from '../../bot/memory/jarvis/store';
import type { EpisodeRecord, SemanticCandidate } from '../../bot/memory/jarvis/types';

export type EpisodeLearningDecision =
  | { significant: false; score: number; reason: string }
  | { significant: true; score: number; reason: string };

export function evaluateEpisodeSignificance(episode: EpisodeRecord): EpisodeLearningDecision {
  const payload = episode.payload || {};
  const untrusted = payload.untrustedResearch === true
    || isUntrustedMemorySource(episode.provenance.sourceSystem)
    || isUntrustedMemorySource(String(payload.sourceSystem || ''));
  const score = clamp01(episode.importance * (0.5 + 0.5 * episode.confidence));
  const completed = /success|completed|done/iu.test(String(payload.outcome || episode.eventType));
  if (untrusted) {
    return { significant: false, score, reason: 'untrusted_research' };
  }
  if (payload.trustedSemanticWrite === false && !completed) {
    return { significant: false, score, reason: 'episode_not_semantic' };
  }
  if (completed && score >= 0.35) {
    return { significant: true, score, reason: 'completed_task' };
  }
  if (score >= 0.7) {
    return { significant: true, score, reason: 'high_importance' };
  }
  return { significant: false, score, reason: 'below_threshold' };
}

export function proposeSemanticCandidateFromEpisode(episode: EpisodeRecord): {
  acceptForCandidate: boolean;
  reason: string;
  factKey?: string;
  value?: string;
  significance: number;
} {
  const decision = evaluateEpisodeSignificance(episode);
  if (!decision.significant) {
    return { acceptForCandidate: false, reason: decision.reason, significance: decision.score };
  }
  const proposed = proposedFactFromEpisode(episode);
  if (!proposed) {
    return { acceptForCandidate: false, reason: 'no_durable_fact', significance: decision.score };
  }
  return {
    acceptForCandidate: true,
    reason: decision.reason,
    factKey: proposed.factKey,
    value: proposed.value,
    significance: decision.score,
  };
}

export function writeSemanticCandidateFromEpisode(
  store: JarvisMemoryStore,
  episode: EpisodeRecord,
): SemanticCandidate | null {
  const proposed = proposeSemanticCandidateFromEpisode(episode);
  const now = Date.now();
  if (!proposed.acceptForCandidate || !proposed.factKey || !proposed.value) {
    if (proposed.reason === 'untrusted_research') {
      return store.putCandidate({
        id: canonicalMemoryId('candidate', `${parseLocal(episode.id)}_rejected`),
        episodeId: episode.id,
        factKey: proposed.factKey || 'research.claim',
        value: proposed.value || episode.summary,
        significance: proposed.significance,
        status: 'rejected',
        reason: 'untrusted_research',
        ownerTrusted: false,
        derived: true,
        sourceSystem: episode.provenance.sourceSystem,
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  }
  return store.putCandidate({
    id: canonicalMemoryId('candidate', `${parseLocal(episode.id)}_${proposed.factKey}`),
    episodeId: episode.id,
    factKey: proposed.factKey,
    value: proposed.value,
    significance: proposed.significance,
    status: 'candidate',
    reason: proposed.reason,
    ownerTrusted: false,
    derived: true,
    sourceSystem: episode.provenance.sourceSystem,
    createdAt: now,
    updatedAt: now,
  });
}

function proposedFactFromEpisode(episode: EpisodeRecord): { factKey: string; value: string } | null {
  const payload = episode.payload || {};
  const factKey = typeof payload.factKey === 'string' ? payload.factKey.trim() : '';
  const value = typeof payload.factValue === 'string'
    ? payload.factValue.trim()
    : typeof payload.value === 'string'
      ? payload.value.trim()
      : '';
  if (factKey && value) return { factKey, value };
  const learned = typeof payload.lesson === 'string' ? payload.lesson.trim() : '';
  if (learned && learned.length >= 8 && learned.length <= 180) {
    return { factKey: `procedure.${parseLocal(episode.id)}`, value: learned };
  }
  return null;
}

function parseLocal(id: string): string {
  const index = id.indexOf(':');
  return (index >= 0 ? id.slice(index + 1) : id).replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 80);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
