import type { ChildProcess } from 'node:child_process';
import {
  JARVIS_SERVICE_CATALOG,
  isJarvisServiceId,
  serviceRecord,
  type JarvisServiceHealth,
  type JarvisServiceId,
  type JarvisServiceLifecycle,
  type JarvisServiceRecord,
} from './catalog';
import { probeService, type ServiceProbe } from './health';

export type ServiceOpResult = {
  status: 'completed' | 'failed' | 'unavailable';
  code: string;
  lifecycle: JarvisServiceLifecycle;
  summary: string;
  health?: JarvisServiceHealth;
};

export type ServiceAdapterResult = {
  ok: boolean;
  child?: ChildProcess | null;
  owned?: boolean;
  errorCode?: string;
  message?: string;
};

export type ServiceAdapter = {
  start?: () => Promise<ServiceAdapterResult>;
  stop?: (owned?: ChildProcess) => Promise<ServiceAdapterResult>;
};

export type ServiceSnapshot = ServiceProbe & {
  displayName: string;
  startAllowed: boolean;
  stopAllowed: boolean;
  restartAllowed: boolean;
};

const START_WAIT_MS = 2_000;
const STOP_WAIT_MS = 3_000;

export class JarvisServiceController {
  private readonly states = new Map<JarvisServiceId, JarvisServiceLifecycle>();
  private readonly owned = new Map<JarvisServiceId, ChildProcess>();
  private readonly inflight = new Map<string, Promise<ServiceOpResult>>();
  private readonly starting = new Map<JarvisServiceId, Promise<ServiceAdapterResult>>();

  constructor(
    private readonly adapters: Partial<Record<JarvisServiceId, ServiceAdapter>> = {},
    private readonly probe: (id: JarvisServiceId) => Promise<ServiceProbe> = probeService,
  ) {}

  public catalog(): readonly JarvisServiceRecord[] {
    return JARVIS_SERVICE_CATALOG;
  }

  public async snapshot(): Promise<ServiceSnapshot[]> {
    const probes = await Promise.all(JARVIS_SERVICE_CATALOG.map(async item => {
      const probe = await this.health(item.id);
      return {
        ...probe,
        displayName: item.displayName,
        startAllowed: item.startAllowed,
        stopAllowed: item.stopAllowed,
        restartAllowed: item.restartAllowed,
      };
    }));
    return probes;
  }

  public async health(id: JarvisServiceId): Promise<ServiceProbe> {
    const local = this.states.get(id);
    if (local === 'STARTING' || local === 'STOPPING') {
      return { id, health: 'degraded', lifecycle: local, reason: local === 'STARTING' ? 'Starting' : 'Stopping' };
    }
    const probed = await this.probe(id);
    if (this.owned.has(id) && (local === 'RUNNING' || local === 'DEGRADED')) {
      if (probed.lifecycle === 'RUNNING') {
        this.states.set(id, 'RUNNING');
        return probed;
      }
      return {
        ...probed,
        health: 'degraded',
        lifecycle: local ?? 'RUNNING',
        reason: probed.reason || 'Owned process is still tracked.',
      };
    }
    if (!local) {
      this.states.set(id, probed.lifecycle);
      return probed;
    }
    if (local === 'DEGRADED' && probed.lifecycle === 'STOPPED') {
      return { ...probed, health: 'degraded', lifecycle: 'DEGRADED' };
    }
    if (probed.lifecycle === 'RUNNING') this.states.set(id, 'RUNNING');
    if (probed.lifecycle === 'STOPPED' && !this.owned.has(id)) {
      this.states.set(id, 'STOPPED');
    }
    return { ...probed, lifecycle: this.states.get(id) ?? probed.lifecycle };
  }

  public async start(id: string): Promise<ServiceOpResult> {
    return this.runExclusive(`life:${id}`, () => this.startExclusive(id));
  }

