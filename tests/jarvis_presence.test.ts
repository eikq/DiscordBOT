import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  collectPresenceAttention,
  derivePresenceHud,
  derivePresencePhase,
  desktopAuthorityMaturity,
  formatAttentionSpoken,
  inferDesktopAuthorityClass,
  interpretPresenceOwnerReply,
  interpretPresenceShellCommand,
  isControlCenterPath,
  isPresenceAmbientPath,
  isPresencePath,
  presencePhaseToLab,
  resolvePresenceApproval,
  stripJarvisAddress,
} from '../src/jarvis/ui/presence/presenceRuntime';

test('presence routes stay separate from Control Center', () => {
  assert.equal(isPresencePath('/jarvis'), true);
  assert.equal(isPresencePath('/jarvis/ambient'), true);
  assert.equal(isPresencePath('/jarvis-lab'), false);
  assert.equal(isPresencePath('/jarvis-lab/tasks'), false);
  assert.equal(isControlCenterPath('/jarvis-lab'), true);
  assert.equal(isControlCenterPath('/jarvis-lab/security'), true);
  assert.equal(isControlCenterPath('/jarvis'), false);
  assert.equal(isPresenceAmbientPath('/jarvis', '?mode=ambient'), true);
  assert.equal(isPresenceAmbientPath('/jarvis/ambient'), true);
  assert.equal(isPresenceAmbientPath('/jarvis', ''), false);
});

test('presence phase is driven by real runtime flags, not fake activity', () => {
  assert.equal(derivePresencePhase({ ready: true }), 'IDLE');
  assert.equal(derivePresencePhase({ micState: 'listening' }), 'LISTENING');
  assert.equal(derivePresencePhase({ micState: 'transcribing' }), 'UNDERSTANDING');
  assert.equal(derivePresencePhase({ busy: true }), 'THINKING');
  assert.equal(derivePresencePhase({ visualState: 'WEB_SEARCH' }), 'RESEARCHING');
  assert.equal(derivePresencePhase({ visualState: 'PLANNING' }), 'PLANNING');
  assert.equal(derivePresencePhase({ waitingPermission: true }), 'WAITING_OWNER');
  assert.equal(derivePresencePhase({ visualState: 'EXECUTING' }), 'EXECUTING');
  assert.equal(derivePresencePhase({ visualState: 'VERIFYING' }), 'VERIFYING');
  assert.equal(derivePresencePhase({ speechState: 'speaking' }), 'SPEAKING');
  assert.equal(derivePresencePhase({ visualState: 'EVOLVING' }), 'EVOLVING');
  assert.equal(derivePresencePhase({ ready: false }), 'WARNING');
  assert.equal(derivePresencePhase({ error: 'failed' }), 'CRITICAL');
  assert.equal(derivePresencePhase({ emergencyActive: true, busy: true }), 'EMERGENCY_STOP');
  assert.equal(derivePresencePhase({ ready: false, llmReachable: false }), 'OFFLINE');
  assert.equal(presencePhaseToLab('RESEARCHING'), 'searching');
  assert.equal(presencePhaseToLab('EMERGENCY_STOP'), 'error');
});

test('contextual HUD appears for the current job and collapses otherwise', () => {
  assert.equal(derivePresenceHud({ phase: 'IDLE' }), 'none');
  assert.equal(derivePresenceHud({ phase: 'WAITING_OWNER', waitingPermission: true }), 'permission');
  assert.equal(derivePresenceHud({ phase: 'WAITING_OWNER', waitingOwnerInput: true }), 'waiting-input');
  assert.equal(derivePresenceHud({ phase: 'EXECUTING', taskActive: true }), 'execution');
  assert.equal(derivePresenceHud({ phase: 'VERIFYING' }), 'verification');
  assert.equal(derivePresenceHud({ phase: 'RESEARCHING', researchSources: 3 }), 'research');
  assert.equal(derivePresenceHud({ phase: 'IDLE', systemAsked: true }), 'system');
  assert.equal(derivePresenceHud({ phase: 'IDLE', reminderPending: true }), 'reminder');
  assert.equal(derivePresenceHud({ phase: 'IDLE', cctvAsked: true }), 'cctv');
  assert.equal(derivePresenceHud({ phase: 'IDLE', desktopAsked: true }), 'desktop');
});

test('owner can talk to Presence without opening a dashboard page first', () => {
  assert.equal(interpretPresenceShellCommand('Jarvis, open Control Center').kind, 'control-center');
  assert.equal(interpretPresenceShellCommand('Open Control Center').kind, 'control-center');
  assert.equal(interpretPresenceShellCommand('return to Jarvis').kind, 'presence');
  assert.equal(interpretPresenceShellCommand('ambient mode').kind, 'ambient-on');
  assert.equal(interpretPresenceShellCommand('exit ambient mode').kind, 'ambient-off');
  assert.equal(interpretPresenceShellCommand('Emergency Stop').kind, 'emergency-stop');
  assert.equal(interpretPresenceShellCommand("what's happening?").kind, 'attention');
  assert.equal(interpretPresenceShellCommand('what needs my attention').kind, 'attention');
  assert.equal(interpretPresenceShellCommand('Research the latest Qwen information').kind, 'none');
  assert.equal(interpretPresenceShellCommand('Check system status').kind, 'none');
  assert.equal(stripJarvisAddress('Jarvis, research Qwen.'), 'research Qwen.');
});

