import { duckDuckGoSearchProvider, wikipediaSearchProvider } from './searchProviders';
import { createResearchStore, defaultResearchDbPath } from './researchStore';
import { ResearchRuntime, type ResearchRuntimeDeps } from './researchRuntime';
import { SourceFetcher, nodeResearchGet } from './sourceFetcher';
import type { LookupFn, ResearchHttpGet } from './types';

export type ResearchHostOptions = {
  dbPath?: string;
  get?: ResearchHttpGet;
  lookup?: LookupFn;
  now?: () => number;
  providers?: ResearchRuntimeDeps['providers'];
};

let shared: ResearchRuntime | undefined;
let sharedStore: ReturnType<typeof createResearchStore> | undefined;

export function createResearchRuntime(options: ResearchHostOptions = {}): ResearchRuntime {
  const store = createResearchStore(options.dbPath ?? defaultResearchDbPath());
  const get = options.get ?? nodeResearchGet;
  const fetcher = new SourceFetcher(get, options.lookup ?? defaultPublicLookup);
  const providers = options.providers ?? [
    wikipediaSearchProvider(get),
    duckDuckGoSearchProvider(get),
  ];
  return new ResearchRuntime({
    store,
    fetcher,
    providers,
    get,
    lookup: options.lookup,
    now: options.now,
  });
}

export function sharedResearchRuntime(options: ResearchHostOptions = {}): ResearchRuntime {
  if (!shared) {
    const dbPath = options.dbPath ?? defaultResearchDbPath();
    sharedStore = createResearchStore(dbPath);
    const get = options.get ?? nodeResearchGet;
    const fetcher = new SourceFetcher(get, options.lookup ?? defaultPublicLookup);
    shared = new ResearchRuntime({
      store: sharedStore,
      fetcher,
      providers: options.providers ?? [wikipediaSearchProvider(get), duckDuckGoSearchProvider(get)],
      get,
      lookup: options.lookup,
      now: options.now,
    });
  }
  return shared;
}

export function trySharedResearchRuntime(options: ResearchHostOptions = {}): ResearchRuntime | undefined {
  try {
    return sharedResearchRuntime(options);
  } catch (error) {
    console.warn(`[Jarvis] Research store unavailable: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

export function resetSharedResearchRuntime(): void {
  sharedStore?.close();
  sharedStore = undefined;
  shared = undefined;
}

export function researchDbBeside(workspaceRoot: string): string {
  return defaultResearchDbPath(workspaceRoot);
}

async function defaultPublicLookup(hostname: string): Promise<string[]> {
  const { lookup } = await import('node:dns/promises');
  if (/^\d+\.\d+\.\d+\.\d+$/u.test(hostname) || hostname.includes(':')) return [hostname];
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map(item => item.address);
}
