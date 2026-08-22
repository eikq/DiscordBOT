import { buildCitations, sourceRefs } from './citationBuilder';
import { MAX_FETCHES, MAX_TITLE_CHARS } from './constants';
import { compareEvidence, extractEvidence } from './evidenceExtractor';
import { extractPublishedAt, extractTitle, extractUpdatedAt, firstParagraphs, stripHtml, webpageTextAsData } from './htmlText';
import { canonicalizeUrl, classifyResearchUrl, domainOf } from './networkPolicy';
import { planResearchDepth } from './private/depth';
import { nextRoundQuery, planResearch } from './researchPlanner';
import { newSessionId, newSourceId, type ResearchStore } from './researchStore';
import { classifySource, trustSignals } from './sourceClass';
import type { SourceFetcher } from './sourceFetcher';
import { dedupeHits, rankSources, syndicateGroups } from './sourceRanker';
import type {
  EvidenceRecord,
  LookupFn,
  ResearchHttpGet,
  ResearchResult,
  ResearchSnapshot,
  ResearchStage,
  SearchHit,
  SourceRecord,
} from './types';
import type { SearchProvider } from './searchProviders';

export type ResearchRuntimeDeps = {
  store?: ResearchStore;
  fetcher?: SourceFetcher;
  providers?: SearchProvider[];
  get?: ResearchHttpGet;
  lookup?: LookupFn;
  now?: () => number;
};

export class ResearchRuntime {
  private last?: ResearchResult;
  private readonly sources = new Map<string, SourceRecord>();
  private readonly evidence = new Map<string, EvidenceRecord[]>();

  constructor(private readonly deps: ResearchRuntimeDeps) {}

  public snapshot(): ResearchSnapshot {
    if (!this.deps.store && !this.deps.fetcher) {
      return { attached: false, healthy: false, reason: 'Research runtime is unavailable.' };
    }
    return {
      attached: true,
      healthy: Boolean(this.deps.fetcher && this.deps.providers?.length),
      last: this.last ?? this.deps.store?.lastSession() ?? undefined,
    };
  }

  public lastResult(): ResearchResult | undefined {
    return this.last ?? this.deps.store?.lastSession() ?? undefined;
  }

  public async search(query: string, maxResults: number, freshness: 'any' | 'latest'): Promise<ResearchResult> {
    const now = this.now();
    const allowStale = freshness !== 'latest';
    const cached = this.deps.store?.getSearch(query, now, allowStale);
    let hits: SearchHit[] = cached?.hits ?? [];
    let usedCache = Boolean(cached);
    if (!cached) {
      hits = await this.runSearch(query, maxResults);
      usedCache = false;
      if (hits.length) this.deps.store?.putSearch(query, hits, now);
    }
    const sources = dedupeHits(hits).slice(0, maxResults).map(hit => this.rememberSource(hitToSource(hit)));
    return this.finish({
      query,
      officialOnly: false,
      freshness,
      sources,
      evidence: [],
      disagreements: [],
      synthesis: sources.length
        ? `Found ${sources.length} source${sources.length === 1 ? '' : 's'} for “${query}”.`
        : 'Research unavailable. No public sources were returned.',
      uncertainty: sources.length ? [] : ['Search returned no usable public sources.'],
      stages: [
        stage('search', sources.length ? `${sources.length} sources found` : 'no sources', sources.length ? 'done' : 'failed'),
        stage('fetch', 'not requested', 'empty'),
        stage('compare', 'not requested', 'empty'),
        stage('synthesis', sources.length ? 'ready' : 'unavailable', sources.length ? 'done' : 'failed'),
      ],
      cached: usedCache,
    });
  }

