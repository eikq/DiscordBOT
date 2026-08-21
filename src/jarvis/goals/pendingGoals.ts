import { createHash } from 'node:crypto';
import { parseScheduleText } from '../automation/parseSchedule';
import type { CapabilityHost } from '../capabilities/types';
import type { JarvisEventBus } from '../security/eventBus';
import { looksLikeSecret, redactSecrets } from '../security/redaction';
import { createDefaultGoalCatalog, type GoalCatalog } from './catalog';
import type {
  ContinuePendingGoalInput,
  PendingGoalContinuation,
  PendingGoalRecord,
} from './pendingTypes';
import { PendingGoalStore } from './pendingStore';
import { resolveOwnerGoal } from './resolver';
import { validateAdapterAuthorityBoundary } from './schema';
import type { GoalResolution } from './types';

export type PendingGoalCoordinatorOptions = {
  store?: PendingGoalStore;
  catalog?: GoalCatalog;
  host?: () => CapabilityHost | undefined;
  events?: JarvisEventBus;
  now?: () => number;
  timeZone?: () => string;
};

export class PendingGoalCoordinator {
  public readonly store: PendingGoalStore;
  private readonly catalog: GoalCatalog;
  private readonly host: () => CapabilityHost | undefined;
  private readonly events?: JarvisEventBus;
  private readonly now: () => number;
  private readonly timeZone: () => string;

  constructor(options: PendingGoalCoordinatorOptions = {}) {
    this.store = options.store ?? new PendingGoalStore({ now: options.now });
    this.catalog = options.catalog ?? createDefaultGoalCatalog();
    this.host = options.host ?? (() => undefined);
    this.events = options.events;
    this.now = options.now ?? (() => Date.now());
    this.timeZone = options.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }

  public create(input: {
    sessionId: string;
    ownerIntent: string;
    resolution: GoalResolution;
    workTaskId?: string;
  }): PendingGoalRecord {
    if (input.resolution.status !== 'NEEDS_INPUT' || !input.resolution.goalId || !input.resolution.scope) {
      throw new Error('Only a declared goal with missing inputs can become pending.');
    }
    const definition = this.catalog.get(input.resolution.goalId);
    if (!definition) throw new Error('Pending goal must reference the authoritative GoalCatalog.');
    const selected = input.resolution.routes.find(route => route.id === input.resolution.selectedRouteId);
    const adapterId = selected?.steps.find(step => step.adapterId)?.adapterId
      ?? input.resolution.routes.flatMap(route => route.steps).find(step => step.adapterId)?.adapterId;
    const record = this.store.create({
      goalId: definition.id,
      goalVersion: definition.version ?? 1,
      sessionId: input.sessionId,
      originalOwnerIntent: redactSecrets(input.ownerIntent).slice(0, 1_000),
      validatedInputs: structuredClone(input.resolution.extractedInputs),
      missingFields: [...input.resolution.missingInputs],
      selectedRouteId: input.resolution.selectedRouteId,
      adapterId,
      scope: input.resolution.scope,
      maturity: definition.maturity,
      evidence: [...input.resolution.evidence, 'pending-context:not-authority'],
      workTaskId: input.workTaskId,
      continuationReceipts: [],
    });
    this.events?.emit('GOAL_WAITING_INPUT', input.resolution.smallestOwnerQuestion || 'Owner input is required.', {
      pendingGoalId: record.pendingGoalId,
      goalId: record.goalId,
      missingFields: record.missingFields,
      expiresAt: record.expiresAt,
    }, 'info', { taskId: record.workTaskId, visualState: 'WAITING_PERMISSION' });
    return record;
  }

