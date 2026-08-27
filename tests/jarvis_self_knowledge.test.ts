import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CapabilityRegistry,
  answerFromSelfKnowledge,
  buildSelfKnowledgeSnapshot,
  interpretRequestedCapability,
  resolveOwnerGoal,
  resolveSelfKnowledgeGap,
  selfKnowledgeQuestionKind,
  type CapabilityDescriptor,
  type CapabilityHandler,
} from '../src/jarvis';
import { cctvCapabilityContracts } from '../src/jarvis/devices';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';

test('self-knowledge classifier routes setup, permission, gap, and availability questions', () => {
  assert.equal(selfKnowledgeQuestionKind('What capabilities need setup?'), 'NEEDS_SETUP');
  assert.equal(selfKnowledgeQuestionKind('What capabilities are unavailable?'), 'UNAVAILABLE');
  assert.equal(selfKnowledgeQuestionKind('What can you do right now?'), 'AVAILABLE_NOW');
  assert.equal(selfKnowledgeQuestionKind('What can you do after setup?'), 'AFTER_SETUP');
  assert.equal(selfKnowledgeQuestionKind('What requires my permission?'), 'NEEDS_PERMISSION');
  assert.equal(selfKnowledgeQuestionKind("Why can't you run PowerShell?"), 'GAP_EXPLANATION');
  assert.equal(selfKnowledgeQuestionKind("Why can't you do quantum teleportation?"), 'GAP_EXPLANATION');
  assert.equal(selfKnowledgeQuestionKind('What do you need from me to do X?'), 'GAP_EXPLANATION');
  assert.equal(selfKnowledgeQuestionKind('What can you do?'), 'CAPABILITY_SUMMARY');
  assert.equal(selfKnowledgeQuestionKind('hello there'), undefined);
  assert.equal(selfKnowledgeQuestionKind([
    'ตอนนี้คุณคือ JARVIS ตัวไหน และคุณทำอะไรให้ผมได้บ้าง',
    'นี่คือ BUILD_WEBSITE goal',
    'สร้างเว็บพรีเซนต์แบบ slide deck 7 สไลด์ ใน ProjectWorkspace',
    'ใช้ React + Vite',
  ].join('\n')), undefined);
});

test('Goal Catalog maps setup and gap questions to Self Knowledge handlers', async () => {
  const setup = await resolveOwnerGoal('What capabilities need setup?');
  assert.equal(setup.handler, 'SELF_KNOWLEDGE');
  assert.equal(setup.goalId, 'self.capabilities');
  const permission = await resolveOwnerGoal('What requires my permission?');
  assert.equal(permission.goalId, 'self.capabilities');
  const gap = await resolveOwnerGoal("Why can't you run PowerShell?");
  assert.equal(gap.handler, 'SELF_KNOWLEDGE');
  assert.equal(gap.goalId, 'self.explain-gap');
});

test('Assistant answers setup, unavailable, permission, and gap questions from evidence without the model', async () => {
  let modelCalls = 0;
  const host = new CapabilityRegistry();
  host.register(handler(descriptor('system.inspect'), 'up'));
  host.register(handler(descriptor('owner.write', {
    sideEffect: 'write',
    intelligence: { permission: 'OWNER_REQUIRED' },
  }), 'up'));
  host.register(handler(descriptor('tool.configure'), 'not_configured'));
  host.register(handler(descriptor('screen.capture', {
    intelligence: { localAcceptance: 'BLOCKED_LOCAL_ACCEPTANCE' },
  }), 'unavailable'));
  const lab = createJarvisLabRuntime({
    capabilities: host,
    commandCenter: false,
    attachDefaultMemory: false,
    attachDefaultSkills: false,
    attachDefaultPresentation: false,
    attachDefaultSpeech: false,
    reminders: false,
    research: false,
    workspace: false,
    llm: {
      generateText: async () => {
        modelCalls += 1;
        return 'invented live CCTV and unrestricted PowerShell';
      },
    },
  });

  const setup = await lab.ask({ text: 'What capabilities need setup?', sessionId: 'sk-setup' });
  assert.equal(modelCalls, 0);
  assert.equal(setup.result.answerIntent, 'self_knowledge');
  assert.equal(setup.selfKnowledge?.kind, 'NEEDS_SETUP');
  assert.match(setup.presented.text, /need setup|NEEDS_CONFIGURATION|NEEDS_PROVIDER|BLOCKED_LOCAL_ACCEPTANCE/iu);
  assert.doesNotMatch(setup.presented.text, /invented live CCTV/i);
  assert.doesNotMatch(setup.presented.text, /CCTV is live|RTSP is connected/i);

  const unavailable = await lab.ask({ text: 'What capabilities are unavailable?', sessionId: 'sk-unavail' });
  assert.equal(modelCalls, 0);
  assert.equal(unavailable.selfKnowledge?.kind, 'UNAVAILABLE');
  assert.match(unavailable.presented.text, /not currently available/i);

  const permission = await lab.ask({ text: 'What requires my permission?', sessionId: 'sk-perm' });
  assert.equal(modelCalls, 0);
  assert.equal(permission.selfKnowledge?.kind, 'NEEDS_PERMISSION');
  assert.match(permission.presented.text, /owner permission|OWNER_REQUIRED/i);
  assert.match(permission.presented.text, /never grants permission/i);

  const now = await lab.ask({ text: 'What can you do right now?', sessionId: 'sk-now' });
  assert.equal(now.selfKnowledge?.kind, 'AVAILABLE_NOW');
  assert.match(now.presented.text, /system inspect/i);
  assert.doesNotMatch(now.presented.text, /unrestricted PowerShell/i);

  const after = await lab.ask({ text: 'What can you do after setup?', sessionId: 'sk-after' });
  assert.equal(after.selfKnowledge?.kind, 'AFTER_SETUP');
  assert.match(after.presented.text, /After setup|setup-gated/i);
});

