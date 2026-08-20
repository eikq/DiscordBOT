export type RetrievalItem = {
  id: string;
  text: string;
  personId?: string;
  projectId?: string;
  confidence: number;
  importance: number;
  recencyMs: number;
  stale?: boolean;
  superseded?: boolean;
};

export type RetrievalMetrics = {
  returned: number;
  relevant: number;
  duplicates: number;
  stale: number;
  wrongPerson: number;
  wrongProject: number;
  precision: number;
};

export function rankRetrieval(items: RetrievalItem[], query: {
  text: string;
  personId?: string;
  projectId?: string;
  limit?: number;
}): RetrievalItem[] {
  const tokens = query.text.toLowerCase().split(/\s+/u).filter(Boolean);
  const scored = items
    .filter(item => !item.superseded)
    .map(item => {
      const hay = item.text.toLowerCase();
      const overlap = tokens.filter(token => hay.includes(token)).length;
      const recency = 1 / (1 + item.recencyMs / (7 * 24 * 60 * 60_000));
      const stalePenalty = item.stale ? 0.35 : 1;
      const personPenalty = query.personId && item.personId && item.personId !== query.personId ? 0.1 : 1;
      const projectPenalty = query.projectId && item.projectId && item.projectId !== query.projectId ? 0.15 : 1;
      const score = (overlap + 0.2) * item.confidence * item.importance * recency * stalePenalty * personPenalty * projectPenalty;
      return { item, score };
    })
    .sort((left, right) => right.score - left.score);
  const seen = new Set<string>();
  const out: RetrievalItem[] = [];
  for (const { item } of scored) {
    const key = item.text.toLowerCase().replace(/\s+/gu, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= (query.limit ?? 8)) break;
  }
  return out;
}

export function measureRetrieval(returned: RetrievalItem[], goldIds: string[], query: {
  personId?: string;
  projectId?: string;
}): RetrievalMetrics {
  const gold = new Set(goldIds);
  const relevant = returned.filter(item => gold.has(item.id)).length;
  const texts = returned.map(item => item.text.toLowerCase());
  const duplicates = texts.length - new Set(texts).size;
  const stale = returned.filter(item => item.stale).length;
  const wrongPerson = returned.filter(item => query.personId && item.personId && item.personId !== query.personId).length;
  const wrongProject = returned.filter(item => query.projectId && item.projectId && item.projectId !== query.projectId).length;
  return {
    returned: returned.length,
    relevant,
    duplicates,
    stale,
    wrongPerson,
    wrongProject,
    precision: returned.length === 0 ? 0 : relevant / returned.length,
  };
}
