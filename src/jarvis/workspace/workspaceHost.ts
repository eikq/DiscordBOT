import type { ResearchRuntime } from '../research';
import { loadWorkspaceRegistry } from './registry';
import { createWorkspaceStore, defaultWorkspaceDbPath } from './workspaceStore';
import { WorkspaceRuntime } from './workspaceRuntime';

export type WorkspaceHostOptions = {
  hostRoot?: string;
  dbPath?: string;
  configPath?: string;
  now?: () => number;
  research?: ResearchRuntime;
};

let shared: WorkspaceRuntime | undefined;
let sharedStore: ReturnType<typeof createWorkspaceStore> | undefined;

export function createWorkspaceRuntime(options: WorkspaceHostOptions = {}): WorkspaceRuntime {
  const hostRoot = options.hostRoot ?? process.cwd();
  const store = createWorkspaceStore(options.dbPath ?? defaultWorkspaceDbPath(hostRoot));
  return new WorkspaceRuntime({
    registry: loadWorkspaceRegistry({ hostRoot, configPath: options.configPath }),
    store,
    now: options.now,
    researchCurrent: options.research
      ? async query => options.research!.current({ query, freshness: 'any', compare: true })
      : undefined,
  });
}

export function sharedWorkspaceRuntime(options: WorkspaceHostOptions = {}): WorkspaceRuntime {
  if (!shared) {
    const hostRoot = options.hostRoot ?? process.cwd();
    sharedStore = createWorkspaceStore(options.dbPath ?? defaultWorkspaceDbPath(hostRoot));
    shared = new WorkspaceRuntime({
      registry: loadWorkspaceRegistry({ hostRoot, configPath: options.configPath }),
      store: sharedStore,
      now: options.now,
      researchCurrent: options.research
        ? async query => options.research!.current({ query, freshness: 'any', compare: true })
        : undefined,
    });
  }
  return shared;
}

export function trySharedWorkspaceRuntime(options: WorkspaceHostOptions = {}): WorkspaceRuntime | undefined {
  try {
    return sharedWorkspaceRuntime(options);
  } catch (error) {
    console.warn(`[Jarvis] Workspace store unavailable: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

export function resetSharedWorkspaceRuntime(): void {
  sharedStore?.close();
  sharedStore = undefined;
  shared = undefined;
}
