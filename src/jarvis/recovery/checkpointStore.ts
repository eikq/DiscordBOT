import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { looksLikeSecret, redactDeep, redactSecrets } from '../security/redaction';
import type {
  CreateCheckpointInput,
  RecoveryCheckpoint,
  RollbackVerificationState,
} from './types';

type CheckpointInventory = { version: 1; checkpoints: RecoveryCheckpoint[] };

const DEFAULT_RETENTION_MS = 24 * 60 * 60_000;

/**
 * Integrity-checked recovery state under one Jarvis-owned root. Metadata never
 * contains approval tokens or raw filesystem authority.
 */
export class RecoveryCheckpointStore {
  private readonly inventoryPath: string;
  private readonly stateRoot: string;
  private readonly checkpoints = new Map<string, RecoveryCheckpoint>();

  public constructor(
    private readonly root: string,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.inventoryPath = path.join(root, 'checkpoints.json');
    this.stateRoot = path.join(root, 'state');
    this.load();
  }

  public create(input: CreateCheckpointInput): RecoveryCheckpoint {
    assertSafeMetadata(input);
    const serialized = stableJson(input.priorState);
    if (containsSecret(serialized)) {
      throw Object.assign(new Error('Checkpoint prior state contains secret-like material.'), {
        reasonCode: 'CHECKPOINT_SECRET_REJECTED',
      });
    }
    const checkpointId = `checkpoint_${randomUUID()}`;
    const digest = sha256(serialized);
    const createdAt = new Date(this.now()).toISOString();
    const retentionMs = Math.max(60_000, Math.min(input.retentionMs ?? DEFAULT_RETENTION_MS, 7 * DEFAULT_RETENTION_MS));
    const checkpoint: RecoveryCheckpoint = {
      checkpointId,
      capabilityId: input.capabilityId,
      ...(input.taskId ? { taskId: bounded(input.taskId, 180) } : {}),
      ...(input.stepId ? { stepId: bounded(input.stepId, 180) } : {}),
      createdAt,
      expiresAt: new Date(this.now() + retentionMs).toISOString(),
      scope: sanitizeList(input.scope),
      affectedTargets: sanitizeList(input.affectedTargets),
      priorStateRef: `checkpoint-state:${checkpointId}`,
      integrity: { algorithm: 'sha256', digest },
      state: 'CREATED',
    };
    fs.mkdirSync(this.stateRoot, { recursive: true });
    atomicWrite(this.statePath(checkpointId), serialized);
    checkpoint.state = 'AVAILABLE';
    this.checkpoints.set(checkpointId, checkpoint);
    this.persist();
    return clone(checkpoint);
  }

  public readPriorState(checkpointId: string): { checkpoint: RecoveryCheckpoint; priorState: unknown } {
    const checkpoint = this.require(checkpointId);
    this.refreshExpiry(checkpoint);
    if (checkpoint.state !== 'AVAILABLE' && checkpoint.state !== 'CONSUMED') {
      throw Object.assign(new Error(`Checkpoint is ${checkpoint.state}.`), { reasonCode: `CHECKPOINT_${checkpoint.state}` });
    }
    let serialized: string;
    try {
      serialized = fs.readFileSync(this.statePath(checkpoint.checkpointId), 'utf8');
    } catch {
      checkpoint.state = 'INVALID';
      this.persist();
      throw Object.assign(new Error('Checkpoint recovery state is missing.'), { reasonCode: 'CHECKPOINT_INVALID' });
    }
    if (sha256(serialized) !== checkpoint.integrity.digest) {
      checkpoint.state = 'INVALID';
      this.persist();
      throw Object.assign(new Error('Checkpoint integrity verification failed.'), { reasonCode: 'CHECKPOINT_INVALID' });
    }
    return { checkpoint: clone(checkpoint), priorState: JSON.parse(serialized) as unknown };
  }

  public markConsumed(checkpointId: string, verification: RollbackVerificationState): RecoveryCheckpoint {
    const checkpoint = this.require(checkpointId);
    if (checkpoint.state === 'CONSUMED') return clone(checkpoint);
    if (checkpoint.state !== 'AVAILABLE') {
      throw Object.assign(new Error(`Checkpoint is ${checkpoint.state}.`), { reasonCode: `CHECKPOINT_${checkpoint.state}` });
    }
    checkpoint.state = verification === 'ROLLBACK_VERIFIED' ? 'CONSUMED' : 'FAILED';
    checkpoint.consumedAt = new Date(this.now()).toISOString();
    checkpoint.rollbackVerification = verification;
    this.persist();
    return clone(checkpoint);
  }

