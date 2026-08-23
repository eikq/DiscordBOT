import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DestructiveActionCircuitBreaker } from '../src/jarvis/safety/circuitBreaker';
import { FailureContainment } from '../src/jarvis/safety/failureContainment';
import { evidenceFromWindowInspection, reconcileContainment } from '../src/jarvis/safety/containmentReconcile';
import { classifyWindowOnDisplays } from '../src/jarvis/desktop/windowPlacement';
import {
  fingerprintDisplay,
  matchDisplayFingerprint,
  parseDisplayFingerprint,
  serializeDisplayFingerprint,
} from '../src/jarvis/desktop/displayIdentity';
import {
  preferConcreteDisplay,
  resolveDisplaySelector,
  sanitizeDisplaySelector,
  type DisplayInfo,
} from '../src/jarvis/desktop/monitorTopology';
import { interpretSemanticIntent } from '../src/jarvis/intent/semanticIntent';
import { routeSemanticIntent } from '../src/jarvis/intent/semanticRoute';
import { compactCapabilityCatalog } from '../src/jarvis/intent/catalog';
import { detectConversationLanguage } from '../src/jarvis/intent/conversationLanguage';
import { resolveUserIntent } from '../src/jarvis/intent/resolver';
import { inferActionIntent } from '../src/jarvis/capabilities/actions/actionIntent';
import { validateActionInput } from '../src/jarvis/capabilities/actions/schema';
import { DESKTOP_OPEN_SCOPED_RESOURCE, DESKTOP_PLACE_WINDOW } from '../src/jarvis/capabilities/actions/constants';
import { CapabilityRegistry } from '../src/jarvis/capabilities/CapabilityRegistry';
import { resolveOwnerGoal } from '../src/jarvis/goals/resolver';
import { scopedWebOpenMessage } from '../src/jarvis/desktop/scopedOpen';
import type { CapabilityDescriptor, CapabilityHandler, CapabilityResult } from '../src/jarvis/capabilities/types';
import { resolveResource } from '../src/jarvis/resources/resolver';
import { looksLikeFilesystemPath, resolveRegisteredWorkspace } from '../src/jarvis/resources/workspaceAuthority';
import { rememberOwnerAlias, listOwnerAliases } from '../src/jarvis/memory/ownerSemantics';
import { mergeResearchIntoContext, referentStillValid, resolveThatSource } from '../src/jarvis/memory/activeContext';
import { processNamesForUrl } from '../src/jarvis/desktop/windowsDisplayHost';
import { SqliteJarvisMemoryStore } from '../src/bot/memory/jarvis/SqliteJarvisMemoryStore';
import type { InteractionContext } from '../src/jarvis/intent/types';

const catalog = compactCapabilityCatalog();

const DISPLAY_A: DisplayInfo = {
  id: '\\\\.\\DISPLAY1',
  name: '\\\\.\\DISPLAY1',
  deviceName: '\\\\.\\DISPLAY1',
  devicePath: '\\\\?\\DISPLAY#ABC123',
  primary: true,
  x: 0,
  y: 0,
  width: 2560,
  height: 1600,
};
const DISPLAY_B: DisplayInfo = {
  id: '\\\\.\\DISPLAY2',
  name: '\\\\.\\DISPLAY2',
  deviceName: '\\\\.\\DISPLAY2',
  devicePath: '\\\\?\\DISPLAY#XYZ999',
  primary: false,
  x: 2560,
  y: 0,
  width: 1920,
  height: 1080,
};

function context(partial: Partial<InteractionContext>): InteractionContext {
  const now = Date.now();
  return {
    sessionId: 'ctx',
    updatedAt: now,
    expiresAt: now + 10 * 60_000,
    ...partial,
  };
}

function okResult(capabilityId: string, extra: Partial<CapabilityResult> = {}): CapabilityResult {
  return {
    capabilityId,
    status: 'ok',
    structured: { status: 'completed' },
    content: 'ok',
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
    ...extra,
  };
}

