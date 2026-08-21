import type { GapResolutionPlan, SelfKnowledgeSnapshot } from './types';

export type SelfKnowledgeAnswer = {
  kind: 'CAPABILITY_SUMMARY' | 'CCTV_STATUS' | 'DEVICE_CONTROL' | 'COMPETENCE' | 'UNAVAILABLE' | 'GAP_EXPLANATION';
  text: string;
  capabilityIds: string[];
  evidence: string[];
};

export function selfKnowledgeQuestionKind(text: string): SelfKnowledgeAnswer['kind'] | undefined {
  if (/\b(cctv|camera|nvr|rtsp|onvif)\b|กล้องวงจรปิด|กล้องบ้าน/iu.test(text)) return 'CCTV_STATUS';
  if (/can you.*(?:control|use).*(?:computer|pc|screen)|ควบคุม.*(?:คอม|พีซี|หน้าจอ)/iu.test(text)) return 'DEVICE_CONTROL';
  if (/what.*(?:become better|improved at)|what are you better at|เก่งขึ้น.*อะไร|พัฒนา.*ความสามารถ/iu.test(text)) return 'COMPETENCE';
  if (/what can you do|what are your capabilities|what goals can you|handle end to end|ทำอะไรได้บ้าง|ความสามารถ.*อะไร/iu.test(text)) return 'CAPABILITY_SUMMARY';
  if (/what.*unavailable|currently unavailable|อะไร.*ใช้ไม่ได้|ความสามารถ.*ยัง.*ไม่ได้/iu.test(text)) return 'UNAVAILABLE';
  if (/why can.?t|what do you need|ทำไม.*ไม่ได้|ต้องการอะไร.*จาก.*ผม/iu.test(text)) return 'GAP_EXPLANATION';
  return undefined;
}

export function answerFromSelfKnowledge(
  kind: SelfKnowledgeAnswer['kind'],
  snapshot: SelfKnowledgeSnapshot,
  gap?: GapResolutionPlan,
): SelfKnowledgeAnswer {
  if (kind === 'CCTV_STATUS') return cctvAnswer(snapshot, gap);
  if (kind === 'DEVICE_CONTROL') return deviceControlAnswer(snapshot);
  if (kind === 'COMPETENCE') return competenceAnswer(snapshot);
  if (kind === 'UNAVAILABLE') {
    const unavailable = snapshot.capabilities.filter(item => item.status !== 'AVAILABLE' && item.status !== 'DEGRADED');
    const lines = unavailable.slice(0, 8).map(item => `${item.displayName}: ${item.status} — ${item.reason}`);
    return {
      kind,
      text: lines.length
        ? `These capabilities are not currently available:\n${lines.map(item => `• ${item}`).join('\n')}`
        : 'The current evidence snapshot does not list an unavailable capability.',
      capabilityIds: unavailable.map(item => item.id),
      evidence: unavailable.flatMap(item => item.evidence).slice(0, 12),
    };
  }
  if (kind === 'GAP_EXPLANATION' && gap) {
    const blocker = gap.missing[0];
    return {
      kind,
      text: blocker
        ? `I cannot complete that path yet because ${blocker.blocker}: ${blocker.reason} ${gap.recommendedPath ? `The safest next path is: ${gap.recommendedPath.title}` : ''}`.trim()
        : 'No structured blocker is recorded for that objective.',
      capabilityIds: gap.missing.map(item => item.capabilityId),
      evidence: gap.evidence,
    };
  }
  const ready = snapshot.capabilities.filter(item => item.status === 'AVAILABLE');
  const simulations = snapshot.capabilities.filter(item => item.status === 'SIMULATION');
  const setup = snapshot.capabilities.filter(item => ['NEEDS_CONFIGURATION', 'NEEDS_OWNER_INPUT', 'NEEDS_PROVIDER'].includes(item.status));
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
