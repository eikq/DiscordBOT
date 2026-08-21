import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { JarvisEventBus } from '../security/eventBus';
import { looksLikeSecret } from '../security/redaction';
import { cancelledCapabilityResult } from '../capabilities/cancellation';
import type {
  CapabilityHandler,
  CapabilityHost,
  CapabilityInvocationContext,
  CapabilityResult,
} from '../capabilities/types';
import type { VerificationRegistry } from '../safety/verificationRegistry';
import type { VerificationRecord } from '../safety/types';
import { RecoveryCheckpointStore } from './checkpointStore';

export const RECOVERY_SANDBOX_MUTATE = 'operator.sandbox.writeConfig';
export const RECOVERY_SANDBOX_ROLLBACK = 'operator.sandbox.rollbackConfig';
export const RECOVERY_SANDBOX_TARGET = 'jarvis-owned:recovery-sandbox/config.json';
export const RECOVERY_SANDBOX_MUTATION_VERIFIER = 'operator.sandbox.config-state';
export const RECOVERY_SANDBOX_ROLLBACK_VERIFIER = 'operator.sandbox.rollback-state';

type SandboxOperationState = 'CHECKPOINTED' | 'COMMITTED' | 'VERIFIED' | 'CANCELLED' | 'ROLLED_BACK';
type SandboxOperation = {
  operationId: string;
  inputDigest: string;
  checkpointId: string;
  expectedDigest: string;
  priorDigest: string;
  state: SandboxOperationState;
  updatedAt: string;
};
type SandboxLedger = { version: 1; operations: SandboxOperation[] };

export type RecoverySandboxDeps = {
  root: string;
  checkpoints: RecoveryCheckpointStore;
  verification: VerificationRegistry;
  events?: JarvisEventBus;
  now?: () => number;
  /** Test-only scheduling seam; production leaves this undefined. */
  beforeCommit?: (signal: AbortSignal) => Promise<void>;
};

export function registerRecoverySandboxCapabilities(host: CapabilityHost, deps: RecoverySandboxDeps): void {
  const runtime = new RecoverySandboxRuntime(deps);
  if (!deps.verification.has(RECOVERY_SANDBOX_MUTATION_VERIFIER)) {
    deps.verification.register(RECOVERY_SANDBOX_MUTATION_VERIFIER, input => runtime.verifyMutation(input.result, input.now));
  }
  if (!deps.verification.has(RECOVERY_SANDBOX_ROLLBACK_VERIFIER)) {
    deps.verification.register(RECOVERY_SANDBOX_ROLLBACK_VERIFIER, input => runtime.verifyRollback(input.result, input.now));
  }
  host.register(runtime.mutationHandler());
  host.register(runtime.rollbackHandler());
}

class RecoverySandboxRuntime {
  private readonly now: () => number;
  private readonly configPath: string;
  private readonly ledgerPath: string;

  public constructor(private readonly deps: RecoverySandboxDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.configPath = path.join(deps.root, 'sandbox', 'config.json');
    this.ledgerPath = path.join(deps.root, 'sandbox', 'operations.json');
  }

