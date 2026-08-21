import type {
  CapabilityCancellationRecord,
  CapabilityAvailabilityState,
  CapabilityDescriptor,
  CapabilityHandler,
  CapabilityHost,
  CapabilityInvokeRequest,
  CapabilityResult,
} from '../types';
import { createAbortReason, readAbortReason } from '../cancellation';
import { ActionAuditLog } from './ActionAuditLog';
import { applicationById, projectById } from './allowlists';
import { CONFIRMATION_TTL_MS, isGatedCapabilityId, isReadOnlyGatedCapability } from './constants';
import { ConfirmationStore } from './ConfirmationStore';
import { createProposalId, hashArguments } from './hash';
import { PermissionPolicy } from './PermissionPolicy';
import { validateActionInput } from './schema';
import type {
  ActionProposal,
  ActionRisk,
  ActionSource,
  DesktopAllowlists,
  PendingConfirmation,
  PermissionDecision,
} from './types';
import { urlTargetClass } from './urlSafety';
import { capabilityRequiresLease } from '../../security/constants';
import { isPrivilegeDenied, type PrivilegeLeaseStore } from '../../security/privilegeLease';
import type { JarvisEventBus } from '../../security/eventBus';
import { DestructiveActionCircuitBreaker } from '../../safety/circuitBreaker';
import { rollbackForResult, verificationForResult } from '../../safety/lifecycle';
import type { OperationalRiskLevel, VerificationRecord } from '../../safety/types';
import type { FailureContainment } from '../../safety/failureContainment';
import type { EmergencyStopController } from '../../security/emergencyStop';
import type { VerificationRegistry } from '../../safety/verificationRegistry';
import { toJournalOperationId, type ExecutionJournalCoordinator } from '../../executionJournal';

export type ActionGateOptions = {
  policy?: PermissionPolicy | null;
  confirmations?: ConfirmationStore;
  audit?: ActionAuditLog;
  allowlists: DesktopAllowlists;
  now?: () => number;
  services?: import('./services').JarvisServiceController;
  leases?: PrivilegeLeaseStore;
  events?: JarvisEventBus;
  circuitBreaker?: DestructiveActionCircuitBreaker;
  emergency?: EmergencyStopController;
  containment?: FailureContainment;
  verification?: VerificationRegistry;
  journal?: ExecutionJournalCoordinator;
};

export interface ActionHost extends CapabilityHost {
  services?: import('./services').JarvisServiceController;
  confirm(input: {
    proposalId: string;
    token: string;
    source?: ActionSource;
    requestId?: string;
    sessionId?: string;
  }): Promise<CapabilityResult>;
  denyProposal(proposalId: string, source?: ActionSource): Promise<CapabilityResult>;
  pendingFrom(result: CapabilityResult): PendingConfirmation | undefined;
}

export function isActionHost(host: CapabilityHost): host is ActionHost {
  return typeof (host as ActionHost).confirm === 'function'
    && typeof (host as ActionHost).denyProposal === 'function';
}

export function createActionGate(inner: CapabilityHost, options: ActionGateOptions): ActionHost {
  return new ActionGate(inner, options);
}

class ActionGate implements ActionHost {
  public readonly services?: import('./services').JarvisServiceController;
  private readonly policy: PermissionPolicy | null;
  private readonly confirmations: ConfirmationStore;
  private readonly circuitBreaker: DestructiveActionCircuitBreaker;
  private readonly completed = new Map<string, CapabilityResult>();
  private readonly inflight = new Map<string, {
    work: Promise<CapabilityResult>;
    controller: AbortController;
    capabilityId: string;
    cancellable: boolean;
  }>();

  constructor(
    private readonly inner: CapabilityHost,
    private readonly options: ActionGateOptions,
  ) {
    this.policy = options.policy === undefined ? new PermissionPolicy() : options.policy;
    this.confirmations = options.confirmations ?? new ConfirmationStore({ now: options.now });
    this.circuitBreaker = options.circuitBreaker ?? new DestructiveActionCircuitBreaker();
    this.services = options.services;
    options.emergency?.register({
      id: 'capability-host',
      cancelForEmergency: () => [
        ...this.confirmations.denyAll().map(proposalId => ({
          ownerId: 'capability-host',
          workId: proposalId,
          state: 'CANCELLED' as const,
          detail: 'Pending single-use confirmation was invalidated.',
        })),
        ...[...this.inflight.entries()].map(([key, active]) => {
          if (active.cancellable && !active.controller.signal.aborted) {
            active.controller.abort(createAbortReason('EMERGENCY_STOP', this.now()));
          }
          return {
            ownerId: 'capability-host',
            workId: key.slice(0, 180),
            state: active.cancellable ? 'CANCELLATION_REQUESTED' as const : 'NOT_CANCELLABLE' as const,
            detail: active.cancellable
              ? 'Emergency Stop reached the cooperative typed handler; acknowledgement will be recorded on completion.'
              : 'The running handler does not support cooperative cancellation; no new action may start.',
          };
        }),
      ],
    });
  }

  public register(handler: CapabilityHandler): void {
    this.inner.register(handler);
  }

  public lookup(id: string): CapabilityDescriptor | undefined {
    return this.inner.lookup(id);
  }

  public list(): CapabilityDescriptor[] {
    return this.inner.list();
  }

  public availability(id: string): Promise<CapabilityAvailabilityState> {
    return this.inner.availability(id);
  }