  public async continue(input: ContinuePendingGoalInput): Promise<PendingGoalContinuation> {
    const selected = this.select(input);
    if ('status' in selected) return selected;
    let record = selected.record;
    const reply = input.ownerReply.trim();
    if (!reply) return rejected(record, 'The continuation reply is empty.');
    const receipt = continuationReceipt(record.pendingGoalId, input.idempotencyKey || reply);
    if (record.continuationReceiptHash === receipt || record.continuationReceipts?.includes(receipt)) {
      if (record.state === 'RESUMING') return existing('ALREADY_RESUMING', record);
      if (record.state === 'RESOLVED') return existing('ALREADY_RESOLVED', record);
      if (record.state === 'READY_TO_RESUME') return existing('READY_TO_RESUME', record);
    }
    if (normalizeReply(reply) === normalizeReply(record.originalOwnerIntent)) {
      const definition = this.catalog.get(record.goalId);
      const field = record.missingFields[0];
      const question = definition?.requiredInputs.find(item => item.id === field)?.smallestQuestion;
      return {
        status: 'STILL_WAITING',
        pendingGoal: record,
        reason: 'The original request was repeated; no new field or execution authority was inferred.',
        question: question || `Please provide ${field || 'the requested input'}.`,
        changedFields: [],
        revision: false,
      };
    }
    if (isCancelReply(reply)) {
      record.state = 'CANCELLED';
      record.continuationReceiptHash = receipt;
      record.continuationReceipts = appendReceipt(record.continuationReceipts, receipt);
      record = this.store.save(record);
      this.events?.emit('GOAL_CANCELLED', 'The owner cancelled the pending goal.', {
        pendingGoalId: record.pendingGoalId,
        goalId: record.goalId,
      }, 'info', { taskId: record.workTaskId });
      return { status: 'CANCELLED', pendingGoal: record, reason: 'The owner cancelled the pending goal.', changedFields: [], revision: false };
    }

    const currentDefinition = this.catalog.get(record.goalId);
    if (!currentDefinition || (currentDefinition.version ?? 1) !== record.goalVersion) {
      record.state = 'INVALIDATED';
      record = this.store.save(record);
      this.events?.emit('GOAL_CONTINUATION_REJECTED', 'The declared goal changed while waiting and must be resolved again.', {
        pendingGoalId: record.pendingGoalId,
        goalId: record.goalId,
        recordedVersion: record.goalVersion,
        currentVersion: currentDefinition?.version,
      }, 'warn', { taskId: record.workTaskId });
      return {
        status: 'REJECTED',
        pendingGoal: record,
        reason: 'The pending goal definition changed while waiting. Please restate the objective so current rules can resolve it safely.',
        changedFields: [],
        revision: false,
      };
    }

    const explicitRevision = isRevisionReply(reply);
    const drift = await this.detectDrift(record, reply);
    if (drift) {
      this.events?.emit('GOAL_CONTINUATION_REJECTED', 'The reply appears to start a different goal.', {
        pendingGoalId: record.pendingGoalId,
        expectedGoalId: record.goalId,
        suggestedGoalId: drift,
      }, 'warn', { taskId: record.workTaskId });
      return {
        status: 'GOAL_DRIFT',
        pendingGoal: record,
        reason: `This looks like a different goal (${drift}); the pending ${record.goalId} goal was not changed or executed.`,
        question: 'Should I cancel the pending goal and start the new request?',
        changedFields: [],
        revision: false,
      };
    }

    const field = record.missingFields[0];
    if (!field) return rejected(record, 'The pending goal no longer declares a missing field.');
    const adapted = adaptMissingField({
      goalId: record.goalId,
      field,
      ownerReply: reply,
      originalOwnerIntent: record.originalOwnerIntent,
      now: this.now(),
      timeZone: this.timeZone(),
    });
    if (adapted.ok === false) {
      this.events?.emit('GOAL_CONTINUATION_REJECTED', adapted.reason, {
        pendingGoalId: record.pendingGoalId,
        goalId: record.goalId,
        field,
      }, 'warn', { taskId: record.workTaskId });
      return { status: 'REJECTED', pendingGoal: record, reason: adapted.reason, question: adapted.question, changedFields: [], revision: false };
    }
    const authority = validateAdapterAuthorityBoundary({ [field]: adapted.value });
    if (authority.ok === false) return rejected(record, 'The reply cannot add credentials or execution authority to a pending goal.');
    const merged = { ...record.validatedInputs, [field]: adapted.value };
    const resolution = await resolveOwnerGoal(record.originalOwnerIntent, {
      catalog: this.catalog,
      host: this.host(),
      suggestion: { goalId: record.goalId, confidence: 1, extractedFields: merged },
    });
    if (resolution.goalId !== record.goalId) return rejected(record, 'Authoritative revalidation did not preserve the pending goal identity.');

    record.validatedInputs = structuredClone(resolution.extractedInputs);
    record.missingFields = [...resolution.missingInputs];
    record.selectedRouteId = resolution.selectedRouteId;
    record.scope = resolution.scope ?? record.scope;
    record.resolvedGoal = structuredClone(resolution);
    record.continuationReceiptHash = receipt;
    record.continuationReceipts = appendReceipt(record.continuationReceipts, receipt);
    record.revision += explicitRevision ? 1 : 0;
    record.evidence = [...record.evidence, `continuation-field:${field}`, explicitRevision ? `goal-revision:${record.revision}` : 'goal-continuation:validated'];

    this.events?.emit('GOAL_INPUT_RECEIVED', `Owner supplied ${field}.`, {
      pendingGoalId: record.pendingGoalId,
      goalId: record.goalId,
      field,
    }, 'info', { taskId: record.workTaskId });
    this.events?.emit(explicitRevision ? 'GOAL_REVISED' : 'GOAL_CONTINUATION_VALIDATED', explicitRevision
      ? 'The owner explicitly revised the pending goal input.'
      : 'The pending goal input passed typed validation.', {
      pendingGoalId: record.pendingGoalId,
      goalId: record.goalId,
      changedFields: [field],
    }, 'info', { taskId: record.workTaskId });

    if (resolution.status === 'NEEDS_INPUT') {
      record.state = 'WAITING_OWNER_INPUT';
      record = this.store.save(record);
      return {
        status: 'STILL_WAITING',
        pendingGoal: record,
        resolution,
        reason: 'The supplied field is valid; one more declared input is still required.',
        question: resolution.smallestOwnerQuestion,
        changedFields: [field],
        revision: explicitRevision,
      };
    }
    if (resolution.status !== 'RESOLVED') {
      record.state = 'RESOLVED';
      record = this.store.save(record);
      return {
        status: 'BLOCKED',
        pendingGoal: record,
        resolution,
        reason: resolution.status === 'NEEDS_OWNER_DECISION'
          ? 'The missing input is valid, but current policy still requires a separate owner decision.'
          : 'The missing input is valid, but current capability evidence does not provide an executable route.',
        question: resolution.smallestOwnerQuestion,
        changedFields: [field],
        revision: explicitRevision,
      };
    }
    record.state = 'READY_TO_RESUME';
    record = this.store.save(record);
    return {
      status: 'READY_TO_RESUME',
      pendingGoal: record,
      resolution,
      reason: 'The same declared goal is ready for current policy and capability checks.',
      changedFields: [field],
      revision: explicitRevision,
    };
  }

