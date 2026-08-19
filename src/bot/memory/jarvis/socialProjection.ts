import type { SocialBrainFact, SocialBrainObservation, SocialBrainPerson, SocialBrainRelationship } from '../SocialMemoryBrain';
import { canonicalMemoryId } from './ids';
import { defaultRetention } from './semantics';
import { EntityRecord, ObservationRecord, RelationshipRecord, SemanticFactRecord } from './types';

const SOURCE_SYSTEM = 'social_memory_brain';

export function projectPersonEntity(person: SocialBrainPerson): EntityRecord {
  const now = person.lastSeen || Date.now();
  return {
    id: canonicalMemoryId('entity', person.userId),
    kind: 'entity',
    entityType: 'person',
    displayName: person.displayNames[0] || person.userId,
    discordUserId: person.userId,
    status: 'active',
    privacyClass: 'private',
    confidence: 1,
    importance: 0.7,
    provenance: {
      sourceSystem: SOURCE_SYSTEM,
      sourceRecordId: person.userId,
      evidenceIds: [],
      firstSeen: person.firstSeen,
      lastConfirmed: now,
      confirmations: person.utteranceCount,
    },
    retention: defaultRetention('long_lived', now),
  };
}

export function projectObservation(observation: SocialBrainObservation): ObservationRecord {
  return {
    id: canonicalMemoryId('observation', observation.id),
    kind: 'observation',
    occurredAt: observation.timestamp,
    source: 'discord',
    eventType: 'transcript.final',
    text: observation.text,
    actorEntityId: canonicalMemoryId('entity', observation.speakerUserId),
    guildId: observation.guildId,
    sessionId: observation.sessionId,
    payload: {
      games: observation.games,
      activities: observation.activities,
      mentionedUserIds: observation.mentionedUserIds,
    },
    status: 'active',
    privacyClass: 'private',
    confidence: observation.transcriptConfidence,
    importance: 0.4,
    provenance: {
      sourceSystem: SOURCE_SYSTEM,
      sourceRecordId: observation.id,
      evidenceIds: [observation.id],
      firstSeen: observation.timestamp,
      lastConfirmed: observation.timestamp,
      confirmations: 1,
    },
    retention: defaultRetention('audit', observation.timestamp),
  };
}

export function projectFact(person: SocialBrainPerson, fact: SocialBrainFact): SemanticFactRecord {
  return {
    id: canonicalMemoryId('fact', fact.id),
    kind: 'fact',
    subjectEntityId: canonicalMemoryId('entity', person.userId),
    predicate: fact.key || 'statement',
    objectValue: fact.text,
    factKey: fact.key || `statement:${fact.text.toLocaleLowerCase()}`,
    polarity: fact.polarity || 'statement',
    status: fact.status === 'superseded' ? 'superseded' : 'active',
    privacyClass: 'private',
    confidence: fact.confidence,
    importance: Math.min(0.95, 0.4 + fact.confirmations * 0.08),
    supersededBy: fact.supersededBy ? canonicalMemoryId('fact', fact.supersededBy) : undefined,
    provenance: {
      sourceSystem: SOURCE_SYSTEM,
      sourceRecordId: fact.id,
      evidenceIds: fact.evidenceIds?.length ? fact.evidenceIds : [fact.evidenceId],
      firstSeen: fact.observedAt,
      lastConfirmed: fact.lastObservedAt,
      confirmations: fact.confirmations,
    },
    retention: defaultRetention('long_lived', fact.lastObservedAt),
  };
}

export function projectRelationship(relationship: SocialBrainRelationship): RelationshipRecord {
  const [left, right] = [...relationship.userIds].sort();
  return {
    id: canonicalMemoryId('relationship', `${left}:${right}`),
    kind: 'relationship',
    leftEntityId: canonicalMemoryId('entity', left),
    rightEntityId: canonicalMemoryId('entity', right),
    interactionCount: relationship.interactionCount,
    lastInteractionAt: relationship.lastInteractionAt,
    addressTerms: { ...relationship.addressTerms },
    status: 'active',
    privacyClass: 'private',
    confidence: 0.8,
    importance: 0.6,
    provenance: {
      sourceSystem: SOURCE_SYSTEM,
      sourceRecordId: relationship.id,
      evidenceIds: relationship.evidenceIds,
      firstSeen: relationship.lastInteractionAt,
      lastConfirmed: relationship.lastInteractionAt,
      confirmations: relationship.interactionCount,
    },
    retention: defaultRetention('long_lived', relationship.lastInteractionAt),
  };
}
