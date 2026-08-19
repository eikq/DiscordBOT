import crypto from 'node:crypto';
import { MAX_EXCERPT_CHARS } from './constants';
import { firstParagraphs, webpageTextAsData } from './htmlText';
import type { EvidenceKind, EvidenceRecord, SourceRecord } from './types';

const INJECTION_CUES = [
  'ignore previous',
  'ignore system',
  'run powershell',
  'open localhost',
  'read .env',
  'create a reminder',
  'desktop.openapplication',
  'use capability',
];

export function extractEvidence(source: SourceRecord, bodyText: string, query: string): EvidenceRecord[] {
  const clean = firstParagraphs(bodyText, 1_200);
  const sentences = clean.split(/(?<=[.!?。])\s+/u).map(item => webpageTextAsData(item, MAX_EXCERPT_CHARS)).filter(item => item.length > 40);
  const tokens = query.toLowerCase().split(/\s+/u).filter(token => token.length > 2);
  const picked = sentences
    .map(sentence => ({ sentence, score: tokens.reduce((sum, token) => sum + (sentence.toLowerCase().includes(token) ? 1 : 0), 0) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(item => item.sentence);
  const excerpts = picked.length > 0 ? picked : [webpageTextAsData(clean, MAX_EXCERPT_CHARS)].filter(Boolean);
  return excerpts.map((excerpt, index) => ({
    evidenceId: `evd_${crypto.randomBytes(6).toString('hex')}`,
    sourceId: source.sourceId,
    claim: excerpt,
    excerpt,
    location: index === 0 ? 'lead' : `excerpt-${index + 1}`,
    confidence: 0.55,
    publishedAt: source.publishedAt,
    fetchedAt: source.fetchedAt,
    kind: classifyEvidenceKind(excerpt),
  }));
}

export function classifyEvidenceKind(text: string): EvidenceKind {
  const lowered = text.toLowerCase();
  if (INJECTION_CUES.some(cue => lowered.includes(cue))) return 'UNCERTAIN';
  return 'SOURCE_SUPPORTED';
}

export function compareEvidence(records: EvidenceRecord[]): Array<{ topic: string; sides: Array<{ sourceId: string; claim: string }> }> {
  const numeric = records.filter(item => /\d/.test(item.claim));
  if (numeric.length < 2) return [];
  const groups = new Map<string, EvidenceRecord[]>();
  for (const item of numeric) {
    const key = item.claim.replace(/\d[\d,.]*/g, '#').slice(0, 80);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const disagreements = [];
  for (const [topic, items] of groups) {
    const unique = [...new Set(items.map(item => item.claim))];
    if (unique.length < 2) continue;
    disagreements.push({
      topic,
      sides: items.slice(0, 4).map(item => ({ sourceId: item.sourceId, claim: item.claim })),
    });
  }
  return disagreements;
}