test('1 stable display fingerprint is derived from observed identity', () => {
  const fingerprint = fingerprintDisplay(DISPLAY_A, 1);
  assert.equal(fingerprint.devicePath, DISPLAY_A.devicePath);
  assert.equal(fingerprint.size.width, 2560);
  assert.match(serializeDisplayFingerprint(fingerprint), /^display\.fp:/u);
});

test('2 display ordinal change does not break a path-backed alias', () => {
  const fingerprint = fingerprintDisplay(DISPLAY_A, 1);
  const swapped: DisplayInfo[] = [
    { ...DISPLAY_B, id: '\\\\.\\DISPLAY1', name: '\\\\.\\DISPLAY1', deviceName: '\\\\.\\DISPLAY1' },
    { ...DISPLAY_A, id: '\\\\.\\DISPLAY2', name: '\\\\.\\DISPLAY2', deviceName: '\\\\.\\DISPLAY2', x: 1920 },
  ];
  const matched = matchDisplayFingerprint(swapped, fingerprint);
  assert.equal(matched.ok, true);
  if (matched.ok) assert.equal(matched.display.devicePath, DISPLAY_A.devicePath);
});

test('3 missing physical display does not remap alias', () => {
  const fingerprint = fingerprintDisplay(DISPLAY_A, 1);
  const matched = matchDisplayFingerprint([DISPLAY_B], fingerprint);
  assert.equal(matched.ok, false);
  if (!matched.ok) assert.equal(matched.reasonCode, 'KNOWN_ALIAS_TARGET_OFFLINE');
  const resolved = resolveDisplaySelector([DISPLAY_B], {
    raw: 'notebook',
    fingerprint: serializeDisplayFingerprint(fingerprint),
    name: serializeDisplayFingerprint(fingerprint),
  });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.reasonCode, 'KNOWN_ALIAS_TARGET_OFFLINE');
});

test('4 alias correction supersedes the previous fingerprint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-display-alias-'));
  const store = SqliteJarvisMemoryStore.open(path.join(dir, 'jarvis.db'));
  rememberOwnerAlias(store, {
    phrase: 'notebook monitor',
    target: serializeDisplayFingerprint(fingerprintDisplay(DISPLAY_A)),
    kind: 'display',
    actor: 'owner',
  });
  rememberOwnerAlias(store, {
    phrase: 'notebook monitor',
    target: serializeDisplayFingerprint(fingerprintDisplay(DISPLAY_B)),
    kind: 'display',
    actor: 'owner',
  });
  const aliases = listOwnerAliases(store, 'display');
  const notebook = aliases.find(item => item.phrase === 'notebook monitor');
  assert.ok(notebook);
  const parsed = parseDisplayFingerprint(notebook!.target);
  assert.equal(parsed?.devicePath, DISPLAY_B.devicePath);
  store.close();
});

test('5 alias persists across store restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-display-alias-restart-'));
  const dbPath = path.join(dir, 'jarvis.db');
  const first = SqliteJarvisMemoryStore.open(dbPath);
  const target = serializeDisplayFingerprint(fingerprintDisplay(DISPLAY_A));
  rememberOwnerAlias(first, { phrase: 'notebook monitor', target, kind: 'display', actor: 'owner' });
  first.close();
  const second = SqliteJarvisMemoryStore.open(dbPath);
  const aliases = listOwnerAliases(second, 'display');
  assert.equal(aliases.some(item => item.target === target), true);
  second.close();
});

test('6 containment cannot globally clear', () => {
  const containment = new FailureContainment();
  assert.equal(typeof (containment as { clearAll?: unknown }).clearAll, 'undefined');
  assert.equal(containment.clear('missing', 'owner'), false);
});

