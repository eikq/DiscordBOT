import { domainOf } from './networkPolicy';
import type { SourceClass, TrustSignals } from './types';

const OFFICIAL_SUFFIXES = [
  '.gov',
  '.go.th',
  '.mil',
  '.edu',
  'nvidia.com',
  'developer.nvidia.com',
  'docs.nvidia.com',
  'nvidianews.nvidia.com',
  'microsoft.com',
  'learn.microsoft.com',
  'apple.com',
  'developer.apple.com',
  'google.com',
  'cloud.google.com',
  'openai.com',
  'arxiv.org',
  'doi.org',
  'w3.org',
  'ietf.org',
  'who.int',
  'un.org',
];

const ACADEMIC = ['arxiv.org', 'acm.org', 'ieee.org', 'nature.com', 'science.org', 'nih.gov', 'pubmed.ncbi.nlm.nih.gov'];
const REFERENCE = ['wikipedia.org', 'wikidata.org', 'britannica.com', 'mdn', 'developer.mozilla.org'];
const NEWS = ['reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'bloomberg.com', 'theverge.com', 'arstechnica.com', 'techcrunch.com'];
const COMMUNITY = [
  'reddit.com',
  'news.ycombinator.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'forum.',
  'discord.com',
  'medium.com',
  'wordpress.com',
  'blogspot.com',
  'tumblr.com',
];

export function classifySource(url: string, title = ''): SourceClass {
  const domain = domainOf(url);
  const hay = `${domain} ${title}`.toLowerCase();
  if (ACADEMIC.some(item => domain.endsWith(item) || hay.includes(item))) return 'ACADEMIC';
  if (OFFICIAL_SUFFIXES.some(item => domain === item || domain.endsWith(item) || domain.endsWith(`.${item}`))) {
    return domain.endsWith('.edu') || domain.includes('arxiv') ? 'ACADEMIC' : 'OFFICIAL';
  }
  if (REFERENCE.some(item => domain.endsWith(item) || hay.includes(item))) return 'REFERENCE';
  if (NEWS.some(item => domain.endsWith(item))) return 'NEWS';
  if (COMMUNITY.some(item => domain.includes(item) || hay.includes(item))) return 'COMMUNITY';
  if (/(^|\.)docs\.|(^|\.)developer\.|newsroom|(^|\.)press\./iu.test(domain)) return 'OFFICIAL';
  if (/blog|forum|community/iu.test(domain)) return 'COMMUNITY';
  return 'UNKNOWN';
}

export function trustSignals(url: string, publishedAt: string | null): TrustSignals {
  let https = false;
  try {
    https = new URL(url).protocol === 'https:';
  } catch {
    https = false;
  }
  const sourceClass = classifySource(url);
  return {
    officialDomain: sourceClass === 'OFFICIAL' || sourceClass === 'PRIMARY' || sourceClass === 'ACADEMIC',
    hasPublishedAt: Boolean(publishedAt),
    https,
  };
}

export function classRank(sourceClass: SourceClass): number {
  switch (sourceClass) {
    case 'PRIMARY':
    case 'OFFICIAL':
      return 0;
    case 'ACADEMIC':
      return 1;
    case 'REFERENCE':
      return 2;
    case 'NEWS':
      return 3;
    case 'COMMUNITY':
      return 5;
    default:
      return 4;
  }
}