  public markResuming(pendingGoalId: string, workTaskId: string): PendingGoalRecord {
    let record = this.require(pendingGoalId);
    if (record.state === 'RESOLVED') return record;
    record.state = 'RESUMING';
    record.workTaskId = workTaskId;
    record = this.store.save(record);
    this.events?.emit('GOAL_RESUMED', 'The validated pending goal resumed through WorkAgent.', {
      pendingGoalId,
      goalId: record.goalId,
    }, 'info', { taskId: workTaskId, visualState: 'PLANNING' });
    return record;
  }

  public attachWorkTask(pendingGoalId: string, workTaskId: string): PendingGoalRecord {
    let record = this.require(pendingGoalId);
    record.workTaskId = workTaskId;
    record = this.store.save(record);
    return record;
  }

  public markResolved(pendingGoalId: string, workTaskId: string): PendingGoalRecord {
    let record = this.require(pendingGoalId);
    record.state = 'RESOLVED';
    record.workTaskId = workTaskId;
    record = this.store.save(record);
    return record;
  }

  public expireForSession(sessionId: string): PendingGoalRecord[] {
    return this.expireRecords(this.store.list(sessionId));
  }

  public expireAll(): PendingGoalRecord[] {
    return this.expireRecords(this.store.list());
  }

  private expireRecords(records: PendingGoalRecord[]): PendingGoalRecord[] {
    const expired: PendingGoalRecord[] = [];
    for (let record of records.filter(item => item.state === 'EXPIRED')) {
      if (record.evidence.includes('goal-expiry:event-recorded')) continue;
      record.evidence = [...record.evidence, 'goal-expiry:event-recorded'];
      record = this.store.save(record);
      this.events?.emit('GOAL_EXPIRED', 'A pending goal expired without execution.', {
        pendingGoalId: record.pendingGoalId,
        goalId: record.goalId,
      }, 'info', { taskId: record.workTaskId });
      expired.push(record);
    }
    return expired;
  }

