/**
 * Deterministic Presence runtime mapping.
 * Observable Command Center / ask / operator state only — no invented telemetry.
 */

import type { LabCorePhase } from '../labUiState';

export const PRESENCE_PHASES = [
  'IDLE',
  'LISTENING',
  'UNDERSTANDING',
  'THINKING',
  'RESEARCHING',
  'PLANNING',
  'WAITING_OWNER',
  'EXECUTING',
  'VERIFYING',
  'SPEAKING',
  'EVOLVING',
  'WARNING',
  'CRITICAL',
  'EMERGENCY_STOP',
  'OFFLINE',
] as const;

export type PresencePhase = (typeof PRESENCE_PHASES)[number];

export type PresenceHudKind =
  | 'none'
  | 'permission'
  | 'waiting-input'
  | 'execution'
  | 'verification'
  | 'research'
  | 'system'
  | 'reminder'
  | 'cctv'
  | 'media'
  | 'desktop'
  | 'attention';

export type PresenceAttention = {
  id: string;
  title: string;
  detail: string;
  tone: 'info' | 'warning' | 'critical';
  kind: 'permission' | 'emergency' | 'reminder' | 'task' | 'briefing' | 'recommendation';
};

export type PresenceShellCommand =
  | { kind: 'none' }
  | { kind: 'control-center' }
  | { kind: 'presence' }
  | { kind: 'ambient-on' }
  | { kind: 'ambient-off' }
  | { kind: 'emergency-stop' }
  | { kind: 'attention' };

export type PresenceApprovalTarget =
  | { kind: 'none' }
  | { kind: 'ambiguous' }
  | { kind: 'confirm'; proposalId: string; token: string; label: string }
  | { kind: 'grant'; taskId: string; stepId?: string; proposalId?: string; capability?: string; label: string };

export type PresenceOwnerReply =
  | { kind: 'allow'; target: Extract<PresenceApprovalTarget, { kind: 'confirm' | 'grant' }> }
  | { kind: 'deny'; target: Extract<PresenceApprovalTarget, { kind: 'confirm' | 'grant' }> }
  | { kind: 'unbound' }
  | { kind: 'ambiguous' }
  | { kind: 'not-approval' };

export const DESKTOP_AUTHORITY_CLASSES = ['SEE', 'OPEN', 'CLICK', 'TYPE', 'SUBMIT'] as const;
export type DesktopAuthorityClass = (typeof DESKTOP_AUTHORITY_CLASSES)[number];