  public mutationHandler(): CapabilityHandler {
    return {
      descriptor: () => ({
        id: RECOVERY_SANDBOX_MUTATE,
        description: 'Write one disposable value inside the Jarvis-owned recovery acceptance sandbox.',
        inputSchema: {
          type: 'object',
          required: ['operationId', 'value'],
          properties: { operationId: { type: 'string' }, value: { type: 'string' } },
          additionalProperties: false,
        },
        outputSchema: { type: 'object' },
        sideEffect: 'write',
        requiredService: 'jarvis-core',
        providerKind: 'local',
        timeoutMs: 5_000,
        untrustedOutput: false,
        cancellation: { support: 'cooperative' },
        intelligence: {
          maturity: 'REAL',
          executionMode: 'REAL',
          permission: 'OWNER_REQUIRED',
          localAcceptance: 'NOT_REQUIRED',
          distribution: ['CORE'],
          knownLimitations: ['Only the fixed Jarvis-owned recovery acceptance sandbox may be changed.'],
        },
        effects: [{
          kind: 'MODIFY',
          description: 'Replace one disposable Jarvis-owned sandbox configuration value.',
          destructive: false,
          reversible: true,
          privilege: 'owner_approval',
          riskLevel: 'LOW',
          targets: [RECOVERY_SANDBOX_TARGET],
          estimatedAffectedObjects: 1,
        }],
        verification: {
          mode: 'registered_postcondition',
          verifierId: RECOVERY_SANDBOX_MUTATION_VERIFIER,
          description: 'Re-read the sandbox file and compare its SHA-256 digest with the committed typed value.',
        },
        rollback: {
          mode: 'recorded_checkpoint',
          strategy: 'Restore the integrity-checked prior sandbox state.',
          checkpointField: 'checkpointId',
          priorStateField: 'priorStateRef',
          recoveryInstructions: 'Request the typed sandbox rollback capability with this checkpoint id.',
        },
      }),
      availability: async () => ({ id: RECOVERY_SANDBOX_MUTATE, availability: 'up', degraded: false }),
      invoke: (input, context) => this.mutate(input, context),
    };
  }

  public rollbackHandler(): CapabilityHandler {
    return {
      descriptor: () => ({
        id: RECOVERY_SANDBOX_ROLLBACK,
        description: 'Restore one recorded Jarvis recovery-sandbox checkpoint.',
        inputSchema: {
          type: 'object',
          required: ['checkpointId', 'rollbackId'],
          properties: { checkpointId: { type: 'string' }, rollbackId: { type: 'string' } },
          additionalProperties: false,
        },
        outputSchema: { type: 'object' },
        sideEffect: 'write',
        requiredService: 'jarvis-core',
        providerKind: 'local',
        timeoutMs: 5_000,
        untrustedOutput: false,
        cancellation: { support: 'cooperative' },
        intelligence: {
          maturity: 'REAL',
          executionMode: 'REAL',
          permission: 'OWNER_REQUIRED',
          localAcceptance: 'NOT_REQUIRED',
          distribution: ['CORE'],
          requirements: { dependencies: [RECOVERY_SANDBOX_MUTATE] },
          knownLimitations: ['Only an integrity-checked checkpoint for the fixed sandbox target may be restored.'],
        },
        effects: [{
          kind: 'MODIFY',
          description: 'Restore or remove one fixed sandbox file to its recorded prior state.',
          destructive: false,
          reversible: false,
          privilege: 'owner_approval',
          riskLevel: 'LOW',
          targets: [RECOVERY_SANDBOX_TARGET],
          estimatedAffectedObjects: 1,
        }],
        verification: {
          mode: 'registered_postcondition',
          verifierId: RECOVERY_SANDBOX_ROLLBACK_VERIFIER,
          description: 'Re-read the sandbox target and compare it with the checkpoint prior-state digest.',
        },
        rollback: {
          mode: 'not_required',
          strategy: 'This bounded action consumes the selected recovery checkpoint after verified restoration.',
        },
      }),
      availability: async () => ({ id: RECOVERY_SANDBOX_ROLLBACK, availability: 'up', degraded: false }),
      invoke: (input, context) => this.rollback(input, context),
    };
  }

  public verifyMutation(result: CapabilityResult, now: number): VerificationRecord {
    const expectedDigest = stringField(result.structured.expectedDigest);
    const actualDigest = digestCurrentFile(this.configPath);
    const passed = result.status === 'ok' && Boolean(expectedDigest) && actualDigest === expectedDigest;
    if (passed) this.updateOperationState(stringField(result.structured.operationId), 'VERIFIED');
    return verificationRecord({
      passed,
      now,
      strategy: 'Deterministic sandbox file digest postcondition.',
      requested: 'Persist the typed sandbox configuration value.',
      executed: 'Re-read the fixed Jarvis-owned sandbox file after mutation.',
      evidence: passed ? [`Sandbox target digest matched ${expectedDigest}.`] : [],
      failure: passed ? undefined : 'Sandbox target digest did not match the committed value.',
    });
  }