  public async invoke(request: CapabilityInvokeRequest): Promise<CapabilityResult> {
    const knownDescriptor = this.inner.lookup(request.id);
    if (knownDescriptor && this.options.emergency && !this.options.emergency.allows(sourceOf(request), knownDescriptor.sideEffect)) {
      return this.terminal(
        request.id,
        'denied',
        'EMERGENCY_STOP_ACTIVE',
        'Emergency Stop is active. Only the owner can resume operation.',
        'BLOCKED',
      );
    }
    if (!isGatedCapabilityId(request.id)) {
      if (knownDescriptor?.sideEffect === 'write') {
        this.options.events?.emit('PERMISSION_DENIED', 'Ungated mutation was blocked by the capability boundary.', {
          capabilityId: request.id,
          reasonCode: 'UNGATED_MUTATION_FORBIDDEN',
        }, 'warn');
        return this.terminal(
          request.id,
          'denied',
          'UNGATED_MUTATION_FORBIDDEN',
          'Mutating capabilities must use the typed ActionGate policy path.',
          'BLOCKED',
        );
      }
      return this.inner.invoke(request);
    }
    const descriptor = knownDescriptor;
    if (!descriptor) {
      return this.terminal(request.id, 'unavailable', 'UNKNOWN_CAPABILITY', 'Unknown capability.', 'BLOCKED');
    }
    if (!this.policy) {
      return this.denyAndAudit({
        capabilityId: request.id,
        reasonCode: 'POLICY_UNAVAILABLE',
        userMessage: 'Permission policy is unavailable.',
        risk: 'BLOCKED',
        source: sourceOf(request),
        input: {},
      });
    }

    const validated = validateActionInput(request.id, request.input ?? {}, this.options.allowlists);
    if (validated.ok === false) {
      return this.denyAndAudit({
        capabilityId: request.id,
        reasonCode: validated.reasonCode,
        userMessage: validated.userMessage,
        risk: 'BLOCKED',
        source: sourceOf(request),
        input: {},
      });
    }

    const proposal = this.createProposal(request, validated.value, descriptor);
    const journalBlock = this.prepareJournal(proposal, validated.value, request);
    if (journalBlock) return journalBlock;
    const baseDecision = this.policy.evaluate(proposal, this.options.allowlists);
    const containment = proposal.preflight
      ? this.options.containment?.blocks(proposal.capabilityId, proposal.preflight)
      : undefined;
    const decision = containment
      ? {
          ...baseDecision,
          decision: 'deny' as const,
          reasonCode: 'FAILURE_CONTAINMENT_ACTIVE',
          userMessage: 'Related mutation remains stopped after an unexpected action result. Owner recovery review is required.',
          risk: 'BLOCKED' as const,
        }
      : applyCircuitBreakerDecision(baseDecision, proposal.preflight);
    proposal.permissionDecision = decision;
    proposal.risk = decision.risk;
    this.options.events?.emit('RISK_ASSESSED', 'Capability risk assessed from typed action effects.', {
      capabilityId: proposal.capabilityId,
      proposalId: proposal.proposalId,
      risk: proposal.preflight?.risk,
      reviewRequired: proposal.preflight?.reviewRequired,
      blocked: proposal.preflight?.blocked,
      reasonCodes: proposal.preflight?.reasonCodes,
    }, proposal.preflight?.risk === 'CRITICAL' ? 'warn' : 'info');
    this.options.events?.emit('PREFLIGHT_CREATED', 'Structured action preflight created.', {
      capabilityId: proposal.capabilityId,
      proposalId: proposal.proposalId,
      preflightId: proposal.preflight?.id,
      affectedTargetCount: proposal.preflight?.affectedTargets.length || 0,
    });
    if (!(decision.risk === 'READ_ONLY' && proposal.source === 'system')) {
      this.audit({
        proposalId: proposal.proposalId,
        capabilityId: proposal.capabilityId,
        risk: decision.risk,
        decision: decision.decision,
        result: decision.decision === 'allow' ? 'allowed' : decision.decision,
        source: proposal.source,
        reasonCode: decision.reasonCode,
        targetClass: targetClassOf(proposal, this.options.allowlists),
      });
    }

    if (decision.decision === 'deny') {
      this.options.events?.emit('PERMISSION_DENIED', decision.userMessage, {
        capabilityId: proposal.capabilityId,
        proposalId: proposal.proposalId,
        reasonCode: decision.reasonCode,
      }, 'warn');
      const status = unavailableReason(decision.reasonCode) ? 'unavailable' : 'denied';
      return this.terminal(
        proposal.capabilityId,
        status,
        decision.reasonCode,
        decision.userMessage,
        decision.risk,
        proposal.proposalId,
      );
    }

    if (capabilityRequiresLease(proposal.capabilityId)) {
      const leaseCheck = this.requireLease(proposal, false);
      if (leaseCheck) return leaseCheck;
    }

    if (decision.decision === 'confirm') {
      if (!request.confirmation) {
        this.options.events?.emit('PERMISSION_REQUESTED', decision.userMessage, {
          capabilityId: proposal.capabilityId,
          proposalId: proposal.proposalId,
          risk: proposal.preflight?.risk,
        }, 'warn');
        this.noteJournalWaiting(proposal, validated.value, request);
        return this.requireConfirmation(proposal, decision);
      }
      const stored = this.confirmations.peek(request.confirmation.proposalId);
      if (stored && stored.capabilityId !== request.id) {
        return this.terminal(
          request.id,
          'denied',
          'CAPABILITY_MISMATCH',
          'ทำรายการนี้ไม่ได้ครับ',
          'BLOCKED',
          request.confirmation.proposalId,
        );
      }
      const consumed = this.confirmations.consume(
        request.confirmation.proposalId,
        request.confirmation.token,
        proposal.argumentsHash,
      );
      if (consumed.ok === false) {
        this.audit({
          proposalId: request.confirmation.proposalId,
          capabilityId: proposal.capabilityId,
          risk: decision.risk,
          decision: 'deny',
          result: consumed.reasonCode,
          source: proposal.source,
          reasonCode: consumed.reasonCode,
        });
        return this.terminal(
          proposal.capabilityId,
          'denied',
          consumed.reasonCode,
          confirmationMessage(consumed.reasonCode),
          decision.risk,
          request.confirmation.proposalId,
        );
      }
      this.options.events?.emit('PERMISSION_GRANTED', 'Owner permission consumed for this proposal.', {
        capabilityId: proposal.capabilityId,
        proposalId: proposal.proposalId,
        scope: proposal.preflight?.permissionScope,
      });
      return this.execute(proposal, validated.value, request);
    }

    return this.execute(proposal, validated.value, request);
  }