test('7 scoped containment owner resolution can propose CLEAR_THIS_SCOPE', () => {
  const descriptor: CapabilityDescriptor = {
    id: 'desktop.placeWindow',
    description: 'place',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffect: 'write',
    requiredService: 'desktop',
    providerKind: 'local',
    timeoutMs: 5_000,
    untrustedOutput: false,
    effects: [{
      kind: 'MOVE',
      description: 'move',
      destructive: false,
      reversible: true,
      privilege: 'standard_user',
      targets: ['https://www.roblox.com/'],
    }],
  };
  const preflight = new DestructiveActionCircuitBreaker().createPreflight({
    descriptor,
    capabilityInput: { url: 'https://www.roblox.com/' },
    action: 'place',
    why: 'test',
  });
  const containment = new FailureContainment();
  const incident = containment.observe({
    capabilityId: 'desktop.placeWindow',
    preflight,
    result: {
      ...okResult('desktop.placeWindow'),
      status: 'timeout',
      structured: {
        reasonCode: 'MUTATION_OUTCOME_UNKNOWN',
        affectedTargets: ['https://www.roblox.com/'],
        cancellation: { state: 'CANCELLATION_REQUESTED' },
      },
    },
    recovery: { state: 'UNAVAILABLE' as const, strategy: 'none' },
  });
  assert.ok(incident);
  const reconciled = reconcileContainment(incident!, { windowFound: true, mutationObserved: false });
  assert.equal(reconciled.canProposeClear, true);
  assert.equal(reconciled.proposedResolution, 'CLEAR_THIS_SCOPE');
  assert.equal(containment.clear(incident!.id, 'jarvis'), false);
  assert.equal(containment.clear(incident!.id, 'owner'), true);
  assert.equal(containment.listActive('desktop.placeWindow').length, 0);
});

test('8 unresolved ambiguity stays contained', () => {
  const incident = {
    id: 'containment_test',
    createdAt: new Date().toISOString(),
    capabilityId: 'desktop.placeWindow',
    requestedAction: 'place',
    actualObservedResult: 'timeout',
    affectedTargets: ['https://www.roblox.com/'],
    evidence: ['unknown'],
    recovery: { state: 'UNAVAILABLE' as const, strategy: 'none' },
    active: true,
    reasonCode: 'MUTATION_OUTCOME_UNKNOWN' as const,
  };
  const reconciled = reconcileContainment(incident, {});
  assert.equal(reconciled.canProposeClear, false);
  assert.equal(reconciled.proposedResolution, 'REVERIFY');
});

test('9 expected unavailable place does not create containment', () => {
  const descriptor: CapabilityDescriptor = {
    id: 'desktop.placeWindow',
    description: 'place',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffect: 'write',
    requiredService: 'desktop',
    providerKind: 'local',
    timeoutMs: 5_000,
    untrustedOutput: false,
    effects: [{
      kind: 'MOVE',
      description: 'move',
      destructive: false,
      reversible: true,
      privilege: 'standard_user',
      targets: ['https://www.roblox.com/'],
    }],
  };
  const preflight = new DestructiveActionCircuitBreaker().createPreflight({
    descriptor,
    capabilityInput: { url: 'https://www.roblox.com/' },
    action: 'place',
    why: 'test',
  });
  const containment = new FailureContainment();
  const incident = containment.observe({
    capabilityId: 'desktop.placeWindow',
    preflight,
    result: {
      ...okResult('desktop.placeWindow'),
      status: 'unavailable',
      error: 'DISPLAY_AMBIGUOUS',
      structured: { reasonCode: 'DISPLAY_AMBIGUOUS' },
    },
    recovery: { state: 'UNAVAILABLE' as const, strategy: 'none' },
  });
  assert.equal(incident, undefined);
});

test('10 window runtime identity and Roblox it resolve to that window', () => {
  const opened = context({
    lastOpenedResource: {
      kind: 'url',
      url: 'https://www.roblox.com/',
      label: 'roblox',
      openState: 'opened',
      windowHandle: '12345',
      processName: 'msedge',
      placementScope: 'process-window',
    },
    lastDisplay: { role: 'internal', raw: 'notebook monitor' },
  });
  const routed = routeSemanticIntent('Move it to the right monitor.', { catalog, context: opened });
  assert.equal(routed?.capabilityId, DESKTOP_PLACE_WINDOW);
  assert.equal(routed?.arguments?.url, 'https://www.roblox.com/');
  assert.equal(routed?.arguments?.windowHandle, '12345');
  assert.equal(routed?.contextEvidence?.resolvedReferent, '12345');
});

