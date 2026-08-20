export type KnowledgeTtlClass = 'slow' | 'medium' | 'fast' | 'very_fast';

export function knowledgeTtlClass(topic: string): KnowledgeTtlClass {
  const hay = topic.toLowerCase();
  if (/price|stock|weather/u.test(hay)) return 'very_fast';
  if (/driver|version|release/u.test(hay)) return 'fast';
  if (/gpu spec|chipset|architecture|memory backend/u.test(hay)) return 'slow';
  return 'medium';
}

export function isStaleKnowledge(fetchedAt: string | null, topic: string, now = Date.now()): boolean {
  if (!fetchedAt) return true;
  const at = Date.parse(fetchedAt);
  if (!Number.isFinite(at)) return true;
  const cls = knowledgeTtlClass(topic);
  const ttl = cls === 'very_fast' ? 86_400_000 : cls === 'fast' ? 7 * 86_400_000 : cls === 'medium' ? 30 * 86_400_000 : 180 * 86_400_000;
  return now - at > ttl;
}