  public verifyRollback(result: CapabilityResult, now: number): VerificationRecord {
    const restoredDigest = stringField(result.structured.restoredDigest);
    const actualDigest = digestCurrentFile(this.configPath);
    const passed = result.status === 'ok'
      && result.structured.rollbackVerification === 'ROLLBACK_VERIFIED'
      && Boolean(restoredDigest)
      && actualDigest === restoredDigest;
    return verificationRecord({
      passed,
      now,
      strategy: 'Deterministic rollback state digest postcondition.',
      requested: 'Restore the checkpoint prior state.',
      executed: 'Re-read the fixed sandbox target after rollback.',
      evidence: passed ? [`Restored target digest matched ${restoredDigest}.`] : [],
      failure: passed ? undefined : 'Restored state did not match the checkpoint digest.',
    });
  }

  private async mutate(input: Record<string, unknown>, context?: CapabilityInvocationContext): Promise<CapabilityResult> {
    const parsed = validateMutationInput(input);
    if (parsed.ok === false) return invalidResult(RECOVERY_SANDBOX_MUTATE, parsed.error);
    const signal = context?.signal ?? new AbortController().signal;
    const inputDigest = sha256(stableJson(parsed.value));
    const expectedContent = `${JSON.stringify({ value: parsed.value.value, updatedBy: parsed.value.operationId }, null, 2)}\n`;
    const expectedDigest = sha256(expectedContent);
    let ledger: SandboxLedger;
    try {
      ledger = this.loadLedger();
    } catch {
      return unknownOutcome(RECOVERY_SANDBOX_MUTATE, 'The persistent mutation ledger is invalid; execution remains blocked.');
    }
    const existing = ledger.operations.find(item => item.operationId === parsed.value.operationId);
    if (existing) {
      if (existing.inputDigest !== inputDigest) return invalidResult(RECOVERY_SANDBOX_MUTATE, 'Duplicate operationId has different input.');
      if ((existing.state === 'COMMITTED' || existing.state === 'VERIFIED') && digestCurrentFile(this.configPath) === existing.expectedDigest) {
        return mutationOk(existing, this.deps.checkpoints.get(existing.checkpointId)?.priorStateRef);
      }
      if (existing.state === 'ROLLED_BACK') return invalidResult(RECOVERY_SANDBOX_MUTATE, 'This operation was already rolled back; use a new operationId.');
      if (existing.state === 'CANCELLED') return invalidResult(RECOVERY_SANDBOX_MUTATE, 'This operation was cancelled; use a new operationId.');
      if (digestCurrentFile(this.configPath) !== existing.priorDigest) {
        return unknownOutcome(RECOVERY_SANDBOX_MUTATE, 'Interrupted mutation state does not match its checkpoint or intended result.');
      }
    }

    const prior = currentState(this.configPath);
    const checkpoint = existing
      ? this.deps.checkpoints.get(existing.checkpointId)
      : this.deps.checkpoints.create({
          capabilityId: RECOVERY_SANDBOX_MUTATE,
          taskId: context?.sessionId,
          stepId: context?.requestId,
          scope: [RECOVERY_SANDBOX_TARGET],
          affectedTargets: [RECOVERY_SANDBOX_TARGET],
          priorState: prior,
        });
    if (!checkpoint) return unknownOutcome(RECOVERY_SANDBOX_MUTATE, 'Recovery checkpoint is unavailable.');
    const operation: SandboxOperation = existing ?? {
      operationId: parsed.value.operationId,
      inputDigest,
      checkpointId: checkpoint.checkpointId,
      expectedDigest,
      priorDigest: prior.digest,
      state: 'CHECKPOINTED',
      updatedAt: new Date(this.now()).toISOString(),
    };
    if (!existing) {
      ledger.operations.push(operation);
      this.persistLedger(ledger);
      this.deps.events?.emit('CHECKPOINT_CREATED', 'Recovery checkpoint created before sandbox mutation.', {
        checkpointId: checkpoint.checkpointId,
        capabilityId: RECOVERY_SANDBOX_MUTATE,
        affectedTargets: [RECOVERY_SANDBOX_TARGET],
      });
    }

    await this.deps.beforeCommit?.(signal);
    if (signal.aborted) {
      operation.state = 'CANCELLED';
      operation.updatedAt = new Date(this.now()).toISOString();
      this.persistLedger(ledger);
      const cancelled = cancelledCapabilityResult({
        capabilityId: RECOVERY_SANDBOX_MUTATE,
        sideEffect: 'write',
        untrustedOutput: false,
        signal,
      });
      cancelled.structured.checkpointId = checkpoint.checkpointId;
      cancelled.structured.priorStateRef = checkpoint.priorStateRef;
      cancelled.structured.affectedTargets = [RECOVERY_SANDBOX_TARGET];
      return cancelled;
    }

    atomicWrite(this.configPath, expectedContent);
    operation.state = 'COMMITTED';
    operation.updatedAt = new Date(this.now()).toISOString();
    this.persistLedger(ledger);
    return mutationOk(operation, checkpoint.priorStateRef);
  }