test('PowerShell and unknown capability gaps stay evidence-backed and CCTV stays not-live', async () => {
  let modelCalls = 0;
  const host = new CapabilityRegistry();
  host.register(handler(descriptor('system.inspect'), 'up'));
  const lab = createJarvisLabRuntime({
    capabilities: host,
    commandCenter: false,
    attachDefaultMemory: false,
    attachDefaultSkills: false,
    attachDefaultPresentation: false,
    attachDefaultSpeech: false,
    reminders: false,
    research: false,
    workspace: false,
    llm: {
      generateText: async () => {
        modelCalls += 1;
        return 'Sure, I can run PowerShell and enable your CCTV cameras.';
      },
    },
  });

  const shell = await lab.ask({ text: "Why can't you run PowerShell?", sessionId: 'sk-shell' });
  assert.equal(modelCalls, 0);
  assert.equal(shell.result.answerIntent, 'self_knowledge');
  assert.equal(shell.selfKnowledge?.kind, 'GAP_EXPLANATION');
  assert.match(shell.presented.text, /not a registered Jarvis capability/i);
  assert.match(shell.presented.text, /policy-forbidden|GENERIC_SHELL|scope- and risk-controlled/i);
  assert.match(shell.presented.text, /typed/i);
  assert.doesNotMatch(shell.presented.text, /^I cannot run PowerShell\.?$/iu);
  assert.doesNotMatch(shell.presented.text, /unrestricted production shell is available/i);
  assert.ok(!shell.selfKnowledge?.capabilityIds.includes('shell.exec'));

  const unknown = await lab.ask({ text: "Why can't you do quantum teleportation?", sessionId: 'sk-unknown' });
  assert.equal(modelCalls, 0);
  assert.equal(unknown.selfKnowledge?.kind, 'GAP_EXPLANATION');
  assert.match(unknown.presented.text, /UNSUPPORTED|do not have a registered capability/i);
  assert.doesNotMatch(unknown.presented.text, /I can teleport/i);

  const need = await lab.ask({ text: 'What do you need from me to do quantum teleportation?', sessionId: 'sk-need' });
  assert.equal(need.selfKnowledge?.kind, 'GAP_EXPLANATION');
  assert.match(need.presented.text, /UNSUPPORTED|registered capability/i);

  const cctv = await lab.ask({ text: 'Can you access my CCTV?', sessionId: 'sk-cctv' });
  assert.equal(modelCalls, 0);
  assert.equal(cctv.selfKnowledge?.kind, 'CCTV_STATUS');
  assert.match(cctv.presented.text, /not live/i);
  assert.doesNotMatch(cctv.presented.text, /RTSP is connected|ONVIF is live/i);
});

test('gap resolver marks unregistered PowerShell as unsupported without hallucinating availability', async () => {
  const snapshot = await buildSelfKnowledgeSnapshot({
    host: hostWith(descriptor('system.inspect'), 'up'),
    declarations: cctvCapabilityContracts(),
  });
  const requested = interpretRequestedCapability("Why can't you run PowerShell?", snapshot);
  assert.equal(requested.kind, 'FORBIDDEN_SHELL');
  assert.equal(requested.capabilityId, 'shell.exec');
  const gap = await resolveSelfKnowledgeGap("Why can't you run PowerShell?", snapshot);
  assert.equal(gap.status, 'BLOCKED');
  assert.equal(gap.missing[0]?.currentState, 'UNSUPPORTED');
  const answer = answerFromSelfKnowledge('GAP_EXPLANATION', snapshot, gap, "Why can't you run PowerShell?");
  assert.match(answer.text, /not a registered Jarvis capability/i);
  assert.equal(snapshot.capabilities.some(item => item.id.startsWith('cctv.') && item.status === 'AVAILABLE' && item.implementation.mode === 'REAL'), false);
});

function descriptor(id: string, override: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    id,
    description: `Test capability ${id}`,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffect: 'read',
    requiredService: 'test-provider',
    providerKind: 'local',
    timeoutMs: 1_000,
    untrustedOutput: false,
    ...override,
  };
}

function handler(
  value: CapabilityDescriptor,
  availability: 'up' | 'disabled' | 'not_configured' | 'failed' | 'unavailable',
): CapabilityHandler {
  return {
    descriptor: () => value,
    availability: async () => ({ id: value.id, availability, degraded: availability !== 'up' }),
    invoke: async () => ({
      capabilityId: value.id,
      status: 'ok',
      structured: { status: 'ok' },
      content: 'ok',
      sourceUrls: [],
      untrustedOutput: value.untrustedOutput,
      sideEffect: value.sideEffect,
    }),
  };
}

function hostWith(
  value: CapabilityDescriptor,
  availability: 'up' | 'disabled' | 'not_configured' | 'failed' | 'unavailable',
): CapabilityRegistry {
  const host = new CapabilityRegistry();
  host.register(handler(value, availability));
  return host;
}
