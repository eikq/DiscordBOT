import { canonicalMemoryId } from '../../bot/memory/jarvis/ids';
import { defaultRetention } from '../../bot/memory/jarvis/semantics';
import type { JarvisMemoryStore } from '../../bot/memory/jarvis/store';
import type { EpisodeRecord } from '../../bot/memory/jarvis/types';
import type { ExperienceRecord } from '../evolution/types';
import type { WorkTask } from '../agent/types';

export function experienceEpisodeId(taskId: string): string {
  return canonicalMemoryId('episode', `task_${taskId.replace(/^task_/u, '')}`);
}

export function writeExperienceEpisode(
  store: JarvisMemoryStore,
  experience: ExperienceRecord,
  task?: WorkTask,
): EpisodeRecord {
  const now = Date.parse(experience.createdAt) || Date.now();
  const untrusted = (task?.evidence ?? []).some(item => item.startsWith('untrusted:'))
    || experience.tools.some(tool => tool.startsWith('research.'));
  return store.putEpisode({
    id: experienceEpisodeId(task?.id || experience.id),
    kind: 'episode',
    status: 'active',
    privacyClass: experience.privacyClass === 'sensitive' ? 'sensitive' : 'private',
    confidence: untrusted ? Math.min(experience.confidence, 0.35) : experience.confidence,
    importance: experience.significance ?? 0.5,
    provenance: {
      sourceSystem: 'jarvis.experience',
      sourceRecordId: experience.id,
      evidenceIds: experience.evidenceRefs ?? [],
      firstSeen: now,
      lastConfirmed: now,
      confirmations: 1,
    },
    retention: defaultRetention('short_lived', now),
    occurredAt: now,
    source: 'jarvis.work',
    eventType: `task_${experience.outcome}`,
    summary: `${experience.goal}: ${experience.result}`.slice(0, 240),
    payload: {
      experienceId: experience.id,
      outcome: experience.outcome,
      tools: experience.tools,
      untrustedResearch: untrusted,
      trustedSemanticWrite: false,
    },
  });
}

export function researchTextIsUntrustedMemory(_text: string): true {
  return true;
}