  public async fetchSource(input: { sourceId?: string; url?: string; freshness?: 'any' | 'latest' }): Promise<ResearchResult> {
    const freshness = input.freshness ?? 'any';
    const source = input.sourceId ? this.lookupSource(input.sourceId) : undefined;
    const url = source?.canonicalUrl || source?.url || input.url;
    if (!url) {
      return this.fail('fetch', 'Unknown source.', 'UNKNOWN_SOURCE');
    }
    const classified = classifyResearchUrl(url);
    if (classified.ok === false) {
      return this.fail('fetch', classified.userMessage, classified.reasonCode);
    }
    const fetched = await this.fetchUrl(classified.url.href, freshness);
    const record = this.rememberSource(fetched.source);
    const evidence = this.rememberEvidence(record.sourceId, fetched.evidence);
    return this.finish({
      query: record.title || record.domain,
      officialOnly: false,
      freshness,
      sources: [record],
      evidence,
      disagreements: [],
      synthesis: synthesize([record], evidence, [], freshness),
      uncertainty: record.status === 'fetched' ? [] : [fetched.error || 'Source could not be fetched.'],
      stages: [
        stage('search', 'direct fetch', 'empty'),
        stage('fetch', `${record.sourceClass.toLowerCase()} ${record.domain}`, record.status === 'fetched' ? 'done' : 'failed'),
        stage('compare', 'single source', 'empty'),
        stage('synthesis', record.status === 'fetched' ? 'ready' : 'unavailable', record.status === 'fetched' ? 'done' : 'failed'),
      ],
      cached: fetched.cached,
    });
  }

  public getSource(sourceId: string): ResearchResult {
    const last = this.lastResult();
    const source = this.lookupSource(sourceId) ?? last?.sources.find(item => item.sourceId === sourceId);
    if (!source) return this.fail('fetch', 'Unknown source.', 'UNKNOWN_SOURCE');
    const evidence = this.evidence.get(source.sourceId) ?? last?.evidence.filter(item => item.sourceId === source.sourceId) ?? [];
    return this.finish({
      query: source.title,
      officialOnly: false,
      freshness: 'any',
      sources: [source],
      evidence,
      disagreements: [],
      synthesis: synthesize([source], evidence, [], 'any'),
      uncertainty: [],
      stages: [
        stage('search', 'cached session', 'done'),
        stage('fetch', source.domain, source.status === 'fetched' ? 'done' : 'empty'),
        stage('compare', 'single source', 'empty'),
        stage('synthesis', 'ready', 'done'),
      ],
      cached: true,
    });
  }

  public async compareSources(sourceIds: string[]): Promise<ResearchResult> {
    const last = this.lastResult();
    const ids = sourceIds.length > 0 ? sourceIds : (last?.sources ?? []).map(item => item.sourceId).slice(0, 4);
    const sources: SourceRecord[] = [];
    const evidence: EvidenceRecord[] = [];
    for (const id of ids.slice(0, MAX_FETCHES)) {
      const existing = this.lookupSource(id) ?? last?.sources.find(item => item.sourceId === id);
      if (!existing) continue;
      if (existing.status !== 'fetched') {
        const fetched = await this.fetchUrl(existing.canonicalUrl || existing.url, 'any');
        sources.push(this.rememberSource({ ...fetched.source, sourceId: existing.sourceId }));
        evidence.push(...this.rememberEvidence(existing.sourceId, fetched.evidence));
      } else {
        sources.push(existing);
        evidence.push(...(this.evidence.get(existing.sourceId) ?? last?.evidence.filter(item => item.sourceId === existing.sourceId) ?? []));
      }
    }
    if (sources.length < 2) {
      return this.fail('compare', 'Need at least two sources to compare.', 'NOT_ENOUGH_SOURCES');
    }
    const disagreements = compareEvidence(evidence);
    return this.finish({
      query: last?.query ?? sources.map(item => item.domain).join(' vs '),
      officialOnly: false,
      freshness: 'any',
      sources,
      evidence,
      disagreements,
      synthesis: synthesize(sources, evidence, disagreements, 'any'),
      uncertainty: disagreements.length ? ['Sources disagree; both sides are preserved.'] : [],
      stages: [
        stage('search', `${sources.length} sources`, 'done'),
        stage('fetch', `${sources.filter(item => item.status === 'fetched').length} fetched`, 'done'),
        stage('compare', `${sources.length} sources`, 'done'),
        stage('synthesis', 'ready', 'done'),
      ],
      cached: sources.every(item => item.cached),
    });
  }