  public async stop(id: string): Promise<ServiceOpResult> {
    return this.runExclusive(`life:${id}`, async () => {
      const record = requireStoppable(id);
      if (record.ok === false) return record.result;
      const current = await this.health(record.id);
      if (current.lifecycle === 'STOPPED' && !this.owned.has(record.id)) {
        return done('ALREADY_STOPPED', 'STOPPED', `${record.meta.displayName} is already stopped.`, current.health);
      }
      const child = this.owned.get(record.id);
      if (!child) {
        return unavailable('NOT_OWNED', current.lifecycle, `${record.meta.displayName} is running outside this Jarvis process, so Jarvis will not stop it.`);
      }
      const adapter = this.adapters[record.id];
      this.states.set(record.id, 'STOPPING');
      const stopped = await this.safeAdapt(() => adapter?.stop ? adapter.stop(child) : killOwned(child));
      if (!stopped.ok) {
        this.states.set(record.id, 'DEGRADED');
        return failed(stopped.errorCode || 'STOP_FAILED', 'DEGRADED', stopped.message || `Could not stop ${record.meta.displayName}.`);
      }
      this.owned.delete(record.id);
      this.states.set(record.id, 'STOPPED');
      return done('STOPPED', 'STOPPED', `Stopped ${record.meta.displayName}.`, 'offline');
    });
  }

  public async restart(id: string): Promise<ServiceOpResult> {
    return this.runExclusive(`life:${id}`, async () => {
      const record = requireRestartable(id);
      if (record.ok === false) return record.result;
      const current = await this.health(record.id);
      if (current.lifecycle === 'STARTING') {
        return done('ALREADY_STARTING', 'STARTING', `${record.meta.displayName} is already starting.`, 'degraded');
      }
      if (current.lifecycle === 'RUNNING') {
        if (!this.owned.has(record.id)) {
          return unavailable('NOT_OWNED', 'RUNNING', `${record.meta.displayName} is running outside this Jarvis process, so Jarvis will not recycle it.`);
        }
        const stopped = await this.stopOwned(record.id, record.meta.displayName);
        if (stopped.status !== 'completed') return stopped;
      }
      return this.startUnlocked(record.id, record.meta);
    });
  }

  private async startExclusive(id: string): Promise<ServiceOpResult> {
    const record = requireStartable(id);
    if (record.ok === false) return record.result;
    if (this.starting.has(record.id)) {
      return done('ALREADY_STARTING', 'STARTING', `${record.meta.displayName} is already starting.`, 'degraded');
    }
    const current = await this.health(record.id);
    if (current.lifecycle === 'RUNNING') {
      return done('ALREADY_RUNNING', 'RUNNING', `${record.meta.displayName} is already running.`, current.health);
    }
    const adapter = this.adapters[record.id];
    if (!adapter?.start) {
      return unavailable('START_NOT_SUPPORTED', current.lifecycle, `${record.meta.displayName} cannot be started from Jarvis.`);
    }
    this.states.set(record.id, 'STARTING');
    const work = this.safeAdapt(() => adapter.start!(), 0);
    this.starting.set(record.id, work);
    void work.finally(() => {
      if (this.starting.get(record.id) === work) this.starting.delete(record.id);
    });
    const raced = await Promise.race([
      work.then(result => ({ kind: 'done' as const, result })),
      sleep(START_WAIT_MS).then(() => ({ kind: 'wait' as const })),
    ]);
    if (raced.kind === 'wait') {
      void work.then(result => this.applyStart(record.id, result));
      return done('STARTING', 'STARTING', `Starting ${record.meta.displayName}.`, 'degraded');
    }
    return this.applyStart(record.id, raced.result, record.meta.displayName);
  }

  private async startUnlocked(id: JarvisServiceId, meta: JarvisServiceRecord): Promise<ServiceOpResult> {
    return this.startExclusive(id);
  }

  private async stopOwned(id: JarvisServiceId, displayName: string): Promise<ServiceOpResult> {
    const child = this.owned.get(id);
    if (!child) return unavailable('NOT_OWNED', 'RUNNING', `${displayName} is not owned.`);
    this.states.set(id, 'STOPPING');
    const adapter = this.adapters[id];
    const stopped = await this.safeAdapt(() => adapter?.stop ? adapter.stop(child) : killOwned(child));
    if (!stopped.ok) {
      this.states.set(id, 'DEGRADED');
      return failed(stopped.errorCode || 'STOP_FAILED', 'DEGRADED', stopped.message || `Could not stop ${displayName}.`);
    }
    this.owned.delete(id);
    this.states.set(id, 'STOPPED');
    return done('STOPPED', 'STOPPED', `Stopped ${displayName}.`, 'offline');
  }