test('11 right monitor resolution stays geometric', () => {
  const resolved = resolveDisplaySelector([DISPLAY_A, DISPLAY_B], { role: 'right', raw: 'right monitor' });
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.display.devicePath, DISPLAY_B.devicePath);
});

test('12 previous monitor restoration uses working context', () => {
  const opened = context({
    lastOpenedResource: {
      kind: 'url',
      url: 'https://www.roblox.com/',
      label: 'roblox',
      openState: 'opened',
    },
    lastDisplay: { role: 'right', raw: 'right monitor' },
    previousDisplay: { fingerprint: serializeDisplayFingerprint(fingerprintDisplay(DISPLAY_A)), raw: 'notebook' },
  });
  const routed = routeSemanticIntent('Bring it back.', { catalog, context: opened });
  assert.equal(routed?.capabilityId, DESKTOP_PLACE_WINDOW);
  assert.equal((routed?.arguments?.display as { raw?: string })?.raw, 'notebook');
});

test('13 there display reference uses last display', () => {
  const opened = context({
    lastDisplay: { role: 'right', raw: 'right monitor' },
    lastOpenedResource: { kind: 'url', url: 'https://www.roblox.com/', label: 'roblox', openState: 'opened' },
  });
  const routed = routeSemanticIntent('Open YouTube there too', { catalog, context: opened });
  assert.equal(routed?.capabilityId, DESKTOP_OPEN_SCOPED_RESOURCE);
  assert.equal(String(routed?.arguments?.url || '').replace(/\/$/u, ''), 'https://www.youtube.com');
  assert.equal((routed?.arguments?.display as { raw?: string })?.raw, 'right monitor');
});

test('14 expired working referent does not resolve high-risk it', () => {
  const stale = context({
    updatedAt: Date.now() - 3 * 60 * 60_000,
    expiresAt: Date.now() - 60_000,
    lastOpenedResource: { kind: 'url', url: 'https://www.roblox.com/', label: 'roblox', openState: 'opened' },
  });
  assert.equal(referentStillValid(stale, Date.now(), { highRisk: true }), false);
  const routed = routeSemanticIntent('delete it', { catalog, context: stale });
  assert.equal(routed?.reasonCode, 'REFERENT_EXPIRED');
});

test('15 research that source resolves one official source', () => {
  const opened = context({
    lastResearchSources: [
      { sourceId: 's1', url: 'https://qwen.readthedocs.io', label: 'Qwen docs', official: true },
      { sourceId: 's2', url: 'https://example.com/blog', label: 'Blog', official: false },
    ],
  });
  const official = interpretSemanticIntent('Which source is official?', { context: opened });
  assert.equal(official.objectType, 'SOURCE');
  const asked = routeSemanticIntent('Which source is official?', { catalog, context: opened });
  assert.equal(asked?.reasonCode, 'RESEARCH_OFFICIAL_SOURCE');
  assert.match(String(asked?.userMessage || ''), /qwen.readthedocs.io/u);
  const routed = routeSemanticIntent('Open that source.', { catalog, context: opened });
  assert.equal(routed?.capabilityId, DESKTOP_OPEN_SCOPED_RESOURCE);
  assert.equal(routed?.arguments?.url, 'https://qwen.readthedocs.io');
});

test('16 multiple official sources stay ambiguous', () => {
  const opened = context({
    lastResearchSources: [
      { sourceId: 's1', url: 'https://a.example', label: 'A', official: true },
      { sourceId: 's2', url: 'https://b.example', label: 'B', official: true },
    ],
  });
  const picked = resolveThatSource(opened.lastResearchSources);
  assert.equal(picked.ok, false);
  if (!picked.ok) assert.equal(picked.reasonCode, 'AMBIGUOUS_SOURCE');
  const routed = routeSemanticIntent('Open that source.', { catalog, context: opened });
  assert.equal(routed?.reasonCode, 'AMBIGUOUS_SOURCE');
  assert.match(String(routed?.userMessage || ''), /a\.example/u);
  const named = routeSemanticIntent('Open the a.example source.', { catalog, context: opened });
  assert.equal(named?.reasonCode, 'RESEARCH_SOURCE_OPEN');
  assert.equal(named?.arguments?.url, 'https://a.example');
  const generic = resolveThatSource(opened.lastResearchSources, 'Open qwen');
  assert.equal(generic.ok, false);
});