  private async rollback(input: Record<string, unknown>, context?: CapabilityInvocationContext): Promise<CapabilityResult> {
    const parsed = validateRollbackInput(input);
    if (parsed.ok === false) return invalidResult(RECOVERY_SANDBOX_ROLLBACK, parsed.error);
    const signal = context?.signal ?? new AbortController().signal;
    this.deps.events?.emit('ROLLBACK_REQUESTED', 'Owner-authorized sandbox rollback requested.', {
      checkpointId: parsed.value.checkpointId,
      rollbackId: parsed.value.rollbackId,
    }, 'warn');
    const checkpoint = this.deps.checkpoints.get(parsed.value.checkpointId);
    if (!checkpoint || checkpoint.capabilityId !== RECOVERY_SANDBOX_MUTATE
      || checkpoint.affectedTargets.length !== 1
      || checkpoint.affectedTargets[0] !== RECOVERY_SANDBOX_TARGET) {
      return invalidResult(RECOVERY_SANDBOX_ROLLBACK, 'Checkpoint scope is invalid for this rollback capability.');
    }
    let recovery;
    try {
      recovery = this.deps.checkpoints.readPriorState(checkpoint.checkpointId);
    } catch (error) {
      return invalidResult(RECOVERY_SANDBOX_ROLLBACK, error instanceof Error ? error.message : 'Checkpoint is unavailable.');
    }
    const prior = parsePriorState(recovery.priorState);
    if (!prior) return invalidResult(RECOVERY_SANDBOX_ROLLBACK, 'Checkpoint prior state is invalid.');
    if (checkpoint.state === 'CONSUMED' && checkpoint.rollbackVerification === 'ROLLBACK_VERIFIED') {
      return rollbackOk(checkpoint.checkpointId, prior.digest, true);
    }
    if (signal.aborted) {
      return cancelledCapabilityResult({
        capabilityId: RECOVERY_SANDBOX_ROLLBACK,
        sideEffect: 'write',
        untrustedOutput: false,
        signal,
      });
    }
    this.deps.events?.emit('ROLLBACK_STARTED', 'Sandbox checkpoint restoration started.', {
      checkpointId: checkpoint.checkpointId,
      affectedTargets: [RECOVERY_SANDBOX_TARGET],
    }, 'warn');
    if (prior.exists && typeof prior.content === 'string') atomicWrite(this.configPath, prior.content);
    else if (fs.existsSync(this.configPath)) fs.unlinkSync(this.configPath);
    const restoredDigest = digestCurrentFile(this.configPath);
    const rollbackVerification = restoredDigest === prior.digest ? 'ROLLBACK_VERIFIED' as const : 'ROLLBACK_FAILED' as const;
    this.deps.checkpoints.markConsumed(checkpoint.checkpointId, rollbackVerification);
    if (rollbackVerification === 'ROLLBACK_VERIFIED') {
      try {
        const ledger = this.loadLedger();
        const operation = ledger.operations.find(item => item.checkpointId === checkpoint.checkpointId);
        if (operation) {
          operation.state = 'ROLLED_BACK';
          operation.updatedAt = new Date(this.now()).toISOString();
          this.persistLedger(ledger);
        }
      } catch {
        // Checkpoint consumption remains the rollback idempotency authority.
      }
    }
    this.deps.events?.emit('ROLLBACK_COMPLETED', 'Sandbox rollback execution completed.', {
      checkpointId: checkpoint.checkpointId,
      rollbackVerification,
    }, rollbackVerification === 'ROLLBACK_VERIFIED' ? 'info' : 'error');
    if (rollbackVerification === 'ROLLBACK_VERIFIED') {
      this.deps.events?.emit('ROLLBACK_VERIFIED', 'Sandbox prior state was independently restored.', {
        checkpointId: checkpoint.checkpointId,
        restoredDigest,
      });
      return rollbackOk(checkpoint.checkpointId, restoredDigest, false);
    }
    return unknownOutcome(RECOVERY_SANDBOX_ROLLBACK, 'Rollback code completed, but restored state did not verify.');
  }