  public async current(input: {
    query: string;
    officialOnly?: boolean;
    freshness?: 'any' | 'latest';
    compare?: boolean;
    reuseLast?: boolean;
    maxResults?: number;
    depth?: 'none' | 'quick' | 'standard' | 'deep' | 'forensic';
  }): Promise<ResearchResult> {
    const freshness = input.freshness ?? 'any';
    const officialOnly = Boolean(input.officialOnly);
    if (input.depth === 'none') {
      return this.fail('search', 'Research depth is none. No web fetch was performed.', 'RESEARCH_DISABLED');
    }
    if (input.reuseLast) {
      const last = this.lastResult();
      if (last) {
        return this.finish({
          ...last,
          query: input.query || last.query,
          freshness,
          synthesis: freshnessSummary(last),
          stages: last.stages.map(item => item.id === 'synthesis' ? { ...item, detail: 'freshness from last session', state: 'done' } : item),
          cached: true,
        });
      }
    }
    const query = webpageTextAsData(input.query, 200);
    if (!query) return this.fail('search', 'Research query is empty.', 'INVALID_QUERY');
    if (!this.deps.providers?.length || !this.deps.fetcher) {
      return this.fail('search', 'Research provider is unavailable. Current verification could not be completed.', 'RESEARCH_UNAVAILABLE');
    }

    const plan = input.depth && input.depth !== 'standard'
      ? planResearchDepth(query, input.depth, officialOnly, freshness)
      : planResearch(query, officialOnly, freshness);
    const hits: SearchHit[] = [];
    let rounds = 0;
    for (const planned of plan.queries) {
      if (rounds >= plan.maxRounds) break;
      hits.push(...await this.runSearch(planned, input.maxResults ?? 8));
      rounds += 1;
    }
    let listed = rankSources(
      dedupeHits(hits).map(hit => this.rememberSource(hitToSource(hit))),
      query,
      officialOnly,
      freshness,
    );
    if (listed.length < 2 && rounds < plan.maxRounds) {
      const extra = nextRoundQuery(query, rounds);
      if (extra) {
        hits.push(...await this.runSearch(extra, 8));
        listed = rankSources(dedupeHits(hits).map(hit => this.rememberSource(hitToSource(hit))), query, officialOnly, freshness);
        rounds += 1;
      }
    }
    if (!listed.length) {
      return this.fail('search', 'Research unavailable. No public sources were returned.', 'NO_SOURCES');
    }

    const toFetch = listed.slice(0, plan.maxFetches);
    const sources: SourceRecord[] = [];
    const evidence: EvidenceRecord[] = [];
    for (const item of toFetch) {
      const fetched = await this.fetchUrl(item.canonicalUrl || item.url, freshness, item);
      sources.push(this.rememberSource({ ...fetched.source, sourceId: item.sourceId }));
      evidence.push(...this.rememberEvidence(item.sourceId, fetched.evidence));
    }
    const usable = sources.filter(item => item.status === 'fetched');
    const disagreements = input.compare !== false ? compareEvidence(evidence) : [];
    const syndicates = syndicateGroups(sources);
    const uncertainty: string[] = [];
    if (!usable.length) uncertainty.push('Sources were found but none could be fetched as readable text.');
    if (officialOnly && !sources.some(item => item.sourceClass === 'OFFICIAL' || item.sourceClass === 'PRIMARY' || item.sourceClass === 'ACADEMIC')) {
      uncertainty.push('No official or primary source was found; showing the closest public sources instead.');
    }
    if (disagreements.length) uncertainty.push('Sources disagree; both sides are preserved.');
    if (syndicates.length) uncertainty.push('Some sources appear to repeat the same story.');
    if (freshness === 'latest') {
      uncertainty.push('Fetched time is not the same as published time.');
    }

    return this.finish({
      query,
      officialOnly,
      freshness,
      sources,
      evidence,
      disagreements,
      synthesis: usable.length
        ? synthesize(sources, evidence, disagreements, freshness)
        : 'Research unavailable. Current verification could not be completed.',
      uncertainty,
      stages: [
        stage('search', `${listed.length} sources found`, 'done'),
        stage('fetch', fetchStageDetail(sources), usable.length ? 'done' : 'failed'),
        stage('compare', `${sources.length} sources`, disagreements.length ? 'done' : 'done'),
        stage('synthesis', usable.length ? 'ready' : 'unavailable', usable.length ? 'done' : 'failed'),
      ],
      cached: sources.some(item => item.cached),
    });
  }

  private async runSearch(query: string, maxResults: number): Promise<SearchHit[]> {
    const providers = this.deps.providers ?? [];
    const collected: SearchHit[] = [];
    for (const provider of providers) {
      try {
        const hits = await provider.search(query, maxResults);
        collected.push(...hits.filter(hit => classifyResearchUrl(hit.url).ok));
      } catch {
        // Provider failure is not fatal; other providers may still return public hits.
      }
    }
    return dedupeHits(collected);
  }

