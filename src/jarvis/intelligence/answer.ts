import { isForbiddenGenericShell } from '../security/constants';
import { resolveCapabilityGoal } from './capabilityGraph';
import { CapabilityGapResolver } from './gapResolver';
import type {
  CapabilityGoalDefinition,
  GapResolutionPlan,
  SelfKnowledgeCapability,
  SelfKnowledgeSnapshot,
} from './types';

export type SelfKnowledgeAnswerKind =
  | 'CAPABILITY_SUMMARY'
  | 'AVAILABLE_NOW'
  | 'AFTER_SETUP'
  | 'NEEDS_SETUP'
  | 'NEEDS_PERMISSION'
  | 'CCTV_STATUS'
  | 'DEVICE_CONTROL'
  | 'COMPETENCE'
  | 'UNAVAILABLE'
  | 'GAP_EXPLANATION';

export type SelfKnowledgeAnswer = {
  kind: SelfKnowledgeAnswerKind;
  text: string;
  capabilityIds: string[];
  evidence: string[];
};

export type RequestedCapabilityInterpretation = {
  title: string;
  capabilityId: string;
  kind: 'FORBIDDEN_SHELL' | 'REGISTERED' | 'UNKNOWN';
};

const SETUP_STATUSES = [
  'NEEDS_CONFIGURATION',
  'NEEDS_OWNER_INPUT',
  'NEEDS_PROVIDER',
  'NEEDS_DEPENDENCY',
] as const;

const UNAVAILABLE_STATUSES = [
  'UNAVAILABLE',
  'UNSUPPORTED',
  'POLICY_BLOCKED',
  'UNKNOWN',
  'SIMULATION',
  'BLOCKED_LOCAL_ACCEPTANCE',
] as const;

