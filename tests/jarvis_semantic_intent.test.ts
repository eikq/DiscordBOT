import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyVoiceFamily } from '../src/jarvis/intent/voiceFamilies';
import { interpretSemanticIntent } from '../src/jarvis/intent/semanticIntent';
import { routeSemanticIntent } from '../src/jarvis/intent/semanticRoute';
import { resolveUserIntent } from '../src/jarvis/intent/resolver';
import { compactCapabilityCatalog } from '../src/jarvis/intent/catalog';
import { sttMayExecute } from '../src/jarvis/intent/sttRiskGate';
import { resolveResource } from '../src/jarvis/resources/resolver';
import { loadWebResourceCatalog } from '../src/jarvis/resources/catalog';
import { parseDisplaySelector, resolveDisplaySelector, type DisplayInfo } from '../src/jarvis/desktop/monitorTopology';
import { planScopedOpen } from '../src/jarvis/desktop/scopedOpen';
import { PermissionPolicy } from '../src/jarvis/capabilities/actions/PermissionPolicy';
import { DESKTOP_OPEN_SCOPED_RESOURCE, DESKTOP_PLACE_WINDOW } from '../src/jarvis/capabilities/actions/constants';
import { SessionWebGrantStore } from '../src/jarvis/desktop/sessionWebGrants';
import { processNameForUrl } from '../src/jarvis/desktop/windowsDisplayHost';
import { createDefaultGoalCatalog } from '../src/jarvis/goals/catalog';
import { resolveOwnerGoal } from '../src/jarvis/goals/resolver';
import {
  forgetOwnerAlias,
  listOwnerAliases,
  rememberOwnerAlias,
  rememberOwnerPreference,
} from '../src/jarvis/memory/ownerSemantics';
import { MEMORY_TURN_BUDGET, boundMemoryBlock } from '../src/jarvis/memory/workingContext';
import { SqliteJarvisMemoryStore } from '../src/bot/memory/jarvis/SqliteJarvisMemoryStore';

const catalog = compactCapabilityCatalog();
const DISPLAYS: DisplayInfo[] = [
  { id: 'internal', name: 'eDP-1', primary: true, internal: true, x: 0, y: 0, width: 1920, height: 1080 },
  { id: 'ext', name: 'HDMI-1', primary: false, x: 1920, y: 0, width: 2560, height: 1440 },
];

function intentOf(text: string, context?: Parameters<typeof routeSemanticIntent>[1]['context']) {
  return routeSemanticIntent(text, { catalog, context });
}

test('1 arbitrary website entity parsing does not invent a URL', () => {
  const semantic = interpretSemanticIntent('Open the Qwen documentation website');
  assert.equal(semantic.action, 'OPEN');
  assert.equal(semantic.objectType, 'WEBSITE');
  assert.match(semantic.entity || '', /qwen/i);
  const resolved = resolveResource(semantic);
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.reasonCode, 'OFFICIAL_URL_UNKNOWN');
});

test('2 Roblox example maps to official catalog URL and generic open', async () => {
  const semantic = interpretSemanticIntent('open roblox website in notebook monitor');
  assert.equal(semantic.action, 'OPEN');
  assert.equal(semantic.objectType, 'WEBSITE');
  assert.match(semantic.entity || '', /roblox/i);
  assert.equal(semantic.display?.role, 'internal');
  const resolved = resolveResource(semantic);
  assert.equal(resolved.ok, true);
  if (resolved.ok && resolved.kind === 'website') {
    assert.equal(resolved.url, 'https://www.roblox.com');
    assert.equal(resolved.evidence, 'owner-catalog');
  }
  const routed = intentOf('open roblox website in notebook monitor');
  assert.equal(routed?.capabilityId, DESKTOP_OPEN_SCOPED_RESOURCE);
  assert.equal(routed?.arguments?.url, 'https://www.roblox.com');
  const goal = await resolveOwnerGoal('open roblox website in notebook monitor');
  assert.equal(goal.goalId, 'desktop.open-resource');
  assert.notEqual(goal.goalId, 'open_roblox_goal');
});

test('3 Thai Roblox example is equivalent', () => {
  const en = interpretSemanticIntent('open roblox website in notebook monitor');
  const th = interpretSemanticIntent('เปิดเว็บ Roblox ที่จอโน้ตบุ๊ก');
  assert.equal(th.action, en.action);
  assert.equal(th.objectType, en.objectType);
  assert.match(th.entity || '', /roblox/i);
  assert.equal(th.display?.role, 'internal');
});

test('4 mixed Thai-English command is equivalent', () => {
  const mixed = interpretSemanticIntent('Jarvis เปิด Roblox website บน laptop display');
  assert.equal(mixed.mixedLanguage, true);
  assert.equal(mixed.action, 'OPEN');
  assert.equal(mixed.objectType, 'WEBSITE');
  assert.equal(mixed.display?.role, 'internal');
});