  public async confirm(input: {
    proposalId: string;
    token: string;
    source?: ActionSource;
    requestId?: string;
    sessionId?: string;
  }): Promise<CapabilityResult> {
    const stored = this.confirmations.peek(input.proposalId);
    if (!stored) {
      return this.terminal('unknown', 'denied', 'UNKNOWN_PROPOSAL', 'That approval is not valid.', 'BLOCKED', input.proposalId);
    }
    return this.invoke({
      id: stored.capabilityId,
      input: stored.input,
      confirmation: { proposalId: input.proposalId, token: input.token },
      source: input.source ?? 'ui',
      requestId: input.requestId,
      sessionId: input.sessionId,
    });
  }

  public async denyProposal(proposalId: string, source: ActionSource = 'ui'): Promise<CapabilityResult> {
    const stored = this.confirmations.deny(proposalId);
    if (!stored) {
      return this.terminal('unknown', 'denied', 'UNKNOWN_PROPOSAL', 'That approval is not valid.', 'BLOCKED', proposalId);
    }
    this.audit({
      proposalId,
      capabilityId: stored.capabilityId,
      risk: 'CONFIRM_REQUIRED',
      decision: 'deny',
      result: 'denied',
      source,
      reasonCode: 'OWNER_DENIED',
    });
    return this.terminal(
      stored.capabilityId,
      'denied',
      'OWNER_DENIED',
      'ยกเลิกรายการนี้แล้วครับ',
      'CONFIRM_REQUIRED',
      proposalId,
    );
  }

  public pendingFrom(result: CapabilityResult): PendingConfirmation | undefined {
    const structured = result.structured ?? {};
    if (structured.status !== 'confirmation_required') return undefined;
    if (typeof structured.proposalId !== 'string' || typeof structured.confirmToken !== 'string') return undefined;
    return {
      proposalId: structured.proposalId,
      token: structured.confirmToken,
      capabilityId: result.capabilityId,
      displayName: String(structured.displayName ?? result.capabilityId),
      summary: String(structured.summary ?? result.content),
      target: String(structured.target ?? ''),
      risk: (structured.risk as ActionRisk) || 'CONFIRM_REQUIRED',
      reason: String(structured.reason ?? 'Confirmation required.'),
      expiresAt: String(structured.expiresAt ?? ''),
      ...(isRecord(structured.preflight) ? { preflight: structured.preflight as PendingConfirmation['preflight'] } : {}),
    };
  }