export function selfKnowledgeQuestionKind(text: string): SelfKnowledgeAnswerKind | undefined {
  const raw = text.trim();
  if (!raw) return undefined;
  if (/\b(cctv|camera|nvr|rtsp|onvif)\b|กล้องวงจรปิด|กล้องบ้าน/iu.test(raw)) return 'CCTV_STATUS';
  if (/can you.*(?:control|use).*(?:computer|pc|screen)|ควบคุม.*(?:คอม|พีซี|หน้าจอ)/iu.test(raw)) return 'DEVICE_CONTROL';
  if (/what.*(?:become better|improved at)|what are you better at|เก่งขึ้น.*อะไร|พัฒนา.*ความสามารถ/iu.test(raw)) return 'COMPETENCE';
  if (/after setup|once (?:set ?up|configured)|หลังตั้งค่า|เมื่อตั้งค่าแล้ว|ทำอะไรได้หลังตั้งค่า/iu.test(raw)) return 'AFTER_SETUP';
  if (/need(?:s)? setup|need(?:s)? configuration|require(?:s)? setup|capabilities (?:that )?need setup|ต้องตั้งค่า|ยังไม่ได้ตั้งค่า/iu.test(raw)) {
    return 'NEEDS_SETUP';
  }
  if (/require(?:s)? (?:my )?permission|need(?:s)? (?:my )?permission|what requires my permission|ต้องขออนุญาต|ต้องการอนุญาต|permission required/iu.test(raw)) {
    return 'NEEDS_PERMISSION';
  }
  if (/what.*unavailable|currently unavailable|not currently available|อะไร.*ใช้ไม่ได้|ความสามารถ.*ยัง.*ไม่ได้/iu.test(raw)) {
    return 'UNAVAILABLE';
  }
  if (/why can(?:'|’)?t|why can you not|why (?:is|are) .+ (?:blocked|unavailable)|what do you need|ทำไม.*ไม่ได้|ต้องการอะไร.*จาก.*ผม/iu.test(raw)) {
    return 'GAP_EXPLANATION';
  }
  if (/(?:what can you do|ทำอะไรได้).*(?:right now|currently|ตอนนี้)|(?:right now|ตอนนี้).*(?:what can you do|ทำอะไรได้)/iu.test(raw)) {
    return 'AVAILABLE_NOW';
  }
  if (/what can you do|what are your capabilities|what goals can you|handle end to end|ทำอะไรได้บ้าง|ความสามารถ.*อะไร/iu.test(raw)) {
    return 'CAPABILITY_SUMMARY';
  }
  return undefined;
}

export function interpretRequestedCapability(
  text: string,
  snapshot: SelfKnowledgeSnapshot,
): RequestedCapabilityInterpretation {
  if (/powershell|pwsh|\bcmd\.exe\b|generic shell|unrestricted shell|\bbash\b|\/bin\/sh|\bosascript\b/iu.test(text)) {
    return {
      title: 'Run unrestricted PowerShell or a generic shell',
      capabilityId: 'shell.exec',
      kind: 'FORBIDDEN_SHELL',
    };
  }
  const extracted = extractRequestedName(text);
  const normalized = extracted.toLowerCase().replace(/\s+/gu, ' ').trim();
  const compact = normalized.replace(/[\s._-]+/gu, '');
  const match = snapshot.capabilities.find(item => {
    const id = item.id.toLowerCase();
    const name = item.displayName.toLowerCase();
    return id === normalized
      || name === normalized
      || id.replace(/[._-]+/gu, '') === compact
      || (normalized.length >= 4 && (id.includes(normalized.replace(/\s+/gu, '.')) || name.includes(normalized)));
  });
  if (match) {
    return { title: match.displayName, capabilityId: match.id, kind: 'REGISTERED' };
  }
  const slug = normalized.replace(/[^a-z0-9]+/giu, '.').replace(/^\.+|\.+$/gu, '').slice(0, 48) || 'unknown';
  return {
    title: extracted || 'the requested capability',
    capabilityId: `unknown.${slug}`,
    kind: 'UNKNOWN',
  };
}

export async function resolveSelfKnowledgeGap(
  text: string,
  snapshot: SelfKnowledgeSnapshot,
): Promise<GapResolutionPlan> {
  const requested = interpretRequestedCapability(text, snapshot);
  const goal: CapabilityGoalDefinition = {
    id: `gap:${requested.capabilityId}`,
    title: requested.title,
    dependencies: [{ capabilityId: requested.capabilityId, relation: 'REQUIRED' }],
  };
  return new CapabilityGapResolver().resolve({
    objective: requested.title,
    graph: resolveCapabilityGoal(goal, snapshot),
    snapshot,
  });
}

export function answerFromSelfKnowledge(
  kind: SelfKnowledgeAnswerKind,
  snapshot: SelfKnowledgeSnapshot,
  gap?: GapResolutionPlan,
  question?: string,
): SelfKnowledgeAnswer {
  if (kind === 'CCTV_STATUS') return cctvAnswer(snapshot, gap);
  if (kind === 'DEVICE_CONTROL') return deviceControlAnswer(snapshot);
  if (kind === 'COMPETENCE') return competenceAnswer(snapshot);
  if (kind === 'UNAVAILABLE') return listAnswer('UNAVAILABLE', unavailableCapabilities(snapshot), 'These capabilities are not currently available', 'The current evidence snapshot does not list an unavailable capability.');
  if (kind === 'NEEDS_SETUP') return listAnswer('NEEDS_SETUP', setupCapabilities(snapshot), 'These capabilities need setup, a provider, owner input, or local acceptance', 'No registered capability currently reports a setup gap.');
  if (kind === 'NEEDS_PERMISSION') return permissionAnswer(snapshot);
  if (kind === 'AFTER_SETUP') return afterSetupAnswer(snapshot);
  if (kind === 'AVAILABLE_NOW') return availableNowAnswer(snapshot);
  if (kind === 'GAP_EXPLANATION') {
    return gapExplanationAnswer(snapshot, gap, question ? interpretRequestedCapability(question, snapshot) : undefined);
  }
  return capabilitySummaryAnswer(snapshot);
}

function capabilitySummaryAnswer(snapshot: SelfKnowledgeSnapshot): SelfKnowledgeAnswer {
  const ready = availableCapabilities(snapshot);
  const simulations = snapshot.capabilities.filter(item => item.status === 'SIMULATION');
  const setup = setupCapabilities(snapshot);
  const names = ready.slice(0, 10).map(item => item.displayName);
  const goalNow = snapshot.goals.filter(item => item.status === 'CAN_DO_NOW');
  const goalApproval = snapshot.goals.filter(item => item.status === 'NEEDS_APPROVAL');
  const goalSetup = snapshot.goals.filter(item => item.status === 'AFTER_SETUP');
  return {
    kind: 'CAPABILITY_SUMMARY',
    text: [
      `I am Jarvis, the owner's local operational assistant. ${ready.length} registered capabilities currently report available.`,
      names.length ? `Available now: ${names.join(', ')}.` : 'No capability currently has enough runtime evidence to report AVAILABLE.',
      goalNow.length ? `End-to-end goals ready now: ${goalNow.map(item => item.name).join(', ')}.` : 'No end-to-end goal currently has complete runtime evidence.',
      goalApproval.length ? `${goalApproval.length} declared goal routes need owner approval.` : '',
      goalSetup.length ? `${goalSetup.length} declared goal routes need setup or provider evidence.` : '',
      simulations.length ? `${simulations.length} capability contracts are simulation-only.` : '',
      setup.length ? `${setup.length} capabilities need setup, a provider, or precise owner input.` : '',
      'My model can propose plans, but CapabilityHost, policy, permission, Emergency Stop, verification, rollback, and containment determine what I can actually execute.',
    ].filter(Boolean).join(' '),
    capabilityIds: ready.map(item => item.id),
    evidence: [...goalNow.flatMap(item => item.evidence), ...ready.flatMap(item => item.evidence)].slice(0, 16),
  };
}

function availableNowAnswer(snapshot: SelfKnowledgeSnapshot): SelfKnowledgeAnswer {
  const ready = availableCapabilities(snapshot);
  const goalNow = snapshot.goals.filter(item => item.status === 'CAN_DO_NOW');
  return {
    kind: 'AVAILABLE_NOW',
    text: [
      ready.length
        ? `Right now, runtime evidence reports these capabilities available: ${ready.slice(0, 12).map(item => item.displayName).join(', ')}.`
        : 'No capability currently has enough runtime evidence to report AVAILABLE.',
      goalNow.length ? `End-to-end goals ready now: ${goalNow.map(item => item.name).join(', ')}.` : 'No end-to-end goal currently has complete runtime evidence.',
      'Availability comes from CapabilityHost evidence, not from the conversational model.',
    ].join(' '),
    capabilityIds: ready.map(item => item.id),
    evidence: [...ready, ...goalNow].flatMap(item => item.evidence).slice(0, 16),
  };
}

function afterSetupAnswer(snapshot: SelfKnowledgeSnapshot): SelfKnowledgeAnswer {
  const setup = setupCapabilities(snapshot);
  const goals = snapshot.goals.filter(item => item.status === 'AFTER_SETUP' || item.status === 'PARTIAL');
  const lines = setup.slice(0, 8).map(item => `${item.displayName}: ${item.status} — ${item.reason}`);
  return {
    kind: 'AFTER_SETUP',
    text: [
      setup.length
        ? `After setup, provider configuration, or owner input, these capabilities could become usable:\n${lines.map(item => `• ${item}`).join('\n')}`
        : 'No capability currently records a setup-gated path to availability.',
      goals.length ? `Declared goals waiting on setup: ${goals.map(item => item.name).join(', ')}.` : '',
      'I do not treat setup-gated contracts as live, and CCTV remains not-live until a reviewed local provider is accepted.',
    ].filter(Boolean).join(' '),
    capabilityIds: setup.map(item => item.id),
    evidence: [...setup, ...goals].flatMap(item => item.evidence).slice(0, 16),
  };
}

function permissionAnswer(snapshot: SelfKnowledgeSnapshot): SelfKnowledgeAnswer {
  const gated = snapshot.capabilities.filter(needsPermission);
  const goals = snapshot.goals.filter(item => item.status === 'NEEDS_APPROVAL');
  const lines = gated.slice(0, 8).map(item => `${item.displayName}: ${item.permission.class} — authority is not granted by Self Knowledge.`);
  return {
    kind: 'NEEDS_PERMISSION',
    text: [
      gated.length
        ? `These capabilities require owner permission, a privilege lease, or ActionGate approval before execution:\n${lines.map(item => `• ${item}`).join('\n')}`
        : 'No registered capability currently records an owner-permission or privilege requirement.',
      goals.length ? `Declared goals that still need an owner decision: ${goals.map(item => item.name).join(', ')}.` : '',
      'Self Knowledge never grants permission, leases, or Emergency Stop resume.',
    ].filter(Boolean).join(' '),
    capabilityIds: gated.map(item => item.id),
    evidence: [
      ...gated.flatMap(item => item.evidence),
      ...goals.flatMap(item => item.evidence),
    ].slice(0, 16),
  };
}

function listAnswer(
  kind: SelfKnowledgeAnswerKind,
  items: SelfKnowledgeCapability[],
  heading: string,
  empty: string,
): SelfKnowledgeAnswer {
  const lines = items.slice(0, 8).map(item => `${item.displayName}: ${item.status} — ${item.reason}`);
  const blockedLocal = items.filter(item => item.localAcceptance === 'BLOCKED_LOCAL_ACCEPTANCE');
  return {
    kind,
    text: [
      lines.length ? `${heading}:\n${lines.map(item => `• ${item}`).join('\n')}` : empty,
      blockedLocal.length ? `${blockedLocal.length} of these remain BLOCKED_LOCAL_ACCEPTANCE and are not live.` : '',
    ].filter(Boolean).join(' '),
    capabilityIds: items.map(item => item.id),
    evidence: items.flatMap(item => item.evidence).slice(0, 12),
  };
}

function gapExplanationAnswer(
  snapshot: SelfKnowledgeSnapshot,
  gap?: GapResolutionPlan,
  requested?: RequestedCapabilityInterpretation,
): SelfKnowledgeAnswer {
  const alternatives = availableCapabilities(snapshot).slice(0, 8);
  const altText = alternatives.length
    ? `Typed capabilities currently reporting available include: ${alternatives.map(item => item.displayName).join(', ')}.`
    : 'No typed capability currently reports AVAILABLE.';
  const requestedId = requested?.capabilityId || gap?.missing[0]?.capabilityId || '';
  if (requested?.kind === 'FORBIDDEN_SHELL' || isForbiddenGenericShell(requestedId)) {
    return {
      kind: 'GAP_EXPLANATION',
      text: [
        'Unrestricted PowerShell is not a registered Jarvis capability.',
        'Generic shell identifiers such as shell.exec are policy-forbidden.',
        'I do not have administrator authority, and execution remains scope- and risk-controlled.',
        altText,
        'A specific owner goal may already be possible through those typed handlers.',
        'Adding a new shell capability would require acquisition, review, tests, and owner approval, and would still not become unrestricted production shell.',
      ].join(' '),
      capabilityIds: alternatives.map(item => item.id),
      evidence: [
        'policy:GENERIC_SHELL_FORBIDDEN',
        `capability:${requestedId || 'shell.exec'}:UNSUPPORTED`,
        ...alternatives.flatMap(item => item.evidence),
        ...(gap?.evidence ?? []),
      ].slice(0, 16),
    };
  }
  if (requested?.kind === 'UNKNOWN' || gap?.missing.some(item => item.currentState === 'UNSUPPORTED' || item.currentState === 'UNKNOWN')) {
    const blocker = gap?.missing[0];
    return {
      kind: 'GAP_EXPLANATION',
      text: [
        `I do not have a registered capability for ${requested?.title || 'that request'}.`,
        blocker ? `Current evidence marks it ${blocker.currentState} (${blocker.blocker}): ${blocker.reason}` : 'Current evidence marks this as UNSUPPORTED.',
        'I will not invent a provider or claim that I can do it.',
        altText,
        gap?.recommendedPath
          ? `The safest recorded next path is: ${gap.recommendedPath.title}`
          : 'A new capability would require acquisition, review, and owner approval before execution.',
      ].join(' '),
      capabilityIds: [...(gap?.missing.map(item => item.capabilityId) ?? [requested?.capabilityId].filter(Boolean) as string[])],
      evidence: (gap?.evidence ?? [`capability:${requested?.capabilityId || 'unknown'}:UNSUPPORTED`]).slice(0, 16),
    };
  }
  if (gap && gap.status === 'READY' && gap.missing.length === 0) {
    return {
      kind: 'GAP_EXPLANATION',
      text: [
        `Current runtime evidence shows ${requested?.title || gap.goal} is available as a typed capability.`,
        'I do not invent extra blockers.',
        'Policy, permission, Emergency Stop, and verification still apply before any mutation.',
      ].join(' '),
      capabilityIds: gap.recommendedPath?.capabilityIds ?? alternatives.map(item => item.id),
      evidence: gap.evidence.slice(0, 16),
    };
  }
  const blocker = gap?.missing[0];
  return {
    kind: 'GAP_EXPLANATION',
    text: blocker
      ? `I cannot complete that path yet because ${blocker.blocker}: ${blocker.reason} ${gap?.recommendedPath ? `The safest next path is: ${gap.recommendedPath.title}` : ''} ${altText}`.trim()
      : `No structured blocker is recorded for ${requested?.title || 'that objective'}. ${altText}`,
    capabilityIds: gap?.missing.map(item => item.capabilityId) ?? [],
    evidence: (gap?.evidence ?? []).slice(0, 16),
  };
}

function deviceControlAnswer(snapshot: SelfKnowledgeSnapshot): SelfKnowledgeAnswer {
  const relevant = snapshot.capabilities.filter(item => /^(?:desktop|screen|computer|devices?)\./u.test(item.id));
  const available = relevant.filter(item => item.status === 'AVAILABLE' && item.implementation.mode === 'REAL');
  return {
    kind: 'DEVICE_CONTROL',
    text: available.length
      ? `I do not have unrestricted computer control. These exact scoped actions currently report available: ${available.map(item => item.displayName).join(', ')}. Every action still passes policy and permission; SEE, CLICK, TYPE, SUBMIT, CONFIGURE, and ADMIN remain separate authority classes.`
      : 'No structured runtime evidence grants live computer control right now. Screen and owner-machine interaction still need a reviewed local provider, scoped owner permission, deterministic verification, and local acceptance. SEE does not grant CLICK, TYPE, SUBMIT, CONFIGURE, or ADMIN.',
    capabilityIds: relevant.map(item => item.id),
    evidence: relevant.flatMap(item => item.evidence).slice(0, 16),
  };
}

function competenceAnswer(snapshot: SelfKnowledgeSnapshot): SelfKnowledgeAnswer {
  const verified = snapshot.competence
    .filter(item => item.verifiedSuccesses > 0)
    .sort((a, b) => b.verifiedSuccesses - a.verifiedSuccesses || a.capability.localeCompare(b.capability));
  return {
    kind: 'COMPETENCE',
    text: verified.length
      ? `My evidence-backed improvements are: ${verified.slice(0, 8).map(item => `${item.capability} (${item.verifiedSuccesses} verified success${item.verifiedSuccesses === 1 ? '' : 'es'}${item.confidence === null ? ', confidence not yet established' : `, ${Math.round(item.confidence * 100)}% confidence`})`).join('; ')}. Reflections and unverified handler success do not count as proven improvement.`
      : 'I do not yet have enough independently verified outcomes to claim that I have become better at a capability. Reflections and unverified handler success do not count as proof.',
    capabilityIds: verified.map(item => item.capability),
    evidence: verified.flatMap(item => item.evidenceRefs).slice(0, 16),
  };
}

function cctvAnswer(snapshot: SelfKnowledgeSnapshot, gap?: GapResolutionPlan): SelfKnowledgeAnswer {
  const cctv = snapshot.capabilities.filter(item => item.id.startsWith('cctv.'));
  const live = cctv.filter(item => item.status === 'AVAILABLE' && item.implementation.mode === 'REAL');
  const missing = gap?.missing ?? [];
  return {
    kind: 'CCTV_STATUS',
    text: live.length
      ? `A real CCTV provider reports available for: ${live.map(item => item.displayName).join(', ')}. Viewing still does not grant control, configuration, or administration.`
      : [
          'CCTV is not live right now. The current device view is simulation-only and the real CCTV provider remains a prepared owner-only contract.',
          'To connect your home system later, I need the camera/NVR vendor and model, LAN address, supported protocol such as RTSP or ONVIF, stream identity, and a local secret reference for credentials.',
          'The safe path is: identify the device → confirm protocol from trusted documentation → create a bounded local profile → request credentials through local secret storage → test status/snapshot → verify the stream → mark only CCTV.VIEW available.',
          missing[0] ? `Current blocker: ${missing[0].blocker}.` : '',
          'No broad LAN scan, cloud upload, or VIEW-to-CONTROL promotion is authorized.',
        ].filter(Boolean).join(' '),
    capabilityIds: cctv.map(item => item.id),
    evidence: [...cctv.flatMap(item => item.evidence), ...(gap?.evidence ?? [])].slice(0, 16),
  };
}

function availableCapabilities(snapshot: SelfKnowledgeSnapshot): SelfKnowledgeCapability[] {
  return snapshot.capabilities.filter(item => item.status === 'AVAILABLE' && item.implementation.mode === 'REAL');
}

function setupCapabilities(snapshot: SelfKnowledgeSnapshot): SelfKnowledgeCapability[] {
  return snapshot.capabilities.filter(item =>
    (SETUP_STATUSES as readonly string[]).includes(item.status)
    || item.localAcceptance === 'BLOCKED_LOCAL_ACCEPTANCE');
}

function unavailableCapabilities(snapshot: SelfKnowledgeSnapshot): SelfKnowledgeCapability[] {
  return snapshot.capabilities.filter(item =>
    (UNAVAILABLE_STATUSES as readonly string[]).includes(item.status)
    || item.localAcceptance === 'BLOCKED_LOCAL_ACCEPTANCE');
}

function needsPermission(item: SelfKnowledgeCapability): boolean {
  return item.status === 'NEEDS_PERMISSION'
    || item.permission.ownerApprovalRequired
    || item.permission.privilegeRequired;
}

function extractRequestedName(text: string): string {
  const raw = text.trim();
  const patterns = [
    /what do you need(?: from me)? to (?:do |run |use |access )?(.+?)\??$/iu,
    /why can(?:'|’)?t you (?:do |run |use |access |execute )?(.+?)\??$/iu,
    /why can you not (?:do |run |use |access |execute )?(.+?)\??$/iu,
    /ทำไม.*(?:รัน|ทำ|ใช้)\s*(.+?)\s*ไม่ได้/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (match?.[1]) return match[1].replace(/[?!.,]/gu, ' ').trim().slice(0, 120);
  }
  return raw.slice(0, 120);
}