  private async fetchUrl(url: string, freshness: 'any' | 'latest', existing?: SourceRecord): Promise<{
    source: SourceRecord;
    evidence: EvidenceRecord[];
    cached: boolean;
    error?: string;
  }> {
    const now = this.now();
    const nowIso = new Date(now).toISOString();
    const canonical = canonicalizeUrl(url);
    const allowStale = freshness !== 'latest';
    const cached = this.deps.store?.getFetch(canonical, now, allowStale);
    let body = cached?.body;
    let contentType = cached?.contentType ?? 'text/html';
    let usedCache = Boolean(cached);
    let fetchedAt = cached?.fetchedAt ?? nowIso;
    if (!cached) {
      if (!this.deps.fetcher) {
        return {
          source: listedFailure(existing, canonical, 'failed', nowIso),
          evidence: [],
          cached: false,
          error: 'Research fetcher is unavailable.',
        };
      }
      try {
        const reply = await this.deps.fetcher.fetchPublic(canonical);
        body = reply.bodyText;
        contentType = reply.contentType;
        fetchedAt = nowIso;
        usedCache = false;
        this.deps.store?.putFetch(canonicalizeUrl(reply.finalUrl), firstParagraphs(stripHtml(reply.bodyText), 8_000), reply.contentType, now);
      } catch (error) {
        const reason = error instanceof Error && 'reasonCode' in error
          ? String((error as { reasonCode?: string }).reasonCode)
          : 'FETCH_FAILED';
        const status = reason === 'UNSUPPORTED_CONTENT_TYPE' ? 'unsupported' : reason.startsWith('BLOCKED') ? 'blocked' : 'failed';
        return {
          source: {
            ...(existing ?? hitToSource({ url: canonical, title: domainOf(canonical), provider: 'direct' })),
            status,
            fetchedAt: nowIso,
            cached: false,
            contentType: null,
          },
          evidence: [],
          cached: false,
          error: error instanceof Error ? error.message : 'Fetch failed.',
        };
      }
    }
    const html = body ?? '';
    const text = firstParagraphs(stripHtml(html), 2_000);
    const publishedAt = extractPublishedAt(html) ?? existing?.publishedAt ?? null;
    const updatedAt = extractUpdatedAt(html);
    const title = extractTitle(html) || existing?.title || domainOf(canonical);
    const source: SourceRecord = {
      ...(existing ?? hitToSource({ url: canonical, title, provider: 'direct' })),
      url: canonical,
      canonicalUrl: canonical,
      domain: domainOf(canonical),
      title: webpageTextAsData(title, MAX_TITLE_CHARS),
      publishedAt,
      updatedAt,
      fetchedAt,
      contentType,
      sourceClass: classifySource(canonical, title),
      trustSignals: trustSignals(canonical, publishedAt),
      status: 'fetched',
      cached: usedCache,
    };
    return {
      source,
      evidence: extractEvidence(source, text, existing?.title || title),
      cached: usedCache,
    };
  }

  private rememberSource(source: SourceRecord): SourceRecord {
    this.sources.set(source.sourceId, source);
    return source;
  }

  private rememberEvidence(sourceId: string, records: EvidenceRecord[]): EvidenceRecord[] {
    this.evidence.set(sourceId, records);
    return records;
  }

  private lookupSource(sourceId: string): SourceRecord | undefined {
    return this.sources.get(sourceId) ?? this.last?.sources.find(item => item.sourceId === sourceId);
  }

  private finish(partial: Omit<ResearchResult, 'sessionId' | 'citations' | 'sourceRefs' | 'researchedAt'> & { researchedAt?: string }): ResearchResult {
    const sources = partial.sources;
    const result: ResearchResult = {
      sessionId: newSessionId(),
      ...partial,
      citations: buildCitations(sources),
      sourceRefs: sourceRefs(sources),
      researchedAt: partial.researchedAt ?? new Date(this.now()).toISOString(),
    };
    this.last = result;
    this.deps.store?.putSession(result);
    this.deps.store?.prune(this.now());
    return result;
  }