  private loadLedger(): SandboxLedger {
    if (!fs.existsSync(this.ledgerPath)) return { version: 1, operations: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.ledgerPath, 'utf8')) as SandboxLedger;
      if (parsed.version !== 1 || !Array.isArray(parsed.operations) || !parsed.operations.every(validOperation)) {
        throw new Error('Invalid sandbox operation ledger.');
      }
      return parsed;
    } catch {
      throw Object.assign(new Error('Sandbox operation ledger could not be read safely.'), {
        reasonCode: 'MUTATION_LEDGER_INVALID',
      });
    }
  }

  private persistLedger(ledger: SandboxLedger): void {
    atomicWrite(this.ledgerPath, JSON.stringify({ version: 1, operations: ledger.operations.slice(-200) }, null, 2));
  }

  private updateOperationState(operationId: string | undefined, state: SandboxOperationState): void {
    if (!operationId) return;
    try {
      const ledger = this.loadLedger();
      const operation = ledger.operations.find(item => item.operationId === operationId);
      if (!operation) return;
      operation.state = state;
      operation.updatedAt = new Date(this.now()).toISOString();
      this.persistLedger(ledger);
    } catch {
      // A later duplicate request will fail closed on the invalid ledger.
    }
  }
}

function validateMutationInput(input: Record<string, unknown>): { ok: true; value: { operationId: string; value: string } } | { ok: false; error: string } {
  if (Object.keys(input).some(key => key !== 'operationId' && key !== 'value')) return { ok: false, error: 'Only operationId and value are allowed.' };
  if (typeof input.operationId !== 'string' || !/^[a-z0-9][a-z0-9_-]{7,63}$/u.test(input.operationId)) return { ok: false, error: 'Invalid operationId.' };
  if (typeof input.value !== 'string' || input.value.length < 1 || input.value.length > 160) return { ok: false, error: 'Sandbox value must be 1-160 characters.' };
  if (looksLikeSecret(input.value)) return { ok: false, error: 'Secret-like values are not allowed in the recovery sandbox.' };
  return { ok: true, value: { operationId: input.operationId, value: input.value } };
}

function validateRollbackInput(input: Record<string, unknown>): { ok: true; value: { checkpointId: string; rollbackId: string } } | { ok: false; error: string } {
  if (Object.keys(input).some(key => key !== 'checkpointId' && key !== 'rollbackId')) return { ok: false, error: 'Only checkpointId and rollbackId are allowed.' };
  if (typeof input.checkpointId !== 'string' || !/^checkpoint_[0-9a-f-]{36}$/u.test(input.checkpointId)) return { ok: false, error: 'Invalid checkpointId.' };
  if (typeof input.rollbackId !== 'string' || !/^[a-z0-9][a-z0-9_-]{7,63}$/u.test(input.rollbackId)) return { ok: false, error: 'Invalid rollbackId.' };
  return { ok: true, value: { checkpointId: input.checkpointId, rollbackId: input.rollbackId } };
}