test('17 project alias resolves through registry not memory text', () => {
  const resolved = resolveRegisteredWorkspace('the project', {
    currentWorkspaceId: 'jarvis-project',
    workspaces: [{ id: 'jarvis-project', displayName: 'Jarvis Project' }],
    projects: [{ id: 'jarvis-project', displayName: 'Jarvis repository', path: 'C:\\safe\\registered', installed: true }],
  });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.workspaceId, 'jarvis-project');
    assert.equal(resolved.evidence, 'workspace-registry');
  }
  const routed = routeSemanticIntent('Open the project in Cursor.', {
    catalog,
    context: context({ currentWorkspace: 'jarvis-project', recentWorkspaceId: 'jarvis-project' }),
  });
  assert.equal(routed?.capabilityId, DESKTOP_OPEN_SCOPED_RESOURCE);
  assert.equal(routed?.arguments?.applicationId, 'cursor');
  assert.equal(routed?.arguments?.projectId, 'jarvis-project');
  assert.equal(routed?.contextEvidence?.resourceAuthority, 'workspace-registry');
});

test('18 model memory cannot fabricate a workspace path', () => {
  assert.equal(looksLikeFilesystemPath('C:\\Users\\someone\\secret'), true);
  const resolved = resolveRegisteredWorkspace('C:\\Users\\someone\\secret', {
    workspaces: [{ id: 'jarvis-project', displayName: 'Jarvis Project' }],
  });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.reasonCode, 'FABRICATED_WORKSPACE_PATH');
});

test('19 Thai response language continuity stays Thai', () => {
  assert.equal(detectConversationLanguage('เปิด Roblox ที่จอโน้ตบุ๊ก'), 'mixed');
  const semantic = interpretSemanticIntent('เปิด Roblox website บน laptop display');
  assert.equal(semantic.mixedLanguage, true);
  assert.equal(semantic.action, 'OPEN');
  assert.match(scopedWebOpenMessage('Roblox', 'จอโน้ตบุ๊ก', 'th'), /ผมพบเว็บทางการของ Roblox/);
  assert.doesNotMatch(scopedWebOpenMessage('Roblox', 'จอโน้ตบุ๊ก', 'th'), /Should I use the laptop/iu);
});

test('20 ASR near-name asks instead of silently opening', () => {
  const semantic = interpretSemanticIntent('open road blocks website');
  const resolved = resolveResource(semantic);
  assert.equal(resolved.ok, false);
  if (!resolved.ok) {
    assert.equal(resolved.reasonCode, 'DID_YOU_MEAN');
    assert.equal(resolved.suggestion, 'roblox');
  }
});

test('teach monitor ordinal is a concrete alias, not display.internal', () => {
  const semantic = interpretSemanticIntent('Monitor 1 is my notebook monitor.');
  assert.equal(semantic.action, 'TEACH_ALIAS');
  assert.equal(semantic.aliasPhrase, 'notebook monitor');
  assert.equal(semantic.target, 'ordinal:1');
});

test('declared-goal bind keeps a stored notebook fingerprint', async () => {
  const fingerprint = serializeDisplayFingerprint(fingerprintDisplay(DISPLAY_A));
  const aliases = [{
    factKey: 'owner.alias.display.notebook_monitor',
    phrase: 'notebook monitor',
    target: fingerprint,
    kind: 'display' as const,
  }];
  const host = new CapabilityRegistry();
  host.register(scopedOpenHandler());
  const resolved = await resolveUserIntent('Open Roblox website in notebook monitor.', {
    capabilityHost: host,
    aliases,
    catalog: catalog,
  });
  const display = resolved.arguments?.display as { fingerprint?: string; role?: string; raw?: string };
  assert.equal(display?.fingerprint, fingerprint);
  assert.notEqual(display?.role, 'internal');
  const goal = await resolveOwnerGoal('Open Roblox website in notebook monitor.', { host, aliases });
  const goalDisplay = goal.routes.find(item => item.id === goal.selectedRouteId)?.steps[0]?.input.display as { fingerprint?: string } | undefined;
  assert.equal(goalDisplay?.fingerprint, fingerprint);
});

