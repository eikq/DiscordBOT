import type {
  CapabilityAvailabilityState,
  CapabilityDescriptor,
  CapabilityHandler,
  CapabilityHost,
  CapabilityInvokeRequest,
  CapabilityResult,
} from '../types';
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

export type ActionGateOptions = {
  policy?: PermissionPolicy | null;
  confirmations?: ConfirmationStore;
  audit?: ActionAuditLog;
  allowlists: DesktopAllowlists;
  now?: () => number;
  services?: import('./services').JarvisServiceController;
  leases?: PrivilegeLeaseStore;
  events?: JarvisEventBus;
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
  private readonly completed = new Map<string, CapabilityResult>();
  private readonly inflight = new Map<string, Promise<CapabilityResult>>();

  constructor(
    private readonly inner: CapabilityHost,
    private readonly options: ActionGateOptions,
  ) {
    this.policy = options.policy === undefined ? new PermissionPolicy() : options.policy;
    this.confirmations = options.confirmations ?? new ConfirmationStore({ now: options.now });
    this.services = options.services;
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
    if (!isGatedCapabilityId(request.id)) {
      return this.inner.invoke(request);
    }
    if (!this.inner.lookup(request.id)) {
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

    const proposal = this.createProposal(request, validated.value);
    const decision = this.policy.evaluate(proposal, this.options.allowlists);
    proposal.permissionDecision = decision;
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
        return this.requireConfirmation(proposal, decision);
      }
      if (request.confirmation.proposalId !== proposal.proposalId
        && request.confirmation.proposalId !== this.confirmations.peek(request.confirmation.proposalId)?.proposalId) {
        // Confirm path uses stored proposal via confirm(); invoke-with-token must match hashes.
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
    if (existing) return existing;

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
      const result = await this.inner.invoke({
        id: proposal.capabilityId,
        input,
        timeoutMs: request.timeoutMs,
      });
      const completedAt = new Date(this.now()).toISOString();
      const decorated: CapabilityResult = {
        ...result,
        structured: {
          ...result.structured,
          proposalId: proposal.proposalId,
          startedAt,
          completedAt,
          risk: result.structured?.risk ?? proposal.risk,
        },
      };
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

    this.inflight.set(key, work);
    try {
      const result = await work;
      this.completed.set(key, result);
      return result;
    } finally {
      this.inflight.delete(key);
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
  ): ActionProposal {
    const now = this.now();
    const meta = describeProposal(request.id, input, this.options.allowlists);
    return {
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

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
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
    || reasonCode === 'PRIVILEGE_STORE_UNAVAILABLE'
    || reasonCode === 'WINDOW_UNAVAILABLE'
    || reasonCode === 'DISPLAY_NOT_FOUND'
    || reasonCode === 'UNSUPPORTED_HOST'
    || reasonCode === 'PERMISSION_REQUIRED';
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
  if (capabilityId === 'desktop.openSettings') {
    const settingsId = String(input.settingsId ?? 'settings');
    return { displayName: settingsId, summary: `Open ${settingsId} settings`, target: settingsId, risk: 'LOW_RISK_ACTION' };
  }
  if (capabilityId === 'desktop.listDisplays') {
    return { displayName: 'Displays', summary: 'List displays', target: 'jarvis-window', risk: 'READ_ONLY' };
  }
  if (capabilityId === 'desktop.getJarvisWindow') {
    return { displayName: 'Jarvis window', summary: 'Read Jarvis window', target: 'jarvis-window', risk: 'READ_ONLY' };
  }
  if (capabilityId === 'desktop.moveJarvisWindow') {
    return { displayName: 'Move Jarvis', summary: 'Move Jarvis window', target: 'jarvis-window', risk: 'CONFIRM_REQUIRED' };
  }
  if (capabilityId === 'desktop.setJarvisWindowBounds') {
    return { displayName: 'Resize Jarvis', summary: 'Resize Jarvis window', target: 'jarvis-window', risk: 'CONFIRM_REQUIRED' };
  }
  if (capabilityId === 'desktop.focusJarvisWindow') {
    return { displayName: 'Focus Jarvis', summary: 'Focus Jarvis window', target: 'jarvis-window', risk: 'CONFIRM_REQUIRED' };
  }
  if (capabilityId === 'desktop.setJarvisLayout') {
    return { displayName: 'Jarvis layout', summary: 'Set Jarvis window layout', target: 'jarvis-window', risk: 'CONFIRM_REQUIRED' };
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
  if (
    proposal.capabilityId === 'desktop.listDisplays'
    || proposal.capabilityId === 'desktop.getJarvisWindow'
    || proposal.capabilityId === 'desktop.moveJarvisWindow'
    || proposal.capabilityId === 'desktop.setJarvisWindowBounds'
    || proposal.capabilityId === 'desktop.focusJarvisWindow'
    || proposal.capabilityId === 'desktop.setJarvisLayout'
  ) {
    return 'jarvis-window';
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
  return 'system:status';
}