const CONFIRM = /^(yes|y|ok|okay|allow|allow once|proceed|do it|go ahead|approved|ได้|ตกลง|อนุญาต|อนุญาตครั้งนี้|เปิดได้|เอาเลย|ใช่|ทำเลย|ดำเนินการ|โอเค ทำต่อ)$/iu;
const DENY = /^(no|n|deny|cancel|cancel it|stop|don'?t|dont|never mind|ไม่|ไม่อนุญาต|ยกเลิก|ปฏิเสธ)$/iu;

export function stripJarvisAddress(text: string): string {
  return text.replace(/^\s*(jarvis[,:]?\s*)+/iu, '').trim();
}

export function derivePresencePhase(input: {
  busy?: boolean;
  error?: string | null;
  ready?: boolean;
  llmReachable?: boolean;
  attention?: boolean;
  micState?: 'idle' | 'listening' | 'transcribing';
  speechState?: 'idle' | 'loading' | 'speaking';
  visualState?: string;
  labPhase?: LabCorePhase;
  emergencyActive?: boolean;
  waitingPermission?: boolean;
  waitingOwnerInput?: boolean;
  taskActive?: boolean;
}): PresencePhase {
  if (input.emergencyActive) return 'EMERGENCY_STOP';
  if (input.ready === false && input.llmReachable === false && !input.busy) return 'OFFLINE';
  if (input.waitingPermission) return 'WAITING_OWNER';
  if (input.waitingOwnerInput && !input.busy) return 'WAITING_OWNER';
  if (input.micState === 'listening' || input.attention) return 'LISTENING';
  if (input.micState === 'transcribing') return 'UNDERSTANDING';
  if (input.speechState === 'speaking') return 'SPEAKING';
  const visual = presencePhaseFromVisual(input.visualState);
  if (visual && honorVisualWhileIdle(visual, input)) return visual;
  if (input.labPhase) return presencePhaseFromLab(input.labPhase);
  if (input.error) return 'CRITICAL';
  if (input.busy) return 'THINKING';
  if (input.ready === false) return 'WARNING';
  return 'IDLE';
}

function honorVisualWhileIdle(visual: PresencePhase, input: {
  busy?: boolean;
  waitingPermission?: boolean;
  waitingOwnerInput?: boolean;
  taskActive?: boolean;
  speechState?: 'idle' | 'loading' | 'speaking';
}): boolean {
  if (input.busy || input.waitingPermission || input.waitingOwnerInput || input.taskActive) return true;
  if (visual === 'WAITING_OWNER' || visual === 'WARNING' || visual === 'CRITICAL' || visual === 'EMERGENCY_STOP' || visual === 'EVOLVING') {
    return true;
  }
  if (visual === 'SPEAKING') return input.speechState === 'speaking';
  return false;
}

export function presencePhaseFromVisual(state?: string): PresencePhase | null {
  if (!state || state === 'IDLE') return null;
  switch (state) {
    case 'LISTENING':
      return 'LISTENING';
    case 'UNDERSTANDING':
      return 'UNDERSTANDING';
    case 'MODEL_GENERATING':
      return 'THINKING';
    case 'WEB_SEARCH':
    case 'WORKSPACE_SEARCH':
    case 'PRIVATE_RESEARCH':
    case 'FETCHING':
    case 'COMPARING':
      return 'RESEARCHING';
    case 'PLANNING':
      return 'PLANNING';
    case 'WAITING_PERMISSION':
      return 'WAITING_OWNER';
    case 'EXECUTING':
      return 'EXECUTING';
    case 'VERIFYING':
      return 'VERIFYING';
    case 'SPEAKING':
      return 'SPEAKING';
    case 'RESPONDING':
      return 'THINKING';
    case 'REFLECTING':
    case 'LEARNING':
    case 'EVOLVING':
      return 'EVOLVING';
    case 'ERROR':
      return 'CRITICAL';
    case 'DEGRADED':
      return 'WARNING';
    default:
      return null;
  }
}

export function presencePhaseFromLab(phase: LabCorePhase): PresencePhase {
  switch (phase) {
    case 'listening':
      return 'LISTENING';
    case 'transcribing':
      return 'UNDERSTANDING';
    case 'thinking':
    case 'responding':
      return 'THINKING';
    case 'searching':
      return 'RESEARCHING';
    case 'planning':
      return 'PLANNING';
    case 'permission':
      return 'WAITING_OWNER';
    case 'executing':
    case 'tool':
      return 'EXECUTING';
    case 'verifying':
      return 'VERIFYING';
    case 'speaking':
      return 'SPEAKING';
    case 'evolving':
    case 'reflecting':
      return 'EVOLVING';
    case 'degraded':
      return 'WARNING';
    case 'error':
      return 'CRITICAL';
    case 'memory':
      return 'THINKING';
    default:
      return 'IDLE';
  }
}

export function presencePhaseToLab(phase: PresencePhase): LabCorePhase {
  switch (phase) {
    case 'LISTENING':
      return 'listening';
    case 'UNDERSTANDING':
      return 'transcribing';
    case 'THINKING':
      return 'thinking';
    case 'RESEARCHING':
      return 'searching';
    case 'PLANNING':
      return 'planning';
    case 'WAITING_OWNER':
      return 'permission';
    case 'EXECUTING':
      return 'executing';
    case 'VERIFYING':
      return 'verifying';
    case 'SPEAKING':
      return 'speaking';
    case 'EVOLVING':
      return 'evolving';
    case 'WARNING':
      return 'degraded';
    case 'CRITICAL':
    case 'EMERGENCY_STOP':
      return 'error';
    case 'OFFLINE':
      return 'degraded';
    default:
      return 'idle';
  }
}

export function presencePhaseLabel(phase: PresencePhase): string {
  switch (phase) {
    case 'IDLE':
      return 'Awaiting the owner';
    case 'LISTENING':
      return 'Listening';
    case 'UNDERSTANDING':
      return 'Understanding';
    case 'THINKING':
      return 'Thinking';
    case 'RESEARCHING':
      return 'Researching';
    case 'PLANNING':
      return 'Planning';
    case 'WAITING_OWNER':
      return 'Waiting for you';
    case 'EXECUTING':
      return 'Executing';
    case 'VERIFYING':
      return 'Verifying';
    case 'SPEAKING':
      return 'Speaking';
    case 'EVOLVING':
      return 'Evolving';
    case 'WARNING':
      return 'Attention';
    case 'CRITICAL':
      return 'Critical';
    case 'EMERGENCY_STOP':
      return 'Emergency stop';
    case 'OFFLINE':
      return 'Offline';
  }
}

export function derivePresenceHud(input: {
  phase: PresencePhase;
  waitingPermission?: boolean;
  waitingOwnerInput?: boolean;
  taskActive?: boolean;
  verificationComplete?: boolean;
  researchActive?: boolean;
  researchSources?: number;
  systemAsked?: boolean;
  reminderPending?: boolean;
  reminderActive?: boolean;
  cctvAsked?: boolean;
  mediaAsked?: boolean;
  desktopAsked?: boolean;
  attentionCount?: number;
}): PresenceHudKind {
  if (input.waitingPermission || (input.phase === 'WAITING_OWNER' && !input.waitingOwnerInput)) return 'permission';
  if (input.waitingOwnerInput) return 'waiting-input';
  if (input.phase === 'EXECUTING' || (input.taskActive && input.phase !== 'IDLE' && input.phase !== 'VERIFYING')) {
    return 'execution';
  }
  if (input.phase === 'VERIFYING' || input.verificationComplete) return 'verification';
  if (input.phase === 'RESEARCHING' || input.researchActive) return 'research';
  if (input.systemAsked) return 'system';
  if (input.reminderPending || input.reminderActive) return 'reminder';
  if (input.cctvAsked) return 'cctv';
  if (input.mediaAsked) return 'media';
  if (input.desktopAsked) return 'desktop';
  if ((input.attentionCount ?? 0) > 0) return 'attention';
  return 'none';
}

export function collectPresenceAttention(input: {
  emergencyActive?: boolean;
  waitingPermission?: boolean;
  permissionLabel?: string;
  waitingOwnerInput?: boolean;
  waitingQuestion?: string;
  reminderPendingCount?: number;
  taskActive?: boolean;
  taskObjective?: string;
  degraded?: boolean;
}): PresenceAttention[] {
  const items: PresenceAttention[] = [];
  if (input.emergencyActive) {
    items.push({
      id: 'emergency',
      title: 'Emergency Stop is active',
      detail: 'Autonomous work stays suspended until the owner resumes.',
      tone: 'critical',
      kind: 'emergency',
    });
  }
  if (input.waitingPermission) {
    items.push({
      id: 'permission',
      title: 'Approval required',
      detail: input.permissionLabel || 'A scoped action is waiting for Allow Once.',
      tone: 'warning',
      kind: 'permission',
    });
  }
  if (input.waitingOwnerInput) {
    items.push({
      id: 'input',
      title: 'Jarvis needs one answer',
      detail: input.waitingQuestion || 'One declared field is still missing.',
      tone: 'warning',
      kind: 'task',
    });
  }
  if ((input.reminderPendingCount ?? 0) > 0) {
    items.push({
      id: 'reminder',
      title: 'Reminder due',
      detail: `${input.reminderPendingCount} local reminder${input.reminderPendingCount === 1 ? '' : 's'} waiting acknowledgement.`,
      tone: 'info',
      kind: 'reminder',
    });
  }
  if (input.taskActive && input.taskObjective) {
    items.push({
      id: 'task',
      title: 'Current work',
      detail: input.taskObjective,
      tone: 'info',
      kind: 'task',
    });
  }
  if (input.degraded) {
    items.push({
      id: 'runtime',
      title: 'Runtime limited',
      detail: 'One or more required services are degraded.',
      tone: 'warning',
      kind: 'briefing',
    });
  }
  return items;
}

export function interpretPresenceShellCommand(text: string): PresenceShellCommand {
  const raw = stripJarvisAddress(text).toLowerCase();
  if (!raw) return { kind: 'none' };
  if (/emergency stop|halt everything|หยุดฉุกเฉิน|emergency-stop/.test(raw)) return { kind: 'emergency-stop' };
  if (/open control center|open the control center|show control center|open dashboard|เปิด control center|เปิดแดชบอร์ด/.test(raw)) {
    return { kind: 'control-center' };
  }
  if (/open presence|return to jarvis|back to jarvis|กลับไป jarvis|เปิด presence/.test(raw)) {
    return { kind: 'presence' };
  }
  if (/go ambient|ambient mode|presence mode|cinema mode|เข้า ambient|โหมด ambient|โหมดจอใหญ่/.test(raw) && /off|exit|leave|ปิด/.test(raw)) {
    return { kind: 'ambient-off' };
  }
  if (/go ambient|ambient mode|presence mode|cinema mode|เข้า ambient|โหมด ambient|โหมดจอใหญ่/.test(raw)) return { kind: 'ambient-on' };
  if (/what(?:'s| is) happening|what's going on|what needs my attention|anything important|do i need to know|สถานะงาน|ต้องการความสนใจ|มีอะไรสำคัญไหม|ตอนนี้เป็นยังไงบ้าง/.test(raw)) {
    return { kind: 'attention' };
  }
  return { kind: 'none' };
}

export function resolvePresenceApproval(input: {
  pendingConfirmation?: { proposalId?: string; token?: string; displayName?: string; capabilityId?: string } | null;
  waitingPermission?: {
    waiting?: boolean;
    taskId?: string;
    stepId?: string;
    proposalId?: string;
    capability?: string;
  } | null;
}): PresenceApprovalTarget {
  const confirm = input.pendingConfirmation;
  const waiting = input.waitingPermission?.waiting ? input.waitingPermission : null;
  const confirmReady = Boolean(confirm?.proposalId && confirm.token);
  const grantReady = Boolean(waiting?.taskId);
  if (confirmReady && grantReady && confirm?.proposalId && waiting?.proposalId && confirm.proposalId !== waiting.proposalId) {
    return { kind: 'ambiguous' };
  }
  if (confirmReady && confirm?.proposalId && confirm.token) {
    return {
      kind: 'confirm',
      proposalId: confirm.proposalId,
      token: confirm.token,
      label: confirm.displayName || confirm.capabilityId || 'Scoped action',
    };
  }
  if (grantReady && waiting?.taskId) {
    return {
      kind: 'grant',
      taskId: waiting.taskId,
      stepId: waiting.stepId,
      proposalId: waiting.proposalId,
      capability: waiting.capability,
      label: waiting.capability || 'Scoped task',
    };
  }
  return { kind: 'none' };
}

export function interpretPresenceOwnerReply(text: string, target: PresenceApprovalTarget): PresenceOwnerReply {
  const raw = stripJarvisAddress(text).replace(/[.!?]+$/u, '').trim();
  const isConfirm = CONFIRM.test(raw);
  const isDeny = DENY.test(raw);
  if (!isConfirm && !isDeny) return { kind: 'not-approval' };
  if (target.kind === 'ambiguous') return { kind: 'ambiguous' };
  if (target.kind === 'none') return { kind: 'unbound' };
  return { kind: isConfirm ? 'allow' : 'deny', target };
}

export function inferDesktopAuthorityClass(text: string): DesktopAuthorityClass | null {
  const raw = stripJarvisAddress(text).toLowerCase();
  if (/\b(click|tap|press)\b|คลิก/.test(raw)) return 'CLICK';
  if (/\b(type|enter text|fill)\b|พิมพ์/.test(raw)) return 'TYPE';
  if (/\b(submit|send form)\b|ส่งฟอร์ม/.test(raw)) return 'SUBMIT';
  if (/\b(see|look at|show me the screen|what's on (the )?screen)\b|ดูหน้าจอ/.test(raw)) return 'SEE';
  if (/\b(open|launch|start)\b|เปิด/.test(raw)) return 'OPEN';
  return null;
}

export function desktopAuthorityMaturity(kind: DesktopAuthorityClass): {
  state: 'REAL' | 'PREPARE_CONTRACT';
  note: string;
} {
  if (kind === 'OPEN') {
    return {
      state: 'REAL',
      note: 'Allowlisted OPEN actions exist. CLICK, TYPE, and SUBMIT remain separately authorized and are not implied.',
    };
  }
  return {
    state: 'PREPARE_CONTRACT',
    note: `${kind} is a separate authority class from OPEN. Live screen SEE/CLICK/TYPE/SUBMIT still needs a reviewed local provider and owner-machine acceptance.`,
  };
}

export function formatAttentionSpoken(items: PresenceAttention[]): string {
  if (!items.length) return 'Nothing needs your attention right now.';
  const lead = items[0]!;
  if (items.length === 1) return `${lead.title}. ${lead.detail}`;
  return `${items.length} items need attention. First: ${lead.title}. ${lead.detail}`;
}

export function formatTaskStatusSpoken(task: {
  active?: boolean;
  status?: string;
  objective?: string;
  waitingPermission?: boolean;
  waitingOwnerInput?: boolean;
  waitingInput?: { question?: string } | null;
  steps?: Array<{ state: string; title: string }>;
  errors?: string[];
} | null): string {
  if (!task?.active && !task?.status) return 'I am not running a task right now.';
  if (task.waitingPermission) return `I am waiting for your permission${task.objective ? ` on ${task.objective}` : ''}.`;
  if (task.waitingOwnerInput) return task.waitingInput?.question || 'I am waiting for one missing field.';
  const failed = task.steps?.find(step => step.state === 'failed');
  if (failed || task.errors?.length) {
    return `A verified step failed${failed ? `: ${failed.title}` : ''}${task.errors?.[0] ? `. ${task.errors[0]}` : ''}.`;
  }
  const active = task.steps?.find(step => step.state === 'active' || step.state === 'waiting');
  const done = task.steps?.filter(step => step.state === 'done').length ?? 0;
  const total = task.steps?.length ?? 0;
  if (active && total > 0) return `I am on ${active.title}. ${done} of ${total} verified steps are done.`;
  if (total > 0) return `${task.objective || 'Current work'}: ${task.status}. ${done} of ${total} verified steps are done.`;
  return `${task.objective || 'Current work'} is ${task.status}.`;
}

export function isCancelLikeUnbound(text: string): boolean {
  return /cancel that|cancel it|never mind|stop this|ยกเลิก|ไม่ต้องทำแล้ว|หยุดงานนี้/iu.test(text)
    && !/emergency/iu.test(text);
}

export function isPresenceAmbientPath(pathname: string, search = ''): boolean {
  if (pathname === '/jarvis/ambient') return true;
  return pathname === '/jarvis' && /(?:^|[?&])mode=ambient(?:&|$)/.test(search);
}

export function isPresencePath(pathname: string): boolean {
  return pathname === '/jarvis' || pathname.startsWith('/jarvis/');
}

export function isControlCenterPath(pathname: string): boolean {
  return pathname === '/jarvis-lab' || pathname.startsWith('/jarvis-lab/');
}
