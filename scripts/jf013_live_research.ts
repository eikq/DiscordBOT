import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inferResearchIntent } from '../src/jarvis/research/researchIntent';
import { createResearchRuntime } from '../src/jarvis/research/researchHost';
import { classifyResearchUrl } from '../src/jarvis/research/networkPolicy';
import { SourceFetcher, nodeResearchGet } from '../src/jarvis/research/sourceFetcher';

function ms(started: number): number {
  return Date.now() - started;
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf013-live-'));
  const runtime = createResearchRuntime({ dbPath: path.join(dir, 'research.db') });
  const report: Record<string, unknown> = { dir };

  const intentStarted = Date.now();
  const intent = inferResearchIntent('Jarvis วันนี้มีข่าวอะไรเกี่ยวกับ RTX 5090');
  report.intentMs = ms(intentStarted);
  report.intent = intent;

  const searchStarted = Date.now();
  const current = await runtime.current({
    query: 'RTX 5090',
    freshness: 'latest',
    maxResults: 6,
  });
  report.searchAndFetchMs = ms(searchStarted);
  report.current = {
    sourceCount: current.sources.length,
    evidenceCount: current.evidence.length,
    classes: current.sources.map(item => [item.domain, item.sourceClass, item.publishedAt, item.fetchedAt, item.status]),
    uncertainty: current.uncertainty,
    synthesisChars: current.synthesis.length,
  };

  const officialStarted = Date.now();
  const official = await runtime.current({
    query: 'NVIDIA RTX 5090',
    officialOnly: true,
    freshness: 'latest',
  });
  report.officialMs = ms(officialStarted);
  report.official = official.sources.map(item => [item.domain, item.sourceClass]);

  const compareStarted = Date.now();
  const compared = official.sources.length >= 2
    ? await runtime.compareSources(official.sources.map(item => item.sourceId).slice(0, 3))
    : await runtime.compareSources(current.sources.map(item => item.sourceId).slice(0, 3));
  report.compareMs = ms(compareStarted);
  report.compare = {
    sources: compared.sources.length,
    disagreements: compared.disagreements.length,
  };

  const freshness = current.sources.map(item => ({
    domain: item.domain,
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt,
    sameDay: item.publishedAt?.slice(0, 10) === item.fetchedAt?.slice(0, 10),
  }));
  report.freshness = freshness;

  const pdf = await runtime.fetchSource({ url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' }).catch(error => ({
    synthesis: error instanceof Error ? error.message : String(error),
    sources: [],
  }));
  report.unsupported = {
    synthesis: 'synthesis' in pdf ? pdf.synthesis : '',
    status: 'sources' in pdf ? pdf.sources[0]?.status : undefined,
  };

  const localClass = classifyResearchUrl('http://127.0.0.1:3010');
  let localFetch = 'not-attempted';
  try {
    await new SourceFetcher(nodeResearchGet, async () => ['127.0.0.1']).fetchPublic('http://127.0.0.1:3010');
    localFetch = 'UNEXPECTED_SUCCESS';
  } catch (error) {
    localFetch = error instanceof Error ? error.message : String(error);
  }
  report.localhost = { classified: localClass, fetch: localFetch };

  const cacheStarted = Date.now();
  const cached = await runtime.current({ query: 'RTX 5090', freshness: 'any' });
  report.cacheHitMs = ms(cacheStarted);
  report.cachedFlag = cached.cached;

  const chatIntentStarted = Date.now();
  const chat = inferResearchIntent('สวัสดีครับ');
  report.normalChatIntentMs = ms(chatIntentStarted);
  report.normalChatIntent = chat.kind;

  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
