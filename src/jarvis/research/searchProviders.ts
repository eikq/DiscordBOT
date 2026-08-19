import { SEARCH_TIMEOUT_MS } from './constants';
import { classifyResearchUrl, canonicalizeUrl } from './networkPolicy';
import type { ResearchHttpGet, SearchHit } from './types';

export type SearchProvider = {
  id: string;
  search(query: string, maxResults: number): Promise<SearchHit[]>;
};

const UA = { 'user-agent': 'JarvisResearch/1.0 (read-only; +local)' };

export function wikipediaSearchProvider(get: ResearchHttpGet): SearchProvider {
  return {
    id: 'wikipedia',
    async search(query, maxResults) {
      const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${Math.min(maxResults, 8)}&namespace=0&format=json`;
      const reply = await get(url, { timeoutMs: SEARCH_TIMEOUT_MS, headers: { ...UA, accept: 'application/json' } });
      const json = JSON.parse(new TextDecoder().decode(reply.body)) as unknown;
      if (!Array.isArray(json) || !Array.isArray(json[1]) || !Array.isArray(json[3])) return [];
      const titles = json[1] as string[];
      const links = json[3] as string[];
      const snippets = Array.isArray(json[2]) ? json[2] as string[] : [];
      return titles.flatMap((title, index) => {
        const href = links[index];
        if (!href || !classifyResearchUrl(href).ok) return [];
        return [{
          url: canonicalizeUrl(href),
          title,
          snippet: snippets[index],
          provider: 'wikipedia',
        }];
      });
    },
  };
}

export function duckDuckGoSearchProvider(get: ResearchHttpGet): SearchProvider {
  return {
    id: 'duckduckgo',
    async search(query, maxResults) {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const reply = await get(url, { timeoutMs: SEARCH_TIMEOUT_MS, headers: { ...UA, accept: 'text/html' } });
      const html = new TextDecoder().decode(reply.body);
      const hits: SearchHit[] = [];
      const pattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu;
      let match: RegExpExecArray | null = pattern.exec(html);
      while (match && hits.length < maxResults) {
        const href = decodeDuckUrl(match[1]);
        if (href && classifyResearchUrl(href).ok) {
          hits.push({
            url: canonicalizeUrl(href),
            title: match[2].replace(/<[^>]+>/gu, '').trim(),
            provider: 'duckduckgo',
          });
        }
        match = pattern.exec(html);
      }
      return hits;
    },
  };
}

function decodeDuckUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw, 'https://html.duckduckgo.com/');
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    if (classifyResearchUrl(parsed.href).ok) return parsed.href;
    return null;
  } catch {
    return null;
  }
}