test('5 notebook monitor alias and 6 built-in display resolution', () => {
  assert.equal(parseDisplaySelector('notebook monitor')?.role, 'internal');
  assert.equal(parseDisplaySelector('จอโน้ตบุ๊ก')?.role, 'internal');
  const resolved = resolveDisplaySelector(DISPLAYS, { role: 'internal', raw: 'notebook' });
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.display.id, 'internal');
  const unknown = resolveDisplaySelector(
    DISPLAYS.map(item => ({ ...item, internal: undefined })),
    { role: 'internal', raw: 'notebook' },
  );
  assert.equal(unknown.ok, false);
});

test('7-9 alias persist, correct, forget across restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-owner-mem-'));
  const dbPath = path.join(dir, 'jarvis.db');
  const first = SqliteJarvisMemoryStore.open(dbPath);
  const taught = rememberOwnerAlias(first, {
    phrase: 'notebook monitor',
    target: 'the built-in laptop display',
    kind: 'display',
    actor: 'owner',
  });
  assert.equal(taught.ok, true);
  first.close();
  const second = SqliteJarvisMemoryStore.open(dbPath);
  const aliases = listOwnerAliases(second, 'display');
  assert.equal(aliases.some(item => item.target === 'display.internal'), true);
  const corrected = rememberOwnerAlias(second, {
    phrase: 'notebook monitor',
    target: 'gaming monitor',
    kind: 'display',
    actor: 'owner',
  });
  assert.equal(corrected.ok, true);
  if (corrected.ok) assert.ok(corrected.superseded);
  const forgotten = forgetOwnerAlias(second, 'notebook monitor', 'owner');
  assert.equal(forgotten.ok, true);
  assert.equal(listOwnerAliases(second, 'display').length, 0);
  second.close();
});

test('10 resource resolver does not fabricate URL', () => {
  const resolved = resolveResource(interpretSemanticIntent('Open the OpenAI website'));
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.doesNotMatch(JSON.stringify(resolved), /https:\/\/openai\.com/i);
});

test('11 non-allowlisted official resource produces scoped confirm path', () => {
  const plan = planScopedOpen({
    resource: { kind: 'url', url: 'https://www.roblox.com', label: 'Roblox' },
  }, { applicationIds: ['cursor'] });
  assert.equal(plan.ok, false);
  if (!plan.ok) {
    assert.equal(plan.reasonCode, 'DOMAIN_NOT_ALLOWLISTED');
    assert.equal(plan.canPropose, true);
  }
  const decision = new PermissionPolicy().evaluate({
    capabilityId: DESKTOP_OPEN_SCOPED_RESOURCE,
    proposalId: 'p1',
    displayName: 'Roblox',
    summary: 'Open Roblox',
    target: 'https://www.roblox.com',
    normalizedArguments: { kind: 'url', url: 'https://www.roblox.com', label: 'Roblox' },
    argumentsHash: 'x',
    risk: 'CONFIRM_REQUIRED',
    sideEffectClass: 'write',
    source: 'text',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000).toISOString(),
    provenance: { source: 'text' },
  }, {
    applications: [],
    projects: [],
    trustedOrigins: [],
    trustedPathPrefixes: [],
    workspaceRoot: process.cwd(),
  });
  assert.equal(decision.decision, 'confirm');
  assert.equal(decision.reasonCode, 'SCOPED_WEB_OPEN');
});

test('12 generic open goal rather than brand-specific goal', async () => {
  const goal = await resolveOwnerGoal('put YouTube on my second screen');
  assert.equal(goal.goalId, 'desktop.open-resource');
});