  private select(input: ContinuePendingGoalInput): { record: PendingGoalRecord } | PendingGoalContinuation {
    if (input.pendingGoalId) {
      const record = this.store.get(input.pendingGoalId);
      if (!record) return { status: 'NO_PENDING_GOAL', reason: 'No pending goal matches that identifier.', changedFields: [], revision: false };
      if (record.state === 'EXPIRED') return { status: 'EXPIRED', pendingGoal: record, reason: 'The pending goal expired and cannot consume this reply.', changedFields: [], revision: false };
      if (record.sessionId !== input.sessionId && !input.explicitSelection) {
        return { status: 'NO_PENDING_GOAL', reason: 'A pending goal from another session requires explicit owner selection.', changedFields: [], revision: false };
      }
      if (!['WAITING_OWNER_INPUT', 'READY_TO_RESUME', 'RESUMING', 'RESOLVED'].includes(record.state)) {
        return { status: record.state === 'CANCELLED' ? 'CANCELLED' : 'NO_PENDING_GOAL', pendingGoal: record, reason: `Pending goal is ${record.state}.`, changedFields: [], revision: false };
      }
      return { record };
    }
    const candidates = this.store.waiting(input.sessionId);
    if (candidates.length === 0) return { status: 'NO_PENDING_GOAL', reason: 'This session has no pending goal expecting owner input.', changedFields: [], revision: false };
    if (candidates.length > 1) {
      return {
        status: 'NEEDS_DISAMBIGUATION',
        reason: 'More than one pending goal could consume this reply; explicit owner selection is required.',
        changedFields: [],
        revision: false,
        candidates: candidates.map(record => ({
          pendingGoalId: record.pendingGoalId,
          goalId: record.goalId,
          question: record.resolvedGoal?.smallestOwnerQuestion || `Provide ${record.missingFields[0] || 'the requested input'}.`,
          expiresAt: record.expiresAt,
        })),
      };
    }
    return { record: candidates[0] };
  }

  private async detectDrift(record: PendingGoalRecord, reply: string): Promise<string | undefined> {
    if (isRevisionReply(reply) && !hasGoalCue(reply)) return undefined;
    if (!hasGoalCue(reply)) return undefined;
    const proposed = await resolveOwnerGoal(reply, { catalog: this.catalog, host: this.host() });
    return proposed.goalId && proposed.goalId !== record.goalId ? proposed.goalId : undefined;
  }

  private require(id: string): PendingGoalRecord {
    const record = this.store.get(id);
    if (!record) throw new Error('Unknown pending goal.');
    return record;
  }
}

function adaptMissingField(input: {
  goalId: string;
  field: string;
  ownerReply: string;
  originalOwnerIntent: string;
  now: number;
  timeZone: string;
}): { ok: true; value: unknown } | { ok: false; reason: string; question?: string } {
  const raw = input.ownerReply.trim();
  if (containsAuthorityInjection(raw)) return { ok: false, reason: 'Continuation input cannot set permission, capability, privilege, credential, risk, or execution fields.' };
  if (looksLikeSecret(raw)) return { ok: false, reason: 'Secret-like material cannot be stored in pending goal context.' };
  if (input.field === 'whenText') {
    const combined = combineReminderDateContext(input.originalOwnerIntent, raw);
    const parsed = parseScheduleText(combined, input.now, input.timeZone);
    if (parsed.ok === false) return { ok: false, reason: parsed.userMessage, question: parsed.userMessage };
    return { ok: true, value: combined.slice(0, 400) };
  }
  if (input.field === 'scope') {
    if (/workspace|project|repo|local files?|approved workspace|โปรเจกต์|ไฟล์ในเครื่อง/iu.test(raw)) return { ok: true, value: 'WORKSPACE' };
    if (/public web|web|internet|online sources?|เว็บ|อินเทอร์เน็ต/iu.test(raw)) return { ok: true, value: 'PUBLIC_WEB' };
    return { ok: false, reason: 'The scope must be the approved workspace or public web.', question: 'Do you mean public web or your approved workspace?' };
  }
  if (input.field === 'deviceIdentity') {
    if (/https?:\/\/|rtsp:\/\/|password|credential|token|api.?key|username/iu.test(raw)) {
      return { ok: false, reason: 'Provide only the camera or NVR brand/model; credentials and connection URLs are not accepted here.' };
    }
    return bounded(raw, 160, 'Camera/NVR brand and model are required.');
  }
  if (input.field === 'documentId') {
    const id = raw.match(/\bdoc_[a-f0-9]{24}\b/iu)?.[0];
    return id ? { ok: true, value: id } : { ok: false, reason: 'That is not an indexed document reference.', question: 'Which indexed document should I analyze?' };
  }
  if (input.field === 'title') return bounded(raw.replace(/^(?:about|to)\s+/iu, ''), 200, 'Reminder text is required.');
  if (input.field === 'query') return bounded(raw, 200, 'A search or research query is required.');
  return { ok: false, reason: `No trusted continuation adapter is registered for ${input.goalId}.${input.field}.` };
}