  private applyStart(id: JarvisServiceId, result: ServiceAdapterResult, displayName = serviceRecord(id)?.displayName || id): ServiceOpResult {
    if (!result.ok) {
      this.states.set(id, 'DEGRADED');
      return failed(result.errorCode || 'START_FAILED', 'DEGRADED', result.message || `Could not start ${displayName}.`);
    }
    if (result.child) this.owned.set(id, result.child);
    this.states.set(id, 'RUNNING');
    return done('STARTED', 'RUNNING', `Started ${displayName}.`, 'healthy');
  }

  private async runExclusive(key: string, work: () => Promise<ServiceOpResult>): Promise<ServiceOpResult> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const started = work();
    this.inflight.set(key, started);
    try {
      return await started;
    } finally {
      if (this.inflight.get(key) === started) this.inflight.delete(key);
    }
  }

  private async safeAdapt(work: () => Promise<ServiceAdapterResult>, timeoutMs = STOP_WAIT_MS + 2_000): Promise<ServiceAdapterResult> {
    try {
      if (!timeoutMs) return await work();
      return await withTimeout(work(), timeoutMs, {
        ok: false,
        errorCode: 'TIMEOUT',
        message: 'The service operation timed out.',
      });
    } catch (error) {
      return {
        ok: false,
        errorCode: 'ADAPTER_FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function requireStartable(id: string): { ok: true; id: JarvisServiceId; meta: JarvisServiceRecord } | { ok: false; result: ServiceOpResult } {
  if (!isJarvisServiceId(id)) {
    return { ok: false, result: unavailable('UNKNOWN_SERVICE', 'UNKNOWN', 'Unknown Jarvis service.') };
  }
  const meta = serviceRecord(id)!;
  if (!meta.startAllowed) {
    return { ok: false, result: unavailable('START_NOT_SUPPORTED', 'UNKNOWN', `${meta.displayName} cannot be started from Jarvis.`) };
  }
  return { ok: true, id, meta };
}

function requireStoppable(id: string): { ok: true; id: JarvisServiceId; meta: JarvisServiceRecord } | { ok: false; result: ServiceOpResult } {
  if (!isJarvisServiceId(id)) {
    return { ok: false, result: unavailable('UNKNOWN_SERVICE', 'UNKNOWN', 'Unknown Jarvis service.') };
  }
  const meta = serviceRecord(id)!;
  if (!meta.stopAllowed) {
    return { ok: false, result: unavailable('STOP_NOT_SUPPORTED', 'UNKNOWN', `${meta.displayName} cannot be stopped from Jarvis.`) };
  }
  return { ok: true, id, meta };
}

function requireRestartable(id: string): { ok: true; id: JarvisServiceId; meta: JarvisServiceRecord } | { ok: false; result: ServiceOpResult } {
  if (!isJarvisServiceId(id)) {
    return { ok: false, result: unavailable('UNKNOWN_SERVICE', 'UNKNOWN', 'Unknown Jarvis service.') };
  }
  const meta = serviceRecord(id)!;
  if (!meta.restartAllowed) {
    return { ok: false, result: unavailable('RESTART_NOT_SUPPORTED', 'UNKNOWN', `${meta.displayName} cannot be restarted from Jarvis.`) };
  }
  return { ok: true, id, meta };
}

function done(code: string, lifecycle: JarvisServiceLifecycle, summary: string, health?: JarvisServiceHealth): ServiceOpResult {
  return { status: 'completed', code, lifecycle, summary, health };
}

function failed(code: string, lifecycle: JarvisServiceLifecycle, summary: string): ServiceOpResult {
  return { status: 'failed', code, lifecycle, summary, health: 'degraded' };
}

function unavailable(code: string, lifecycle: JarvisServiceLifecycle, summary: string): ServiceOpResult {
  return { status: 'unavailable', code, lifecycle, summary };
}

function killOwned(child: ChildProcess): Promise<ServiceAdapterResult> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: ServiceAdapterResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, errorCode: 'TIMEOUT', message: 'Stop timed out.' }), STOP_WAIT_MS);
    child.once('exit', () => {
      clearTimeout(timer);
      finish({ ok: true });
    });
    const killed = child.kill();
    if (!killed && child.exitCode !== null) {
      clearTimeout(timer);
      finish({ ok: true });
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(value => {
      clearTimeout(timer);
      resolve(value);
    }).catch(() => {
      clearTimeout(timer);
      resolve(fallback);
    });
  });
}
