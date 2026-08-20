import type { CapabilityHost, CapabilityResult } from '../capabilities/types';
import { capabilityPresentationFacts } from '../capabilities/capabilityFacts';
import { classifyFailure } from '../ops/errors';
import type { JarvisErrorCode } from '../ops/types';
import { RESEARCH_CURRENT, RESEARCH_SEARCH } from '../research/constants';
import { isBlockedCapabilityId, resolveStepCapability } from './capabilityResolve';
import type { PlanStep, WorkStepInvoker, WorkStepResult, WorkTask } from './types';

export type CapabilityInvokerOptions = {
  host?: CapabilityHost | (() => CapabilityHost | undefined);
  sessionId?: string;
  researchDepth?: () => string | undefined;
};

export function createCapabilityWorkInvoker(options: CapabilityInvokerOptions = {}): WorkStepInvoker {
  return async (task, step, signal) => invokeThroughHost(task, step, signal, options);
}

async function invokeThroughHost(
  task: WorkTask,
  step: PlanStep,
  signal: AbortSignal,
  options: CapabilityInvokerOptions,
): Promise<WorkStepResult> {
  if (signal.aborted) {
    return { ok: false, summary: 'Cancelled.', errorCode: 'CANCELLED' };
  }
  if (step.kind === 'understand') {
    return { ok: true, summary: `Understood objective: ${task.objective.slice(0, 160)}` };
  }
  if (step.kind === 'plan') {
    return { ok: true, summary: `Structured plan has ${task.plan.length} steps.` };
  }
  if (step.kind === 'reflect') {
    return { ok: true, summary: 'Structured reflection recorded. Failure cannot mint a trusted skill.' };
  }
  if (step.kind === 'permission') {
    if (step.permissionLease && !step.permissionLease.used && !step.permissionLease.denied) {
      return { ok: true, summary: 'Owner permission lease accepted for this planning gate.' };
    }
    return {
      ok: false,
      permissionRequired: true,
      summary: `Capability ${step.capability || step.id} requires owner permission.`,
      errorCode: 'PERMISSION_REQUIRED',
    };
  }
  if (step.kind === 'verify' || step.kind === 'test') {
    if (!step.capability) return structuredVerify(task);
  }

  const host = typeof options.host === 'function' ? options.host() : options.host;
  const resolved = resolveStepCapability(task, step, host);
  if (!resolved) {
    if (step.kind === 'apply' || step.kind === 'search' || step.kind === 'research' || step.kind === 'retrieve') {
      return {
        ok: true,
        skipped: true,
        summary: task.simulated
          ? `${step.title} completed (simulation).`
          : `No typed capability bound for ${step.kind}; step skipped.`,
      };
    }
    return { ok: true, summary: `${step.title} completed.` };
  }

  if (isBlockedCapabilityId(resolved.id)) {
    return {
      ok: false,
      summary: 'Unrestricted shell or exec capabilities are not allowed.',
      errorCode: 'CAPABILITY_DENIED',
    };
  }
  if (!host) {
    return {
      ok: false,
      summary: 'Capability host is not attached.',
      errorCode: 'PROVIDER_UNAVAILABLE',
    };
  }
  if (!host.lookup(resolved.id)) {
    return {
      ok: false,
      summary: `Capability ${resolved.id} is not registered.`,
      errorCode: 'PLAN_INVALID',
    };
  }

  const availability = await host.availability(resolved.id);
  if (availability.availability !== 'up') {
    return {
      ok: false,
      summary: availability.reason || `Capability ${resolved.id} is ${availability.availability}.`,
      errorCode: availability.availability === 'unavailable' ? 'PROVIDER_UNAVAILABLE' : 'STEP_FAILED',
    };
  }

  const confirmation = step.permissionLease?.token && step.pendingConfirmation?.proposalId
    ? { proposalId: step.pendingConfirmation.proposalId, token: step.permissionLease.token }
    : undefined;
  let input = resolved.input;
  if ((resolved.id === RESEARCH_SEARCH || resolved.id === RESEARCH_CURRENT) && input.depth === undefined) {
    const depth = options.researchDepth?.();
    if (depth) input = { ...input, depth };
  }
  step.input = { ...input };
  const result = await host.invoke({
    id: resolved.id,
    input,
    source: 'system',
    sessionId: task.sessionId || options.sessionId,
    ...(task.requestId ? { requestId: task.requestId } : {}),
    ...(confirmation ? { confirmation } : {}),
  });
  return mapCapabilityResult(result);
}