function bounded(value: string, max: number, reason: string): { ok: true; value: string } | { ok: false; reason: string } {
  const normalized = value.trim().slice(0, max);
  return normalized ? { ok: true, value: normalized } : { ok: false, reason };
}

function combineReminderDateContext(original: string, reply: string): string {
  if (/tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|พรุ่งนี้|วันนี้|จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์/iu.test(reply)) return reply;
  const context = original.match(/\b(?:tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|(?:พรุ่งนี้|วันนี้|วัน?จันทร์|วัน?อังคาร|วัน?พุธ|วัน?พฤหัส(?:บดี)?|วัน?ศุกร์|วัน?เสาร์|วัน?อาทิตย์)/iu)?.[0];
  return context ? `${context} ${reply}` : reply;
}

function isCancelReply(value: string): boolean {
  return /^(?:never mind|nevermind|cancel(?: that| it)?|forget it|stop that|ไม่ต้องแล้ว|ยกเลิก(?:อันนั้น)?|ช่างมัน)[.!]?$/iu.test(value.trim());
}

function isRevisionReply(value: string): boolean {
  return /^(?:actually|change it|make it|instead|correction|จริงๆ|จริง ๆ|เปลี่ยน|แก้เป็น)\b/iu.test(value.trim());
}

function hasGoalCue(value: string): boolean {
  return /\b(?:research|search|remind|connect|open|analy[sz]e|summari[sz]e|check)\b|ค้น|วิจัย|เตือน|เชื่อม|เปิด|วิเคราะห์|สรุป/iu.test(value);
}

function containsAuthorityInjection(value: string): boolean {
  const parsed = tryJson(value);
  if (parsed !== undefined && validateAdapterAuthorityBoundary(parsed).ok === false) return true;
  return /\b(?:capability_?id|permission|privilege|confirmation|proposal_?id|admin|sudo|shell|command|executable|risk_?level|authorization|credential|password|api_?key|token)\b\s*[:=]/iu.test(value);
}

function tryJson(value: string): unknown {
  if (!/^[{[]/u.test(value.trim())) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function continuationReceipt(pendingGoalId: string, value: string): string {
  return createHash('sha256').update(`${pendingGoalId}\0${normalizeReply(value)}`).digest('hex');
}

function appendReceipt(current: string[] | undefined, receipt: string): string[] {
  return [...new Set([...(current ?? []), receipt])].slice(-8);
}

function normalizeReply(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function rejected(record: PendingGoalRecord, reason: string): PendingGoalContinuation {
  return { status: 'REJECTED', pendingGoal: record, reason, changedFields: [], revision: false };
}

function existing(status: Extract<PendingGoalContinuation['status'], 'ALREADY_RESUMING' | 'ALREADY_RESOLVED' | 'READY_TO_RESUME'>, record: PendingGoalRecord): PendingGoalContinuation {
  return { status, pendingGoal: record, resolution: record.resolvedGoal, reason: 'This continuation was already accepted; no duplicate mutation was created.', changedFields: [], revision: record.revision > 0 };
}
