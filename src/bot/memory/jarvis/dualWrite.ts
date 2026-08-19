import type { SocialBrainObservation, SocialBrainPerson, SocialBrainRelationship } from '../SocialMemoryBrain';
import { canonicalMemoryId } from './ids';
import { projectFact, projectObservation, projectPersonEntity, projectRelationship } from './socialProjection';
import type { JarvisMemoryStore } from './store';

export function mirrorSocialPerson(
  store: JarvisMemoryStore,
  person: SocialBrainPerson,
): void {
  store.putEntity(projectPersonEntity(person));
  for (const alias of person.aliases) {
    store.putAlias(projectPersonEntity(person).id, alias, 0.9);
  }
  const facts = [...person.facts].sort((left, right) => {
    if (left.status === right.status) return 0;
    return left.status === 'superseded' ? -1 : 1;
  });
  for (const fact of facts) {
    const projected = projectFact(person, fact);
    const nextExists = !projected.supersededBy || Boolean(store.getFact(projected.supersededBy));
    store.putFact({
      ...projected,
      supersededBy: nextExists ? projected.supersededBy : undefined,
    }, { allowConflict: true });
  }
  for (const fact of person.facts) {
    const projected = projectFact(person, fact);
    if (projected.supersededBy && store.getFact(projected.supersededBy)) {
      store.putFact(projected, { allowConflict: true });
    }
  }
}

export function mirrorSocialObservation(
  store: JarvisMemoryStore,
  observation: SocialBrainObservation,
): void {
  store.putObservation(projectObservation(observation));
}

export function mirrorSocialRelationship(
  store: JarvisMemoryStore,
  relationship: SocialBrainRelationship,
): void {
  const [left, right] = [...relationship.userIds].sort();
  if (!store.getEntity(canonicalMemoryId('entity', left)) || !store.getEntity(canonicalMemoryId('entity', right))) {
    return;
  }
  store.putRelationship(projectRelationship(relationship));
}

export function mirrorSocialSnapshot(
  store: JarvisMemoryStore,
  snapshot: {
    people: SocialBrainPerson[];
    relationships: SocialBrainRelationship[];
    recentObservations: SocialBrainObservation[];
  },
): void {
  for (const person of snapshot.people) mirrorSocialPerson(store, person);
  for (const observation of snapshot.recentObservations) mirrorSocialObservation(store, observation);
  for (const relationship of snapshot.relationships) mirrorSocialRelationship(store, relationship);
}