  public get(checkpointId: string): RecoveryCheckpoint | undefined {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) return undefined;
    this.refreshExpiry(checkpoint);
    return clone(checkpoint);
  }

  public list(): RecoveryCheckpoint[] {
    for (const item of this.checkpoints.values()) this.refreshExpiry(item);
    return [...this.checkpoints.values()].map(clone);
  }

  private require(checkpointId: string): RecoveryCheckpoint {
    if (!/^checkpoint_[0-9a-f-]{36}$/u.test(checkpointId)) {
      throw Object.assign(new Error('Invalid checkpoint identifier.'), { reasonCode: 'CHECKPOINT_INVALID' });
    }
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) throw Object.assign(new Error('Unknown checkpoint.'), { reasonCode: 'CHECKPOINT_UNKNOWN' });
    return checkpoint;
  }

  private refreshExpiry(checkpoint: RecoveryCheckpoint): void {
    if (checkpoint.state !== 'AVAILABLE' || !checkpoint.expiresAt) return;
    if (Date.parse(checkpoint.expiresAt) > this.now()) return;
    checkpoint.state = 'EXPIRED';
    this.persist();
  }

  private statePath(checkpointId: string): string {
    return path.join(this.stateRoot, `${checkpointId}.json`);
  }

  private load(): void {
    if (!fs.existsSync(this.inventoryPath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.inventoryPath, 'utf8')) as CheckpointInventory;
      if (parsed.version !== 1 || !Array.isArray(parsed.checkpoints)) throw new Error('Invalid checkpoint inventory.');
      for (const checkpoint of parsed.checkpoints) {
        if (!validCheckpoint(checkpoint)) throw new Error('Invalid checkpoint metadata.');
        this.checkpoints.set(checkpoint.checkpointId, checkpoint);
      }
    } catch {
      // A corrupt recovery inventory cannot safely authorize rollback.
      this.checkpoints.clear();
    }
  }

  private persist(): void {
    const inventory: CheckpointInventory = { version: 1, checkpoints: [...this.checkpoints.values()] };
    atomicWrite(this.inventoryPath, JSON.stringify(inventory, null, 2));
  }
}

function assertSafeMetadata(input: CreateCheckpointInput): void {
  const metadata = JSON.stringify({
    capabilityId: input.capabilityId,
    taskId: input.taskId,
    stepId: input.stepId,
    scope: input.scope,
    affectedTargets: input.affectedTargets,
  });
  if (containsSecret(metadata)) {
    throw Object.assign(new Error('Checkpoint metadata contains secret-like material.'), {
      reasonCode: 'CHECKPOINT_SECRET_REJECTED',
    });
  }
}

function containsSecret(value: string): boolean {
  return looksLikeSecret(value) || JSON.stringify(redactDeep(JSON.parse(value) as unknown)) !== value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortDeep(value)) ?? 'null';
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, sortDeep(item)]));
}

function sanitizeList(values: string[]): string[] {
  return [...new Set(values.map(item => bounded(redactSecrets(item), 512)))].slice(0, 100);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function atomicWrite(file: string, value: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

function bounded(value: string, max: number): string {
  return value.slice(0, max);
}

function clone(value: RecoveryCheckpoint): RecoveryCheckpoint {
  return {
    ...value,
    scope: [...value.scope],
    affectedTargets: [...value.affectedTargets],
    integrity: { ...value.integrity },
  };
}

function validCheckpoint(value: unknown): value is RecoveryCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<RecoveryCheckpoint>;
  return typeof item.checkpointId === 'string'
    && /^checkpoint_[0-9a-f-]{36}$/u.test(item.checkpointId)
    && typeof item.capabilityId === 'string'
    && typeof item.createdAt === 'string'
    && Array.isArray(item.scope)
    && item.scope.every(entry => typeof entry === 'string')
    && Array.isArray(item.affectedTargets)
    && item.affectedTargets.every(entry => typeof entry === 'string')
    && typeof item.priorStateRef === 'string'
    && Boolean(item.integrity && item.integrity.algorithm === 'sha256' && typeof item.integrity.digest === 'string')
    && ['CREATED', 'AVAILABLE', 'CONSUMED', 'INVALID', 'EXPIRED', 'FAILED'].includes(String(item.state));
}