test('validateActionInput keeps a display fingerprint and drops abstract internal role', () => {
  const fingerprint = serializeDisplayFingerprint(fingerprintDisplay(DISPLAY_A));
  const validated = validateActionInput(DESKTOP_OPEN_SCOPED_RESOURCE, {
    kind: 'url',
    url: 'https://www.roblox.com/',
    label: 'roblox',
    display: {
      role: 'internal',
      raw: 'Open Roblox website in notebook monitor.',
      fingerprint,
      extra: 'drop-me',
    },
  }, {
    applications: [],
    projects: [],
    trustedOrigins: [],
    trustedPathPrefixes: [],
    workspaceRoot: process.cwd(),
  });
  assert.equal(validated.ok, true);
  if (validated.ok) {
    const display = validated.value.display as { fingerprint?: string; role?: string; extra?: string };
    assert.equal(display.fingerprint, fingerprint);
    assert.equal(display.role, undefined);
    assert.equal(display.extra, undefined);
  }
});

test('preferConcreteDisplay does not let an abstract class beat a fingerprint', () => {
  const fingerprint = serializeDisplayFingerprint(fingerprintDisplay(DISPLAY_A));
  const preferred = preferConcreteDisplay(
    { raw: 'notebook monitor', fingerprint, name: fingerprint },
    { raw: 'Open Roblox website in notebook monitor.', role: 'internal' },
  );
  assert.equal(preferred?.fingerprint, fingerprint);
  assert.equal(preferred?.role, undefined);
  const sanitized = sanitizeDisplaySelector({
    role: 'internal',
    raw: 'notebook monitor',
    fingerprint,
    command: 'drop',
  });
  assert.equal(sanitized?.fingerprint, fingerprint);
  assert.equal(sanitized?.role, undefined);
  assert.equal((sanitized as { command?: string } | undefined)?.command, undefined);
});

test('voice-early open applies a stored notebook fingerprint', () => {
  const fingerprint = serializeDisplayFingerprint(fingerprintDisplay(DISPLAY_A));
  const intent = inferActionIntent('Open Roblox website in notebook monitor.', {
    aliases: [{
      factKey: 'owner.alias.display.notebook_monitor',
      phrase: 'notebook monitor',
      target: fingerprint,
      kind: 'display',
    }],
  });
  assert.equal(intent.kind, 'action');
  if (intent.kind === 'action') {
    const display = intent.calls[0]?.input.display as { fingerprint?: string; role?: string };
    assert.equal(display?.fingerprint, fingerprint);
    assert.equal(display?.role, undefined);
  }
});

test('yes after inspect clears only when containment is pending', () => {
  const without = interpretSemanticIntent('Yes.');
  assert.notEqual(without.action, 'CLEAR_CONTAINMENT');
  const withPending = interpretSemanticIntent('Yes.', {
    context: context({ pendingContainmentId: 'containment_1fe2ef80-b4ac-490c-904d-a4920085bc41' }),
  });
  assert.equal(withPending.action, 'CLEAR_CONTAINMENT');
});

test('window bounds overlap classifies a concrete display', () => {
  const placed = classifyWindowOnDisplays({
    handle: '12345',
    processName: 'msedge',
    x: 2560,
    y: 0,
    width: 1800,
    height: 1000,
  }, [DISPLAY_A, DISPLAY_B]);
  assert.equal(placed.windowFound, true);
  assert.equal(placed.displayId, DISPLAY_B.id);
  assert.equal(placed.fullyOnOneDisplay, true);
  assert.equal(placed.straddling, false);
});