test('Yes and No bind to one exact pending permission, never a global grant', () => {
  const confirm = resolvePresenceApproval({
    pendingConfirmation: { proposalId: 'p1', token: 'tok-1', displayName: 'Write sandbox config' },
  });
  assert.equal(confirm.kind, 'confirm');
  if (confirm.kind !== 'confirm') throw new Error('expected confirm');
  const allow = interpretPresenceOwnerReply('Yes', confirm);
  assert.equal(allow.kind, 'allow');
  if (allow.kind !== 'allow') throw new Error('expected allow');
  assert.equal(allow.target.kind, 'confirm');
  assert.equal(allow.target.proposalId, 'p1');
  assert.equal(allow.target.token, 'tok-1');

  const deny = interpretPresenceOwnerReply('No', confirm);
  assert.equal(deny.kind, 'deny');

  const unbound = interpretPresenceOwnerReply('allow once', { kind: 'none' });
  assert.equal(unbound.kind, 'unbound');

  const ambiguous = resolvePresenceApproval({
    pendingConfirmation: { proposalId: 'p1', token: 'tok-1' },
    waitingPermission: { waiting: true, taskId: 't2', proposalId: 'p2' },
  });
  assert.equal(ambiguous.kind, 'ambiguous');
  assert.equal(interpretPresenceOwnerReply('Yes', ambiguous).kind, 'ambiguous');

  const grant = resolvePresenceApproval({
    waitingPermission: { waiting: true, taskId: 'task-9', stepId: 's1', capability: 'reminders.create' },
  });
  assert.equal(grant.kind, 'grant');
  if (grant.kind !== 'grant') throw new Error('expected grant');
  const granted = interpretPresenceOwnerReply('Proceed', grant);
  assert.equal(granted.kind, 'allow');
  if (granted.kind !== 'allow') throw new Error('expected allow');
  assert.equal(granted.target.kind, 'grant');
  assert.equal(granted.target.taskId, 'task-9');
  assert.equal(interpretPresenceOwnerReply('Research Qwen', grant).kind, 'not-approval');
});

test('attention copy stays owner-facing and desktop classes stay separate', () => {
  const items = collectPresenceAttention({
    waitingPermission: true,
    permissionLabel: 'Create a reminder',
    reminderPendingCount: 1,
  });
  assert.equal(items[0]?.kind, 'permission');
  assert.match(formatAttentionSpoken(items), /Approval required/);
  assert.equal(inferDesktopAuthorityClass('Open Cursor'), 'OPEN');
  assert.equal(inferDesktopAuthorityClass('click the first result'), 'CLICK');
  assert.equal(desktopAuthorityMaturity('OPEN').state, 'REAL');
  assert.equal(desktopAuthorityMaturity('CLICK').state, 'PREPARE_CONTRACT');
  assert.equal(desktopAuthorityMaturity('SEE').state, 'PREPARE_CONTRACT');
  assert.equal(desktopAuthorityMaturity('TYPE').state, 'PREPARE_CONTRACT');
  assert.equal(desktopAuthorityMaturity('SUBMIT').state, 'PREPARE_CONTRACT');
});

test('presence UI is Discord-free and does not replace Control Center pages', () => {
  const files = [
    path.join(process.cwd(), 'src', 'main.tsx'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'JarvisPresencePage.tsx'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'presenceRuntime.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'operating', 'JarvisOperatingPage.tsx'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'operating', 'JarvisOperatingShell.tsx'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'operating', 'JarvisPages.tsx'),
  ];
  const discord = /from\s+['"](?:discord(?:\.js)?|@discordjs\/)['"]/u;
  const main = fs.readFileSync(files[0]!, 'utf8');
  assert.match(main, /isPresencePath/);
  assert.match(main, /JarvisPresencePage/);
  assert.match(main, /JarvisLabPage/);
  const presence = fs.readFileSync(files[1]!, 'utf8');
  assert.match(presence, /Talk to Jarvis/);
  assert.match(presence, /\/api\/jarvis\/ask/);
  assert.match(presence, /\/api\/jarvis\/actions\/confirm/);
  assert.match(presence, /\/api\/jarvis\/command-center\/grant/);
  assert.match(presence, /\/api\/jarvis\/emergency-stop/);
  assert.match(presence, /mode=ambient/);
  assert.doesNotMatch(presence, /jai-nav/);
  const page = fs.readFileSync(files[3]!, 'utf8');
  assert.match(page, /\/jarvis-lab/);
  const shell = fs.readFileSync(files[4]!, 'utf8');
  assert.match(shell, /Control Center/);
  assert.match(shell, /Open Presence/);
  const pages = fs.readFileSync(files[5]!, 'utf8');
  assert.match(pages, /Task Center/);
  assert.match(pages, /Security Academy/);
  assert.match(pages, /Capability Explorer/);
  for (const file of files) {
    assert.equal(discord.test(fs.readFileSync(file, 'utf8')), false, file);
  }
});