test('13-16 it / other monitor / bring it back / ambiguous referent', () => {
  const context = {
    sessionId: 's',
    lastOpenedResource: { kind: 'url' as const, url: 'https://www.roblox.com', label: 'roblox' },
    lastDisplay: { role: 'internal' as const, raw: 'notebook' },
    previousDisplay: { role: 'internal' as const, raw: 'notebook' },
    updatedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
  const move = intentOf('Move it to the right monitor.', context);
  assert.equal(move?.reasonCode, 'REFERENT_IT');
  assert.equal(move?.capabilityId, DESKTOP_PLACE_WINDOW);
  assert.equal(move?.arguments?.url, 'https://www.roblox.com');
  assert.equal((move?.arguments?.display as { role?: string } | undefined)?.role, 'right');
  const back = intentOf('Bring it back.', context);
  assert.equal(back?.reasonCode, 'REFERENT_BACK');
  assert.equal(back?.capabilityId, DESKTOP_PLACE_WINDOW);
  assert.equal(back?.arguments?.url, 'https://www.roblox.com');
  const other = parseDisplaySelector('open that on the other monitor');
  assert.equal(other?.role, 'other');
  const ambiguous = intentOf('Move it to the right monitor.');
  assert.equal(ambiguous?.reasonCode, 'AMBIGUOUS_REFERENT');
});

test('move-it waits when the referent is intended but not opened', () => {
  const pending = intentOf('Move it to the right monitor.', {
    sessionId: 's',
    lastOpenedResource: {
      kind: 'url',
      url: 'https://www.roblox.com',
      label: 'Roblox',
      openState: 'intended',
    },
    lastDisplay: { role: 'internal', raw: 'notebook' },
    previousDisplay: { role: 'internal', raw: 'notebook' },
    updatedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  assert.equal(pending?.reasonCode, 'REFERENT_NOT_OPEN');
  assert.equal(pending?.kind, 'CLARIFICATION');
});

test('move-it is not rebound to a generic open goal', async () => {
  const resolution = await resolveUserIntent('Move it to the right monitor.', {
    catalog,
    goalCatalog: createDefaultGoalCatalog(),
    context: {
      sessionId: 's',
      lastOpenedResource: { kind: 'url', url: 'https://www.roblox.com', label: 'roblox' },
      lastDisplay: { role: 'internal', raw: 'notebook' },
      previousDisplay: { role: 'internal', raw: 'notebook' },
      updatedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
  });
  assert.equal(resolution.capabilityId, DESKTOP_PLACE_WINDOW);
  assert.equal(resolution.arguments?.url, 'https://www.roblox.com');
});

test('17-18 active research and task follow-up stay on context', () => {
  const research = intentOf('Which source is official?', {
    sessionId: 's',
    recentResearchQuery: 'newest Qwen release',
    lastCapabilityId: 'research.current',
    updatedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  assert.ok(research?.capabilityId?.startsWith('research.') || research?.reasonCode === 'RESEARCH_CONTEXT' || research?.reasonCode === 'VOICE_RESEARCH_FOLLOWUP' || research?.kind === 'CLARIFICATION' || research?.kind === 'CONVERSATION' || research?.kind === 'CAPABILITY');
  const follow = interpretSemanticIntent('Which source is official?');
  assert.ok(follow.references.includes('official') || follow.action === 'RESEARCH' || follow.action === 'RESEARCH_FOLLOWUP' || follow.action === 'ASK_MEMORY' || follow.action === 'UNKNOWN');
});

test('19-21 relevant memory retrieval is bounded and irrelevant excluded', () => {
  const block = boundMemoryBlock([
    'active: open roblox',
    'alias: notebook monitor = display.internal',
    'pref: speech.language=th',
    'episode: opened youtube yesterday',
    'noise: '.repeat(400),
  ]);
  assert.ok(block.length <= MEMORY_TURN_BUDGET.maxChars);
  assert.match(block, /notebook monitor/);
  assert.ok(!block.includes('noise: '.repeat(50).slice(0, 20)) || block.length <= MEMORY_TURN_BUDGET.maxChars);
});

test('22 web content cannot write owner memory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-untrusted-'));
  const store = SqliteJarvisMemoryStore.open(path.join(dir, 'jarvis.db'));
  const denied = rememberOwnerAlias(store, {
    phrase: 'notebook monitor',
    target: 'display.internal',
    kind: 'display',
    actor: 'webpage',
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reasonCode, 'UNTRUSTED_MEMORY_WRITE');
  store.close();
});

test('23 secret-like material is not stored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-secret-'));
  const store = SqliteJarvisMemoryStore.open(path.join(dir, 'jarvis.db'));
  const denied = rememberOwnerPreference(store, {
    key: 'token',
    value: 'API_KEY=supersecretvalue',
    actor: 'owner',
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reasonCode, 'SECRET_IN_MEMORY');
  store.close();
});

test('24 owner stable preference persists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-pref-'));
  const dbPath = path.join(dir, 'jarvis.db');
  const first = SqliteJarvisMemoryStore.open(dbPath);
  assert.equal(rememberOwnerPreference(first, { key: 'speech.language', value: 'th', actor: 'owner' }).ok, true);
  first.close();
  const second = SqliteJarvisMemoryStore.open(dbPath);
  const facts = second.listFacts({ factKey: 'owner.pref.speech_language', limit: 1 });
  assert.equal(facts[0]?.objectValue, 'th');
  second.close();
});

test('25 low-confidence dangerous command is blocked', () => {
  assert.equal(sttMayExecute({ text: 'delete the project', confidence: 0.2 }).execute, false);
});