function scopedOpenHandler(): CapabilityHandler {
  const descriptor: CapabilityDescriptor = {
    id: DESKTOP_OPEN_SCOPED_RESOURCE,
    description: 'open scoped',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string' },
        applicationId: { type: 'string' },
        url: { type: 'string' },
        label: { type: 'string' },
        display: { type: 'object' },
        projectId: { type: 'string' },
      },
    },
    outputSchema: { type: 'object' },
    sideEffect: 'write',
    requiredService: 'desktop',
    providerKind: 'local',
    timeoutMs: 1_000,
    untrustedOutput: false,
  };
  return {
    descriptor: () => descriptor,
    availability: async () => ({ id: DESKTOP_OPEN_SCOPED_RESOURCE, availability: 'up', degraded: false }),
    invoke: async () => okResult(DESKTOP_OPEN_SCOPED_RESOURCE),
  };
}

test('declared goal does not steal research source follow-up', async () => {
  const host = new CapabilityRegistry();
  host.register(scopedOpenHandler());
  const opened = context({
    lastResearchSources: [
      { sourceId: 's1', url: 'https://qwen.readthedocs.io', label: 'Qwen docs', official: true },
      { sourceId: 's2', url: 'https://example.com/blog', label: 'Blog', official: false },
    ],
  });
  const official = await resolveUserIntent('Which source is official?', {
    capabilityHost: host,
    catalog,
    context: opened,
  });
  assert.equal(official.reasonCode, 'RESEARCH_OFFICIAL_SOURCE');
  assert.equal(official.kind, 'CONVERSATION');
  const routed = await resolveUserIntent('Open that source.', {
    capabilityHost: host,
    catalog,
    context: opened,
  });
  assert.equal(routed.capabilityId, DESKTOP_OPEN_SCOPED_RESOURCE);
  assert.equal(routed.arguments?.url, 'https://qwen.readthedocs.io');
});

test('research snapshot hydrates empty working context', () => {
  const hydrated = mergeResearchIntoContext(null, {
    query: 'latest Qwen documentation',
    sessionId: 'research-1',
    sources: [{
      sourceId: 's1',
      url: 'https://docs.qwencloud.com/changelog/models',
      canonicalUrl: 'https://docs.qwencloud.com/changelog/models',
      domain: 'docs.qwencloud.com',
      title: 'Model releases',
      publishedAt: null,
      updatedAt: null,
      fetchedAt: null,
      contentType: 'text/html',
      provider: 'test',
      sourceClass: 'OFFICIAL',
      trustSignals: { officialDomain: true, hasPublishedAt: false, https: true },
      status: 'fetched',
      cached: false,
    }],
  }, 'live-session');
  assert.ok(hydrated);
  assert.equal(hydrated?.sessionId, 'live-session');
  assert.equal(hydrated?.lastResearchSources?.[0]?.url, 'https://docs.qwencloud.com/changelog/models');
  assert.equal(processNamesForUrl('https://www.roblox.com/').includes('chrome'), true);
});

test('straddling window stays contained', () => {
  const incident = {
    id: 'containment_partial',
    createdAt: new Date().toISOString(),
    capabilityId: 'desktop.placeWindow',
    requestedAction: 'place',
    actualObservedResult: 'timeout',
    affectedTargets: ['https://www.roblox.com/'],
    evidence: ['unknown'],
    recovery: { state: 'UNAVAILABLE' as const, strategy: 'none' },
    active: true,
    reasonCode: 'MUTATION_OUTCOME_UNKNOWN' as const,
  };
  const straddling = classifyWindowOnDisplays({
    handle: '9',
    processName: 'msedge',
    x: 2400,
    y: 0,
    width: 800,
    height: 800,
  }, [DISPLAY_A, DISPLAY_B]);
  assert.equal(straddling.straddling, true);
  const reconciled = reconcileContainment(incident, evidenceFromWindowInspection({
    windowFound: true,
    straddling: true,
    fullyOnOneDisplay: false,
  }));
  assert.equal(reconciled.canProposeClear, false);
  assert.equal(reconciled.proposedResolution, 'KEEP_CONTAINED');
});