  private async execute(
    proposal: ActionProposal,
    input: Record<string, unknown>,
    request: CapabilityInvokeRequest,
  ): Promise<CapabilityResult> {
    const key = `${request.requestId || proposal.proposalId}|${proposal.capabilityId}|${proposal.argumentsHash}`;
    const cached = this.completed.get(key);
    if (cached) return cached;
    const existing = this.inflight.get(key);
    if (existing) return existing.work;

    const descriptor = this.inner.lookup(proposal.capabilityId);
    const controller = new AbortController();
    const removeForwarder = forwardAbort(request.signal, controller);

    const startedAt = new Date(this.now()).toISOString();
    const work = (async () => {
      if (capabilityRequiresLease(proposal.capabilityId)) {
        const consumed = this.requireLease(proposal, true);
        if (consumed) return consumed;
      }
      if (this.options.audit) {
        try {
          this.audit({
            proposalId: proposal.proposalId,
            capabilityId: proposal.capabilityId,
            risk: proposal.risk,
            decision: 'execute',
            result: 'started',
            source: proposal.source,
            targetClass: targetClassOf(proposal, this.options.allowlists),
          });
        } catch {
          return this.terminal(
            proposal.capabilityId,
            'denied',
            'AUDIT_UNAVAILABLE',
            'Action audit is unavailable.',
            'BLOCKED',
            proposal.proposalId,
          );
        }
      }
      this.options.events?.emit('ACTION_STARTED', 'Typed capability execution started.', {
        capabilityId: proposal.capabilityId,
        proposalId: proposal.proposalId,
        preflightId: proposal.preflight?.id,
      });
      const journalGate = this.authorizeJournalExecution(proposal, input, request);
      if (journalGate) return journalGate;
      const result = await this.inner.invoke({
        id: proposal.capabilityId,
        input,
        timeoutMs: request.timeoutMs,
        signal: controller.signal,
        requestId: request.requestId,
        sessionId: request.sessionId,
        source: request.source,
      });
      const completedAt = new Date(this.now()).toISOString();
      let registeredVerification: VerificationRecord | undefined;
      if (descriptor?.verification?.mode === 'registered_postcondition' && descriptor.verification.verifierId) {
        try {
          registeredVerification = await this.options.verification?.verify(
            descriptor.verification.verifierId,
            descriptor,
            result,
            this.now(),
          );
        } catch (error) {
          registeredVerification = {
            state: 'FAILED_VERIFICATION',
            strategy: descriptor.verification.description,
            requested: descriptor.description,
            executed: 'The deterministic verifier failed to complete.',
            evidence: [],
            failedChecks: [error instanceof Error ? error.message.slice(0, 240) : 'Verifier failed.'],
            verifiedAt: new Date(this.now()).toISOString(),
          };
        }
      }
      const verification = descriptor
        ? registeredVerification ?? verificationForResult(descriptor, result, this.now())
        : undefined;
      const rollback = descriptor
        ? rollbackForResult(descriptor, result)
        : proposal.preflight?.rollback;
      this.options.events?.emit('VERIFICATION_STARTED', 'Post-action verification lifecycle started.', {
        capabilityId: proposal.capabilityId,
        proposalId: proposal.proposalId,
      });
      const decorated: CapabilityResult = {
        ...result,
        structured: {
          ...result.structured,
          proposalId: proposal.proposalId,
          startedAt,
          completedAt,
          risk: result.structured?.risk ?? proposal.risk,
          preflight: proposal.preflight,
          verification,
          rollback,
        },
      };
      this.options.events?.emit('ACTION_COMPLETED', 'Typed capability execution completed.', {
        capabilityId: proposal.capabilityId,
        proposalId: proposal.proposalId,
        status: decorated.status,
      }, decorated.status === 'ok' ? 'info' : 'warn');
      const cancellation = cancellationFrom(decorated.structured.cancellation);
      if (cancellation) {
        this.options.events?.emit(
          cancellation.state === 'CANCELLED' ? 'ACTION_CANCELLED' : 'ACTION_CANCEL_FAILED',
          cancellation.detail,
          {
            capabilityId: proposal.capabilityId,
            proposalId: proposal.proposalId,
            state: cancellation.state,
            reason: cancellation.reason,
            observedByHandler: cancellation.observedByHandler,
          },
          cancellation.state === 'CANCELLED' ? 'warn' : 'error',
        );
        this.options.emergency?.recordCancellationResult({
          ownerId: 'capability-host',
          workId: key.slice(0, 180),
          state: emergencyStateFor(cancellation.state),
          detail: cancellation.detail,
        });
      }
      this.options.events?.emit('VERIFICATION_COMPLETED', 'Post-action verification lifecycle completed.', {
        capabilityId: proposal.capabilityId,
        proposalId: proposal.proposalId,
        state: verification?.state || 'UNVERIFIED',
        failedCheckCount: verification?.failedChecks.length || 0,
      }, verification?.state === 'FAILED_VERIFICATION' ? 'error' : 'info');
      this.finishJournal(proposal, input, request, decorated, verification);
      if (rollback?.state === 'AVAILABLE' || rollback?.state === 'PARTIAL') {
        this.options.events?.emit('ROLLBACK_AVAILABLE', 'A recorded recovery path is available.', {
          capabilityId: proposal.capabilityId,
          proposalId: proposal.proposalId,
          state: rollback.state,
        });
      }
      const incident = proposal.preflight && rollback
        ? this.options.containment?.observe({
            capabilityId: proposal.capabilityId,
            preflight: proposal.preflight,
            result,
            recovery: rollback,
            taskId: proposal.provenance.sessionId,
          })
        : undefined;
      if (incident) {
        decorated.structured.containment = {
          incidentId: incident.id,
          reasonCode: incident.reasonCode,
          active: incident.active,
        };
      }
      this.audit({
        proposalId: proposal.proposalId,
        capabilityId: proposal.capabilityId,
        risk: proposal.risk,
        decision: 'execute',
        result: String(decorated.structured.status ?? decorated.status),
        source: proposal.source,
        targetClass: targetClassOf(proposal, this.options.allowlists),
      });
      return decorated;
    })();

    this.inflight.set(key, {
      work,
      controller,
      capabilityId: proposal.capabilityId,
      cancellable: descriptor?.cancellation?.support === 'cooperative',
    });
    try {
      const result = await work;
      this.completed.set(key, result);
      return result;
    } finally {
      this.inflight.delete(key);
      removeForwarder();
    }
  }

  private requireConfirmation(proposal: ActionProposal, decision: PermissionDecision): CapabilityResult {
    const issued = this.confirmations.issue(proposal);
    return {
      capabilityId: proposal.capabilityId,
      status: 'confirmation_required',
      structured: {
        status: 'confirmation_required',
        proposalId: proposal.proposalId,
        confirmToken: issued.token,
        displayName: proposal.displayName,
        summary: proposal.summary,
        target: proposal.target,
        risk: decision.risk,
        reason: decision.userMessage,
        reasonCode: decision.reasonCode,
        expiresAt: new Date(issued.record.expiresAt).toISOString(),
        preflight: proposal.preflight,
      },
      content: proposal.capabilityId === 'desktop.openTrustedUrl'
        ? 'ต้องการให้ผมเปิดเว็บไซต์นี้ไหม?'
        : decision.userMessage,
      sourceUrls: [],
      untrustedOutput: false,
      sideEffect: 'write',
    };
  }