function structuredVerify(task: WorkTask): WorkStepResult {
  const failed = task.toolResults.filter(item => item.status === 'error' || item.status === 'rejected' || item.status === 'timeout');
  if (failed.length > 0) {
    return {
      ok: false,
      summary: `Verification failed: ${failed.map(item => item.capability).join(', ')}.`,
      errorCode: 'VERIFICATION_FAILED',
    };
  }
  return {
    ok: true,
    summary: task.toolResults.length
      ? 'Structured check of prior capability results passed.'
      : 'No capability observations to verify; cognitive steps completed.',
  };
}

function mapCapabilityResult(result: CapabilityResult): WorkStepResult {
  const summary = result.content?.trim() || result.error || result.status;
  const risk = typeof result.structured?.risk === 'string' ? String(result.structured.risk) : undefined;
  const facts = capabilityPresentationFacts(result.capabilityId, result.structured, result.content);
  const toolResult = {
    capability: result.capabilityId,
    status: result.status,
    summary: result.untrustedOutput && result.status === 'ok' ? 'untrusted external data' : summary.slice(0, 240),
    ...(risk ? { risk } : {}),
    ...(facts?.systemSnapshot || facts?.displays
      ? { facts: { ...(facts.systemSnapshot ? { systemSnapshot: facts.systemSnapshot } : {}), ...(facts.displays ? { displays: facts.displays } : {}) } }
      : {}),
  };
  const evidence = [
    ...result.sourceUrls.slice(0, 6),
    result.untrustedOutput ? `untrusted:${result.capabilityId}` : '',
  ].filter(Boolean);

  if (result.status === 'confirmation_required') {
    const structured = result.structured ?? {};
    return {
      ok: false,
      permissionRequired: true,
      summary: result.error || `Owner permission required for ${result.capabilityId}.`,
      errorCode: 'PERMISSION_REQUIRED',
      toolResult,
      pendingConfirmation: typeof structured.proposalId === 'string'
        ? {
            proposalId: structured.proposalId,
            capability: result.capabilityId,
            risk: String(structured.risk || 'CONFIRM_REQUIRED'),
            expiresAt: typeof structured.expiresAt === 'string' ? structured.expiresAt : undefined,
            summary: typeof structured.summary === 'string' ? structured.summary : result.error,
          }
        : {
            proposalId: `${result.capabilityId}:pending`,
            capability: result.capabilityId,
            risk: String(structured.risk || 'CONFIRM_REQUIRED'),
          },
      confirmToken: typeof structured.confirmToken === 'string' ? structured.confirmToken : undefined,
    };
  }
  if (result.status === 'rejected') {
    return {
      ok: false,
      summary: result.error || 'Capability denied.',
      errorCode: 'CAPABILITY_DENIED',
      toolResult,
    };
  }
  if (result.status === 'unavailable' || result.status === 'timeout') {
    return {
      ok: false,
      summary: result.error || `Capability ${result.capabilityId} is ${result.status}.`,
      errorCode: result.status === 'timeout'
        ? (result.capabilityId.startsWith('research.') ? 'RESEARCH_TIMEOUT' : 'TIMEOUT')
        : 'PROVIDER_UNAVAILABLE',
      toolResult,
    };
  }
  if (result.status !== 'ok') {
    return {
      ok: false,
      summary: result.error || summary,
      errorCode: classifyFailure({ message: result.error || summary }) as JarvisErrorCode,
      toolResult,
    };
  }
  return {
    ok: true,
    summary: toolResult.summary,
    toolResult,
    evidence,
  };
}