function currentState(file: string): { exists: boolean; content?: string; digest: string } {
  if (!fs.existsSync(file)) return { exists: false, digest: missingDigest() };
  const content = fs.readFileSync(file, 'utf8');
  return { exists: true, content, digest: sha256(content) };
}

function parsePriorState(value: unknown): { exists: boolean; content?: string; digest: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.exists !== 'boolean' || typeof record.digest !== 'string') return undefined;
  if (record.exists && typeof record.content !== 'string') return undefined;
  return { exists: record.exists, ...(typeof record.content === 'string' ? { content: record.content } : {}), digest: record.digest };
}

function mutationOk(operation: SandboxOperation, priorStateRef?: string): CapabilityResult {
  return {
    capabilityId: RECOVERY_SANDBOX_MUTATE,
    status: 'ok',
    structured: {
      status: 'ok',
      operationId: operation.operationId,
      checkpointId: operation.checkpointId,
      priorStateRef,
      expectedDigest: operation.expectedDigest,
      affectedTargets: [RECOVERY_SANDBOX_TARGET],
      idempotent: operation.state === 'VERIFIED',
    },
    content: 'Sandbox configuration mutation committed; deterministic verification is pending.',
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
  };
}

function rollbackOk(checkpointId: string, restoredDigest: string, idempotent: boolean): CapabilityResult {
  return {
    capabilityId: RECOVERY_SANDBOX_ROLLBACK,
    status: 'ok',
    structured: {
      status: 'ok',
      checkpointId,
      restoredDigest,
      rollbackVerification: 'ROLLBACK_VERIFIED',
      affectedTargets: [RECOVERY_SANDBOX_TARGET],
      idempotent,
    },
    content: idempotent ? 'Sandbox rollback was already verified.' : 'Sandbox prior state restored and verified.',
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
  };
}

function invalidResult(capabilityId: string, error: string): CapabilityResult {
  return {
    capabilityId,
    status: 'rejected',
    structured: { status: 'rejected', reasonCode: 'INVALID_RECOVERY_REQUEST', error },
    content: error,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
    error,
  };
}

function unknownOutcome(capabilityId: string, error: string): CapabilityResult {
  return {
    capabilityId,
    status: 'error',
    structured: { status: 'error', reasonCode: 'MUTATION_OUTCOME_UNKNOWN', error, affectedTargets: [RECOVERY_SANDBOX_TARGET] },
    content: error,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
    error,
  };
}

function verificationRecord(input: {
  passed: boolean;
  now: number;
  strategy: string;
  requested: string;
  executed: string;
  evidence: string[];
  failure?: string;
}): VerificationRecord {
  return {
    state: input.passed ? 'VERIFIED' : 'FAILED_VERIFICATION',
    strategy: input.strategy,
    requested: input.requested,
    executed: input.executed,
    evidence: input.evidence,
    failedChecks: input.failure ? [input.failure] : [],
    verifiedAt: new Date(input.now).toISOString(),
  };
}

function digestCurrentFile(file: string): string {
  return fs.existsSync(file) ? sha256(fs.readFileSync(file, 'utf8')) : missingDigest();
}

function missingDigest(): string {
  return sha256('jarvis-recovery-sandbox:missing');
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
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

function validOperation(value: unknown): value is SandboxOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<SandboxOperation>;
  return typeof item.operationId === 'string'
    && typeof item.inputDigest === 'string'
    && typeof item.checkpointId === 'string'
    && typeof item.expectedDigest === 'string'
    && typeof item.priorDigest === 'string'
    && typeof item.updatedAt === 'string'
    && ['CHECKPOINTED', 'COMMITTED', 'VERIFIED', 'CANCELLED', 'ROLLED_BACK'].includes(String(item.state));
}