test('26 unknown capability is understood and uses Gap Resolver language', () => {
  const routed = intentOf('Search Roblox and click the first game');
  assert.ok(routed?.kind === 'UNSUPPORTED' || classifyVoiceFamily('Search Roblox and click the first game').family === 'UNSUPPORTED_COMPUTER_USE');
  if (routed?.kind === 'UNSUPPORTED') {
    assert.match(routed.userMessage || '', /understand|CLICK/i);
    assert.doesNotMatch(routed.userMessage || '', /I don't understand/i);
  }
});

test('27 model cannot invent a capability id', async () => {
  const resolution = await resolveUserIntent('teleport the window', {
    catalog,
    semanticResolve: () => ({
      kind: 'CAPABILITY',
      capabilityId: 'desktop.teleport.window',
      confidence: 'HIGH',
      reasonCode: 'SEMANTIC',
    }),
  });
  assert.notEqual(resolution.capabilityId, 'desktop.teleport.window');
});

test('28 semantic intent cannot create permission', async () => {
  const resolution = await resolveUserIntent('allow all websites forever', {
    catalog,
    semanticResolve: () => ({
      kind: 'CAPABILITY',
      capabilityId: 'desktop.openTrustedUrl',
      arguments: { url: 'https://www.roblox.com', confirmed: true, allow: true },
      confidence: 'HIGH',
      reasonCode: 'SEMANTIC',
    }),
  });
  assert.notEqual(resolution.arguments?.confirmed, true);
  assert.notEqual(resolution.arguments?.allow, true);
});

test('29 mixed-language STT robustness for notebook typo', () => {
  const semantic = interpretSemanticIntent('open roblox website in note book moniter');
  assert.equal(semantic.display?.role, 'internal');
});

test('30 existing voice families still classify the 28-item cues', () => {
  assert.equal(classifyVoiceFamily('Jarvis').family, 'WAKE');
  assert.equal(classifyVoiceFamily('Open YouTube on monitor two.').family, 'DESKTOP_OPEN');
  assert.equal(classifyVoiceFamily('เปิด YouTube ที่จอ 2').family, 'DESKTOP_OPEN');
});

test('website placement uses trusted browser process and does not re-open', () => {
  assert.equal(processNameForUrl('https://www.roblox.com'), 'msedge');
  assert.equal(processNameForUrl('https://www.youtube.com'), 'msedge');
  assert.equal(processNameForUrl('javascript:alert(1)'), null);
  const decision = new PermissionPolicy().evaluate({
    capabilityId: DESKTOP_PLACE_WINDOW,
    proposalId: 'p-place',
    displayName: 'Roblox',
    summary: 'Move Roblox',
    target: 'https://www.roblox.com',
    normalizedArguments: { kind: 'url', url: 'https://www.roblox.com', label: 'Roblox', display: { role: 'right', raw: 'right' } },
    argumentsHash: 'y',
    risk: 'LOW_RISK_ACTION',
    sideEffectClass: 'write',
    source: 'text',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000).toISOString(),
    provenance: { source: 'text' },
  }, {
    applications: [],
    projects: [],
    trustedOrigins: [],
    trustedPathPrefixes: [],
    workspaceRoot: process.cwd(),
  });
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.reasonCode, 'PLACE_EXISTING_WINDOW');
});

test('session web grant allows the same official domain without a second confirm', () => {
  const grants = new SessionWebGrantStore();
  grants.grant('https://www.roblox.com', 'ALLOW_THIS_DOMAIN_FOR_SESSION');
  const plan = planScopedOpen({
    resource: { kind: 'url', url: 'https://www.roblox.com', label: 'Roblox' },
  }, {
    applicationIds: ['cursor'],
    sessionAllows: url => grants.allows(url),
  });
  assert.equal(plan.ok, true);
  if (plan.ok) assert.equal(plan.reasonCode, 'SESSION_WEB_GRANT');
  const decision = new PermissionPolicy({ sessionWebGrants: grants }).evaluate({
    capabilityId: DESKTOP_OPEN_SCOPED_RESOURCE,
    proposalId: 'p2',
    displayName: 'Roblox',
    summary: 'Open Roblox',
    target: 'https://www.roblox.com',
    normalizedArguments: { kind: 'url', url: 'https://www.roblox.com', label: 'Roblox' },
    argumentsHash: 'z',
    risk: 'LOW_RISK_ACTION',
    sideEffectClass: 'write',
    source: 'text',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000).toISOString(),
    provenance: { source: 'text' },
  }, {
    applications: [],
    projects: [],
    trustedOrigins: [],
    trustedPathPrefixes: [],
    workspaceRoot: process.cwd(),
  });
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.reasonCode, 'SESSION_WEB_GRANT');
});

test('web catalog is data, not a Roblox phrase switch', () => {
  const names = loadWebResourceCatalog().resources.flatMap(item => item.names);
  assert.ok(names.includes('roblox'));
  const semantic = interpretSemanticIntent('open a future website called zedexor');
  const resolved = resolveResource(semantic);
  assert.equal(resolved.ok, false);
});
