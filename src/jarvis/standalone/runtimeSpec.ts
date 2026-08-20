import { describeJarvisRuntimeProfile } from './runtimeProfile';

/**
 * Versioned, diffable description of the existing Jarvis runtime.
 * This does not replace runtimeProfile.ts (voice vs interactive env).
 * Security / privilege / owner identity are frozen and are not optimization variables.
 */

export const RUNTIME_SPEC_VERSION = 1;

export type RetrievalFusionMode = 'lexical' | 'lexical_semantic' | 'lexical_only';

export type RuntimeSpecLayers = {
  intelligence: {
    modelProfileId: string;
    routingPolicyId: string;
    retrievalTopK: number;
    retrievalFusion: RetrievalFusionMode;
    skillOverlayIds: string[];
  };
  engine: {
    interactiveProfile: 'voice' | 'interactive';
    timeoutMs: number;
    retryLimit: number;
    contextTokens: number;
  };
  agent: {
    maxPlanSteps: number;
    toolOrdering: string[];
  };
  toolsMemory: {
    canonicalStore: 'sqlite';
    qdrantRole: 'derived_index';
    memoryTurnLimit: number;
  };
  learning: {
    nightEnabled: boolean;
    consumeTraces: boolean;
    specOptimizationEnabled: boolean;
    autoPromote: false;
  };
};

export type RuntimeSpecFrozen = {
  security: true;
  permissions: true;
  ownerIdentity: true;
  trustPolicy: true;
  secretHandling: true;
  promotionRules: true;
};

export type JarvisRuntimeSpec = {
  version: number;
  id: string;
  parentId?: string;
  createdAt: string;
  layers: RuntimeSpecLayers;
  frozen: RuntimeSpecFrozen;
};

export const FROZEN_RUNTIME_SPEC: RuntimeSpecFrozen = {
  security: true,
  permissions: true,
  ownerIdentity: true,
  trustPolicy: true,
  secretHandling: true,
  promotionRules: true,
};

export function defaultRuntimeSpec(now: () => number = () => Date.now(), env: NodeJS.ProcessEnv = process.env): JarvisRuntimeSpec {
  const profile = describeJarvisRuntimeProfile(env);
  return {
    version: RUNTIME_SPEC_VERSION,
    id: 'spec_baseline_v1',
    createdAt: new Date(now()).toISOString(),
    layers: {
      intelligence: {
        modelProfileId: 'local-env-llm',
        routingPolicyId: 'certified-evidence-v1',
        retrievalTopK: 8,
        retrievalFusion: 'lexical_semantic',
        skillOverlayIds: [],
      },
      engine: {
        interactiveProfile: profile.id,
        timeoutMs: profile.timeoutMs,
        retryLimit: 2,
        contextTokens: profile.contextTokens,
      },
      agent: {
        maxPlanSteps: 24,
        toolOrdering: ['understand', 'retrieve', 'research', 'apply', 'verify'],
      },
      toolsMemory: {
        canonicalStore: 'sqlite',
        qdrantRole: 'derived_index',
        memoryTurnLimit: 8,
      },
      learning: {
        nightEnabled: false,
        consumeTraces: true,
        specOptimizationEnabled: true,
        autoPromote: false,
      },
    },
    frozen: { ...FROZEN_RUNTIME_SPEC },
  };
}

export class RuntimeSpecRegistry {
  private currentSpec: JarvisRuntimeSpec;
  private readonly historyItems: JarvisRuntimeSpec[] = [];
  private readonly now: () => number;
  private readonly persist?: { load: () => JarvisRuntimeSpec[]; replace: (items: JarvisRuntimeSpec[]) => void };

  constructor(
    now: () => number = () => Date.now(),
    persist?: { load: () => JarvisRuntimeSpec[]; replace: (items: JarvisRuntimeSpec[]) => void },
  ) {
    this.now = now;
    this.persist = persist;
    const loaded = persist?.load() ?? [];
    if (loaded.length > 0) {
      this.historyItems.push(...loaded);
      this.currentSpec = loaded.at(-1)!;
    } else {
      this.currentSpec = defaultRuntimeSpec(now);
      this.historyItems.push(this.currentSpec);
      persist?.replace(this.historyItems);
    }
  }

  public current(): JarvisRuntimeSpec {
    return structuredClone(this.currentSpec);
  }

  public history(): JarvisRuntimeSpec[] {
    return this.historyItems.map(item => structuredClone(item));
  }

  /** Owner-applied replacement only. Optimizers must not call this. */
  public commitOwner(spec: JarvisRuntimeSpec): JarvisRuntimeSpec {
    if (spec.frozen.promotionRules !== true || spec.layers.learning.autoPromote !== false) {
      throw new Error('Runtime spec cannot relax frozen promotion rules.');
    }
    this.currentSpec = structuredClone(spec);
    this.currentSpec.createdAt = new Date(this.now()).toISOString();
    this.historyItems.push(this.currentSpec);
    this.persist?.replace(this.historyItems);
    return this.current();
  }
}

export function diffRuntimeSpec(from: JarvisRuntimeSpec, to: JarvisRuntimeSpec): Array<{ path: string; from: unknown; to: unknown }> {
  const out: Array<{ path: string; from: unknown; to: unknown }> = [];
  walk('layers', from.layers, to.layers, out);
  return out;
}

function walk(path: string, left: unknown, right: unknown, out: Array<{ path: string; from: unknown; to: unknown }>): void {
  if (Object.is(left, right)) return;
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const keys = new Set([...Object.keys(left as object), ...Object.keys(right as object)]);
    for (const key of keys) {
      walk(`${path}.${key}`, (left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], out);
    }
    return;
  }
  out.push({ path, from: left, to: right });
}