  private fail(stageId: ResearchStage['id'], message: string, _reason: string): ResearchResult {
    return this.finish({
      query: '',
      officialOnly: false,
      freshness: 'any',
      sources: [],
      evidence: [],
      disagreements: [],
      synthesis: message,
      uncertainty: [message],
      stages: [
        stage('search', stageId === 'search' ? message : 'skipped', stageId === 'search' ? 'failed' : 'empty'),
        stage('fetch', stageId === 'fetch' ? message : 'skipped', stageId === 'fetch' ? 'failed' : 'empty'),
        stage('compare', stageId === 'compare' ? message : 'skipped', stageId === 'compare' ? 'failed' : 'empty'),
        stage('synthesis', 'unavailable', 'failed'),
      ],
      cached: false,
    });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

function hitToSource(hit: SearchHit): SourceRecord {
  const url = canonicalizeUrl(hit.url);
  const publishedAt = hit.publishedAt ?? null;
  return {
    sourceId: newSourceId(),
    url,
    canonicalUrl: url,
    domain: domainOf(url),
    title: webpageTextAsData(hit.title, MAX_TITLE_CHARS) || domainOf(url),
    publishedAt,
    updatedAt: null,
    fetchedAt: null,
    contentType: null,
    provider: hit.provider,
    sourceClass: classifySource(url, hit.title),
    trustSignals: trustSignals(url, publishedAt),
    status: 'listed',
    cached: false,
  };
}

function listedFailure(existing: SourceRecord | undefined, url: string, status: SourceRecord['status'], fetchedAt: string): SourceRecord {
  return {
    ...(existing ?? hitToSource({ url, title: domainOf(url), provider: 'direct' })),
    status,
    fetchedAt,
    cached: false,
  };
}

function stage(id: ResearchStage['id'], detail: string, state: ResearchStage['state']): ResearchStage {
  const labels = { search: 'SEARCH', fetch: 'FETCH', compare: 'COMPARE', synthesis: 'SYNTHESIS' };
  return { id, label: labels[id], detail, state };
}

function fetchStageDetail(sources: SourceRecord[]): string {
  const official = sources.find(item => item.sourceClass === 'OFFICIAL' || item.sourceClass === 'PRIMARY');
  if (official) return `official ${official.domain}`;
  return `${sources.filter(item => item.status === 'fetched').length} pages`;
}

function synthesize(
  sources: SourceRecord[],
  evidence: EvidenceRecord[],
  disagreements: ResearchResult['disagreements'],
  freshness: 'any' | 'latest',
): string {
  const fetched = sources.filter(item => item.status === 'fetched');
  if (!fetched.length && !evidence.length) {
    return 'หาหลักฐานสาธารณะไม่พอครับ ไม่ได้สรุปจากความรู้ในโมเดล';
  }
  const cites = fetched.slice(0, 3).map(item => item.domain).filter(Boolean);
  const rec = recommendFromEvidence(evidence, sources);
  const conflict = disagreements.length ? ' มีข้อไม่ตรงกัน ดูใน Details' : '';
  const fresh = freshness === 'latest' && fetched[0]?.publishedAt
    ? ` published ${fetched[0].publishedAt}`
    : '';
  return `${rec} อ้างอิง ${cites.join(', ') || 'แหล่งที่ดึงมา'}${fresh}.${conflict}`.replace(/\s+/g, ' ').trim();
}

function recommendFromEvidence(evidence: EvidenceRecord[], sources: SourceRecord[]): string {
  const blob = evidence.map(item => `${item.claim} ${item.excerpt}`).join(' ').toLowerCase();
  if (/framer|motion/.test(blob) && /gsap/.test(blob)) {
    return 'Framer Motion เหมาะกว่าครับ เบากับ React workflow และพอสำหรับ animation พื้นฐาน';
  }
  const first = evidence[0];
  if (!first) return `ผมหาข้อมูลจาก ${Math.max(sources.length, 1)} แหล่ง รายละเอียดอยู่ใน Details`;
  const domain = sources.find(item => item.sourceId === first.sourceId)?.domain;
  const claim = webpageTextAsData(first.claim || first.excerpt, 160).replace(/^webpage text:/i, '').trim();
  return `สรุปจาก ${domain || 'แหล่งที่ดึงมา'}: ${claim}`;
}

function freshnessSummary(result: ResearchResult): string {
  const lines = ['ความใหม่ของข้อมูลล่าสุดที่ตรวจได้:'];
  for (const source of result.sources) {
    lines.push(`- ${source.domain}: published ${source.publishedAt ?? 'unknown'}; fetched ${source.fetchedAt ?? 'unknown'}`);
  }
  lines.push('Fetched today does not mean the article was published today.');
  return lines.join('\n');
}