  private createProposal(
    request: CapabilityInvokeRequest,
    input: Record<string, unknown>,
    descriptor: CapabilityDescriptor,
  ): ActionProposal {
    const now = this.now();
    const meta = describeProposal(request.id, input, this.options.allowlists);
    const proposal: ActionProposal = {
      proposalId: request.confirmation?.proposalId || createProposalId(),
      capabilityId: request.id,
      displayName: meta.displayName,
      summary: meta.summary,
      target: meta.target,
      normalizedArguments: input,
      argumentsHash: hashArguments(input),
      risk: meta.risk,
      sideEffectClass: isReadOnlyGatedCapability(request.id) ? 'read' : 'write',
      source: sourceOf(request),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CONFIRMATION_TTL_MS).toISOString(),
      provenance: {
        requestId: request.requestId,
        sessionId: request.sessionId,
        source: sourceOf(request),
      },
    };
    proposal.preflight = this.circuitBreaker.createPreflight({
      descriptor,
      capabilityInput: input,
      action: meta.summary,
      why: `Capability ${request.id} was proposed for this ${sourceOf(request)} request; policy approval is evaluated separately.`,
      permissionScope: meta.target ? [meta.target] : [],
    });
    return proposal;
  }

  private denyAndAudit(input: {
    capabilityId: string;
    reasonCode: string;
    userMessage: string;
    risk: ActionRisk;
    source: ActionSource;
    input: Record<string, unknown>;
  }): CapabilityResult {
    const proposalId = createProposalId();
    this.audit({
      proposalId,
      capabilityId: input.capabilityId,
      risk: input.risk,
      decision: 'deny',
      result: 'denied',
      source: input.source,
      reasonCode: input.reasonCode,
    });
    const status = unavailableReason(input.reasonCode) ? 'unavailable' : 'denied';
    return this.terminal(input.capabilityId, status, input.reasonCode, input.userMessage, input.risk, proposalId);
  }

  private terminal(
    capabilityId: string,
    status: 'denied' | 'unavailable',
    reasonCode: string,
    userMessage: string,
    risk: ActionRisk,
    proposalId?: string,
  ): CapabilityResult {
    return {
      capabilityId,
      status: status === 'unavailable' ? 'unavailable' : 'rejected',
      structured: {
        status,
        reasonCode,
        proposalId,
        risk,
        summary: userMessage,
      },
      content: userMessage,
      sourceUrls: [],
      untrustedOutput: false,
      sideEffect: isReadOnlyGatedCapability(capabilityId) ? 'read' : 'write',
      error: reasonCode,
    };
  }

  private audit(event: {
    proposalId: string;
    capabilityId: string;
    risk: ActionRisk;
    decision: string;
    result: string;
    source: ActionSource;
    reasonCode?: string;
    targetClass?: string;
  }): void {
    if (!this.options.audit) return;
    this.options.audit.record({
      v: 1,
      at: new Date(this.now()).toISOString(),
      ...event,
    });
  }

  private requireLease(proposal: ActionProposal, consume: boolean): CapabilityResult | undefined {
    if (!this.options.leases) {
      this.options.events?.emit('PRIVILEGE_DENIED', 'Privilege lease store is unavailable.', {
        capabilityId: proposal.capabilityId,
        reasonCode: 'PRIVILEGE_STORE_UNAVAILABLE',
      }, 'warn');
      return this.terminal(
        proposal.capabilityId,
        'denied',
        'PRIVILEGE_STORE_UNAVAILABLE',
        'A privilege lease is required and no lease store is attached.',
        'BLOCKED',
        proposal.proposalId,
      );
    }
    const resource = String(proposal.normalizedArguments.url || proposal.normalizedArguments.query || proposal.capabilityId);
    const decision = consume
      ? this.options.leases.consume(proposal.capabilityId, resource)
      : this.options.leases.peekValid(proposal.capabilityId, resource);
    if (!isPrivilegeDenied(decision)) {
      if (consume) {
        this.options.events?.emit('PRIVILEGE_APPROVED', 'Owner privilege lease consumed.', {
          capabilityId: proposal.capabilityId,
          leaseId: decision.lease.id,
        });
      }
      return undefined;
    }
    this.options.events?.emit('PRIVILEGE_DENIED', decision.userMessage, {
      capabilityId: proposal.capabilityId,
      reasonCode: decision.reasonCode,
    }, 'warn');
    return this.terminal(
      proposal.capabilityId,
      'denied',
      decision.reasonCode,
      decision.userMessage,
      'BLOCKED',
      proposal.proposalId,
    );
  }

  private prepareJournal(
    proposal: ActionProposal,
    input: Record<string, unknown>,
    request: CapabilityInvokeRequest,
  ): CapabilityResult | undefined {
    const journal = this.options.journal;
    if (!journal || !shouldJournal(proposal.capabilityId, this.inner.lookup(proposal.capabilityId)?.sideEffect)) {
      return undefined;
    }
    if (journal.failClosed()) {
      return this.terminal(
        proposal.capabilityId,
        'denied',
        'JOURNAL_FAIL_CLOSED',
        'The execution journal is fail-closed after corrupt or ambiguous recovery evidence.',
        'BLOCKED',
        proposal.proposalId,
      );
    }
    try {
      const record = journal.propose({
        operationId: journalOperationId(input, request, proposal.proposalId),
        kind: proposal.capabilityId === 'operator.sandbox.rollbackConfig' ? 'ROLLBACK' : 'MUTATION',
        capabilityId: proposal.capabilityId,
        action: journaledAction(proposal.capabilityId, input),
        scope: proposal.preflight?.affectedTargets ?? [proposal.capabilityId],
        idempotencyClass: journalIdempotencyClass(proposal.capabilityId),
        idempotencyKey: journalIdempotencyKey(proposal.capabilityId, input),
        taskId: request.sessionId,
        stepId: request.requestId,
        checkpointId: typeof input.checkpointId === 'string' ? input.checkpointId : undefined,
        parentOperationId: typeof input.rollbackOf === 'string' ? input.rollbackOf : undefined,
      });
      if (record.executionState === 'PROPOSED') {
        journal.transition(record.operationId, 'PREFLIGHTED', 'system');
      }
      return undefined;
    } catch (error) {
      const reasonCode = error && typeof error === 'object' && 'reasonCode' in error
        ? String((error as { reasonCode?: string }).reasonCode)
        : 'JOURNAL_SECRET_REJECTED';
      return this.terminal(
        proposal.capabilityId,
        'denied',
        reasonCode,
        error instanceof Error ? error.message : 'Execution journal rejected this operation.',
        'BLOCKED',
        proposal.proposalId,
      );
    }
  }

  private noteJournalWaiting(
    proposal: ActionProposal,
    input: Record<string, unknown>,
    request: CapabilityInvokeRequest,
  ): void {
    const journal = this.options.journal;
    if (!journal || journal.failClosed()) return;
    const record = journal.get(journalOperationId(input, request, proposal.proposalId));
    if (!record || record.executionState !== 'PREFLIGHTED') return;
    try {
      journal.transition(record.operationId, 'WAITING_PERMISSION', 'system');
    } catch {
      // Journal evidence remains at PREFLIGHTED; permission still comes from ActionGate.
    }
  }

  private authorizeJournalExecution(
    proposal: ActionProposal,
    input: Record<string, unknown>,
    request: CapabilityInvokeRequest,
  ): CapabilityResult | undefined {
    const journal = this.options.journal;
    if (!journal || !shouldJournal(proposal.capabilityId, this.inner.lookup(proposal.capabilityId)?.sideEffect)) {
      return undefined;
    }
    const operationId = journalOperationId(input, request, proposal.proposalId);
    const record = journal.get(operationId);
    if (!record) return undefined;
    try {
      if (record.executionState === 'PREFLIGHTED' || record.executionState === 'WAITING_PERMISSION') {
        journal.transition(operationId, record.executionState === 'PREFLIGHTED' ? 'WAITING_PERMISSION' : 'AUTHORIZED', 'system');
        if (journal.get(operationId)?.executionState === 'WAITING_PERMISSION') {
          journal.transition(operationId, 'AUTHORIZED', 'system');
        }
      }
      const latest = journal.get(operationId);
      if (latest?.executionState === 'CHECKPOINTED' && request.confirmation) {
        journal.authorizeRetry(operationId, 'owner');
      }
      const gate = journal.mutationGate(operationId);
      if (!gate.allowed && !gate.verifyOnly) {
        return this.terminal(
          proposal.capabilityId,
          'denied',
          gate.reasonCode || 'JOURNAL_TRANSITION_FORBIDDEN',
          'The execution journal refused automatic mutation replay.',
          'BLOCKED',
          proposal.proposalId,
        );
      }
      return undefined;
    } catch (error) {
      const reasonCode = error && typeof error === 'object' && 'reasonCode' in error
        ? String((error as { reasonCode?: string }).reasonCode)
        : 'JOURNAL_TRANSITION_FORBIDDEN';
      return this.terminal(
        proposal.capabilityId,
        'denied',
        reasonCode,
        error instanceof Error ? error.message : 'Execution journal blocked this mutation.',
        'BLOCKED',
        proposal.proposalId,
      );
    }
  }

  private finishJournal(
    proposal: ActionProposal,
    input: Record<string, unknown>,
    request: CapabilityInvokeRequest,
    result: CapabilityResult,
    verification?: VerificationRecord,
  ): void {
    const journal = this.options.journal;
    if (!journal || journal.failClosed()) return;
    const operationId = journalOperationId(input, request, proposal.proposalId);
    const record = journal.get(operationId);
    if (!record) return;
    try {
      if (result.status === 'cancelled' || result.status === 'timeout') {
        if (record.executionState !== 'CANCELLED' && record.executionState !== 'CONTAINED') {
          journal.transition(operationId, 'CANCELLATION_REQUESTED', 'system', {
            cancellationState: result.status === 'timeout' ? 'CANCELLATION_REQUESTED' : 'CANCELLED',
            recoveryDisposition: result.status === 'timeout' ? 'OWNER_REVIEW' : 'NONE',
          });
          if (result.status === 'cancelled') {
            journal.transition(operationId, 'CANCELLED', 'system', { cancellationState: 'CANCELLED' });
          } else {
            journal.reconcile(operationId, { observed: 'UNKNOWN', evidenceRef: 'timeout' });
          }
        }
        return;
      }
      if (result.structured?.reasonCode === 'CHECKPOINT_RETRY_NOT_AUTHORIZED') return;
      if (result.status === 'ok' && ['AUTHORIZED', 'CHECKPOINTING', 'CHECKPOINTED', 'EXECUTING'].includes(record.executionState)) {
        if (result.structured?.idempotent === true || journal.mutationGate(operationId).verifyOnly) {
          if (record.executionState === 'CHECKPOINTED' || record.executionState === 'MUTATED' || record.executionState === 'EXECUTING') {
            journal.reconcile(operationId, { observed: 'INTENDED', evidenceRef: 'handler-idempotent' });
          }
        }
      }
      if (verification?.state === 'VERIFIED' || verification?.state === 'PARTIALLY_VERIFIED' || verification?.state === 'FAILED_VERIFICATION') {
        const latest = journal.get(operationId);
        if (latest && (latest.executionState === 'MUTATED' || latest.executionState === 'VERIFYING' || latest.executionState === 'ROLLING_BACK' || latest.executionState === 'FAILED_VERIFICATION' || latest.executionState === 'PARTIALLY_VERIFIED')) {
          journal.recordVerification(operationId, verification.state);
        }
      }
    } catch {
      // Handler result remains authoritative; journal fail-closed is evaluated on the next mutating request.
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

function shouldJournal(capabilityId: string, sideEffect?: string): boolean {
  if (isReadOnlyGatedCapability(capabilityId) || sideEffect === 'read') return false;
  return sideEffect === 'write' || !isReadOnlyGatedCapability(capabilityId);
}

function journaledAction(capabilityId: string, input: Record<string, unknown>): Record<string, unknown> {
  if (capabilityId === 'operator.sandbox.writeConfig') {
    return { operationId: input.operationId, value: input.value };
  }
  if (capabilityId === 'operator.sandbox.rollbackConfig') {
    return { checkpointId: input.checkpointId };
  }
  if (capabilityId === 'reminders.create') {
    return { title: input.title, whenText: input.whenText, message: input.message };
  }
  return input;
}

function journalOperationId(
  input: Record<string, unknown>,
  request: CapabilityInvokeRequest,
  proposalId: string,
): string {
  if (typeof input.operationId === 'string' && input.operationId.trim()) return toJournalOperationId(input.operationId);
  if (typeof input.rollbackId === 'string' && input.rollbackId.trim()) return toJournalOperationId(input.rollbackId);
  return toJournalOperationId(String(request.requestId || proposalId));
}

function journalIdempotencyClass(capabilityId: string): 'IDEMPOTENT' | 'UNKNOWN' {
  if (capabilityId === 'operator.sandbox.writeConfig' || capabilityId === 'operator.sandbox.rollbackConfig' || capabilityId === 'reminders.create') {
    return 'IDEMPOTENT';
  }
  return 'UNKNOWN';
}

function journalIdempotencyKey(capabilityId: string, input: Record<string, unknown>): string | undefined {
  if (capabilityId === 'operator.sandbox.writeConfig' && typeof input.operationId === 'string') return input.operationId;
  if (capabilityId === 'operator.sandbox.rollbackConfig' && typeof input.checkpointId === 'string') {
    return `rollback:${input.checkpointId}`;
  }
  if (capabilityId === 'reminders.create') {
    return `${String(input.title || '')}|${String(input.whenText || '')}|${String(input.message || '')}`;
  }
  return undefined;
}

function forwardAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => undefined;
  const forward = () => {
    if (!target.signal.aborted) target.abort(readAbortReason(source) ?? createAbortReason('OWNER_CANCEL'));
  };
  if (source.aborted) forward();
  else source.addEventListener('abort', forward, { once: true });
  return () => source.removeEventListener('abort', forward);
}

function cancellationFrom(value: unknown): CapabilityCancellationRecord | undefined {
  if (!isRecord(value) || typeof value.state !== 'string' || typeof value.detail !== 'string') return undefined;
  return value as CapabilityCancellationRecord;
}

function emergencyStateFor(state: CapabilityCancellationRecord['state']): import('../../security/emergencyStop').EmergencyCancellationState {
  if (state === 'CANCELLED') return 'CANCELLED';
  if (state === 'COMPLETED_BEFORE_CANCEL') return 'COMPLETED_BEFORE_CANCEL';
  if (state === 'FAILED_TO_CANCEL') return 'FAILED_TO_CANCEL';
  if (state === 'NOT_CANCELLABLE') return 'NOT_CANCELLABLE';
  return 'CANCELLATION_REQUESTED';
}

function sourceOf(request: CapabilityInvokeRequest): ActionSource {
  return request.source ?? 'text';
}

function unavailableReason(reasonCode: string): boolean {
  return reasonCode === 'NOT_INSTALLED'
    || reasonCode === 'PROJECT_UNAVAILABLE'
    || reasonCode === 'EXPLORER_UNAVAILABLE'
    || reasonCode === 'TELEMETRY_UNAVAILABLE'
    || reasonCode === 'STORE_UNAVAILABLE'
    || reasonCode === 'UNKNOWN_REMINDER'
    || reasonCode === 'RESEARCH_UNAVAILABLE'
    || reasonCode === 'NO_SOURCES'
    || reasonCode === 'UNKNOWN_SOURCE'
    || reasonCode === 'PRIVATE_BROWSER_UNAVAILABLE'
    || reasonCode === 'VIRTUALBOX_MISSING'
    || reasonCode === 'PRIVILEGE_STORE_UNAVAILABLE';
}

function confirmationMessage(reasonCode: string): string {
  if (reasonCode === 'CONFIRMATION_EXPIRED') return 'คำขออนุญาตหมดอายุแล้วครับ';
  if (reasonCode === 'CONFIRMATION_REUSED') return 'คำขออนุญาตนี้ถูกใช้ไปแล้วครับ';
  if (reasonCode === 'ARGUMENTS_CHANGED') return 'รายการเปลี่ยนไป ต้องอนุญาตใหม่ครับ';
  return 'ทำรายการนี้ไม่ได้ครับ';
}

function describeProposal(
  capabilityId: string,
  input: Record<string, unknown>,
  lists: DesktopAllowlists,
): { displayName: string; summary: string; target: string; risk: ActionRisk } {
  if (capabilityId === 'desktop.openApplication') {
    const app = applicationById(lists, String(input.applicationId ?? ''));
    const name = app?.displayName || String(input.applicationId ?? 'application');
    return { displayName: name, summary: `Open ${name}`, target: name, risk: 'LOW_RISK_ACTION' };
  }
  if (capabilityId === 'desktop.openProject') {
    const project = projectById(lists, String(input.projectId ?? ''));
    const name = project?.displayName || String(input.projectId ?? 'project');
    return { displayName: name, summary: `Reveal ${name}`, target: name, risk: 'LOW_RISK_ACTION' };
  }
  if (capabilityId === 'desktop.openTrustedUrl') {
    const url = String(input.url ?? '');
    return { displayName: 'Open website', summary: `Open ${url}`, target: url, risk: 'CONFIRM_REQUIRED' };
  }
  if (capabilityId === 'desktop.openScopedResource') {
    const label = String(input.label || input.applicationId || input.url || 'resource');
    return { displayName: label, summary: `Open ${label}`, target: label, risk: 'LOW_RISK_ACTION' };
  }
  if (capabilityId === 'desktop.placeWindow') {
    const name = String(input.applicationId || 'window');
    return { displayName: name, summary: `Move ${name}`, target: name, risk: 'LOW_RISK_ACTION' };
  }
  if (capabilityId === 'desktop.focusWindow') {
    const name = String(input.applicationId || 'window');
    return { displayName: name, summary: `Focus ${name}`, target: name, risk: 'LOW_RISK_ACTION' };
  }
  if (capabilityId === 'desktop.openSettings') {
    const settingsId = String(input.settingsId ?? 'settings');
    return { displayName: settingsId, summary: `Open ${settingsId} settings`, target: settingsId, risk: 'LOW_RISK_ACTION' };
  }
  if (capabilityId === 'jarvis.startService' || capabilityId === 'jarvis.stopService' || capabilityId === 'jarvis.restartService') {
    const serviceId = String(input.serviceId ?? 'service');
    const verb = capabilityId === 'jarvis.startService' ? 'Start' : capabilityId === 'jarvis.stopService' ? 'Stop' : 'Restart';
    return {
      displayName: serviceId,
      summary: `${verb} ${serviceId}`,
      target: serviceId,
      risk: capabilityId === 'jarvis.startService' ? 'LOW_RISK_ACTION' : 'CONFIRM_REQUIRED',
    };
  }
  if (capabilityId === 'applications.status') {
    return { displayName: 'Applications', summary: 'Allowlisted application status', target: 'applications', risk: 'READ_ONLY' };
  }
  if (capabilityId === 'jarvis.runtimeStatus' || capabilityId === 'jarvis.healthCheck') {
    return { displayName: 'Jarvis runtime', summary: 'Jarvis runtime status', target: 'jarvis', risk: 'READ_ONLY' };
  }
  if (capabilityId === 'system.batteryStatus') {
    return { displayName: 'Battery', summary: 'Battery status', target: 'battery', risk: 'READ_ONLY' };
  }
  if (capabilityId === 'system.networkStatus') {
    return { displayName: 'Network', summary: 'Network status', target: 'network', risk: 'READ_ONLY' };
  }
  if (capabilityId.startsWith('reminders.')) {
    const read = capabilityId === 'reminders.list' || capabilityId === 'reminders.get';
    return {
      displayName: 'Reminder',
      summary: capabilityId.replace('reminders.', 'Reminder '),
      target: String(input.reminderId || input.title || 'reminder'),
      risk: read ? 'READ_ONLY' : 'LOW_RISK_ACTION',
    };
  }
  if (capabilityId === 'research.privateBrowse') {
    return {
      displayName: 'Private browser',
      summary: 'Private browser research via Whonix',
      target: String(input.url || input.query || 'private-browser'),
      risk: 'CONFIRM_REQUIRED',
    };
  }
  if (capabilityId.startsWith('research.')) {
    return {
      displayName: 'Research',
      summary: capabilityId.replace('research.', 'Research '),
      target: String(input.query || input.sourceId || input.url || 'public-web'),
      risk: 'READ_ONLY',
    };
  }
  if (capabilityId.startsWith('workspace.')) {
    return {
      displayName: 'Workspace',
      summary: capabilityId.replace('workspace.', 'Workspace '),
      target: String(input.documentId || input.query || input.workspaceId || 'workspace'),
      risk: 'READ_ONLY',
    };
  }
  if (capabilityId === 'operator.sandbox.writeConfig') {
    return {
      displayName: 'Recovery sandbox change',
      summary: 'Write one disposable Jarvis-owned sandbox value',
      target: 'Jarvis recovery sandbox',
      risk: 'CONFIRM_REQUIRED',
    };
  }
  if (capabilityId === 'operator.sandbox.rollbackConfig') {
    return {
      displayName: 'Recovery sandbox rollback',
      summary: 'Restore one recorded sandbox checkpoint',
      target: 'Jarvis recovery sandbox',
      risk: 'CONFIRM_REQUIRED',
    };
  }
  return { displayName: 'System status', summary: 'Read system status', target: 'system', risk: 'READ_ONLY' };
}

function targetClassOf(proposal: ActionProposal, lists: DesktopAllowlists): string {
  if (proposal.capabilityId === 'desktop.openApplication' || proposal.capabilityId === 'applications.status') {
    return `application:${String(proposal.normalizedArguments.applicationId ?? 'allowlist')}`;
  }
  if (proposal.capabilityId === 'desktop.openProject') {
    return `project:${String(proposal.normalizedArguments.projectId ?? '')}`;
  }
  if (proposal.capabilityId === 'desktop.openTrustedUrl') {
    return urlTargetClass(String(proposal.normalizedArguments.url ?? ''), lists);
  }
  if (proposal.capabilityId === 'desktop.openSettings') {
    return `settings:${String(proposal.normalizedArguments.settingsId ?? '')}`;
  }
  if (proposal.capabilityId.startsWith('jarvis.') && proposal.normalizedArguments.serviceId) {
    return `jarvis-service:${String(proposal.normalizedArguments.serviceId)}`;
  }
  if (proposal.capabilityId.startsWith('jarvis.')) return 'jarvis:runtime';
  if (proposal.capabilityId.startsWith('reminders.')) {
    return `reminder:${String(proposal.normalizedArguments.reminderId || 'store')}`;
  }
  if (proposal.capabilityId.startsWith('research.')) {
    return `research:${String(proposal.normalizedArguments.query || proposal.normalizedArguments.sourceId || 'public-web')}`;
  }
  if (proposal.capabilityId.startsWith('workspace.')) {
    return `workspace:${String(proposal.normalizedArguments.documentId || proposal.normalizedArguments.workspaceId || 'registry')}`;
  }
  if (proposal.capabilityId.startsWith('operator.sandbox.')) return 'jarvis:recovery-sandbox';
  return 'system:status';
}

function applyCircuitBreakerDecision(
  decision: PermissionDecision,
  preflight: ActionProposal['preflight'],
): PermissionDecision {
  if (!preflight) return decision;
  if (preflight.blocked) {
    return {
      ...decision,
      decision: 'deny',
      reasonCode: preflight.reasonCodes[0] || 'CIRCUIT_BREAKER_BLOCKED',
      userMessage: 'The destructive action scope is not explicit, so the safety circuit breaker blocked execution.',
      risk: 'BLOCKED',
    };
  }
  if (preflight.reviewRequired && decision.decision === 'allow') {
    return {
      ...decision,
      decision: 'confirm',
      reasonCode: preflight.reasonCodes[0] || 'PREFLIGHT_REVIEW_REQUIRED',
      userMessage: 'Review the structured risk brief before this action executes.',
      risk: actionRiskFor(preflight.risk),
    };
  }
  return decision;
}

function actionRiskFor(risk: OperationalRiskLevel): ActionRisk {
  if (risk === 'SAFE') return 'READ_ONLY';
  if (risk === 'LOW') return 'LOW_RISK_ACTION';
  return 'CONFIRM_REQUIRED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
