import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPerceptionSnapshot,
  diffWindows,
  nextVerifiedDisplays,
  parseWindowSnapshot,
  verifyPlacement,
  type WindowSnapshot,
} from '../src/jarvis/desktop/perception';
import {
  createManagedWindow,
  discoverManagedWindow,
  ManagedWindowStore,
} from '../src/jarvis/desktop/managedWindows';
import { observeAfterOpen } from '../src/jarvis/desktop/openVerify';
import {
  buildDesktopSnapshotScript,
  buildFocusWindowScript,
  buildInspectWindowScript,
  buildPlaceWindowScript,
  DESKTOP_HOST_VERSION,
} from '../src/jarvis/desktop/windowsDisplayHost';
import { applyOpenedResource, observedDisplaySelector } from '../src/jarvis/memory/workingContext';
import { FailureContainment } from '../src/jarvis/safety/failureContainment';
import { DestructiveActionCircuitBreaker } from '../src/jarvis/safety/circuitBreaker';
import type { CapabilityDescriptor, CapabilityResult } from '../src/jarvis/capabilities/types';
import type { InteractionContext } from '../src/jarvis/intent/types';
import type { DisplayInfo } from '../src/jarvis/desktop/monitorTopology';
import { routeSemanticIntent } from '../src/jarvis/intent/semanticRoute';
import { compactCapabilityCatalog } from '../src/jarvis/intent/catalog';
import { DESKTOP_FOCUS_WINDOW, DESKTOP_PLACE_WINDOW } from '../src/jarvis/capabilities/actions/constants';

const catalog = compactCapabilityCatalog();

const NOTEBOOK: DisplayInfo = {
  id: '\\\\.\\DISPLAY1',
  name: '\\\\.\\DISPLAY1',
  deviceName: '\\\\.\\DISPLAY1',
  devicePath: 'MONITOR\\BOE0D5B\\0002',
  primary: false,
  x: -3840,
  y: -6,
  width: 1920,
  height: 1200,
};
const RIGHT: DisplayInfo = {
  id: '\\\\.\\DISPLAY5',
  name: '\\\\.\\DISPLAY5',
  deviceName: '\\\\.\\DISPLAY5',
  devicePath: 'MONITOR\\MSI3DA6\\0001',
  primary: true,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
};

function windowAt(handle: string, display: DisplayInfo, extra: Partial<WindowSnapshot> = {}): WindowSnapshot {
  return {
    windowHandle: handle,
    processName: extra.processName || 'chrome',
    title: extra.title || 'Roblox',
    bounds: { x: display.x + 10, y: display.y + 10, width: 1600, height: 900 },
    visible: true,
    observedAt: extra.observedAt || Date.now(),
    ...extra,
  };
}

function context(partial: Partial<InteractionContext> = {}): InteractionContext {
  const now = Date.now();
  return { sessionId: 'desk', updatedAt: now, expiresAt: now + 600_000, ...partial };
}

test('1 DesktopPerception window enumeration is structured and read-only', () => {
  const snapshot = buildPerceptionSnapshot({
    displays: [NOTEBOOK, RIGHT],
    windows: [windowAt('11', NOTEBOOK)],
    cachedHost: true,
  });
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.windows.length, 1);
  assert.ok(snapshot.windows[0]?.displayFingerprint);
});

test('2 stable window snapshot keeps Windows evidence only', () => {
  const parsed = parseWindowSnapshot({
    Handle: 42,
    ProcessId: 99,
    ProcessName: 'chrome',
    Title: 'Roblox',
    X: 10,
    Y: 20,
    Width: 800,
    Height: 600,
    Visible: true,
    inventedReasoning: 'the model guessed this',
  });
  assert.equal(parsed?.windowHandle, '42');
  assert.equal(parsed?.processId, 99);
  assert.equal('inventedReasoning' in (parsed || {}), false);
});

test('3 pre/post diff finds a new dedicated window', () => {
  const pre = [windowAt('1', RIGHT, { title: 'Gmail' })];
  const post = [...pre, windowAt('2', NOTEBOOK, { title: 'Roblox' })];
  const diff = diffWindows(pre, post);
  assert.equal(diff.appeared.length, 1);
  assert.equal(diff.appeared[0]?.windowHandle, '2');
});

test('4 managed window creation binds the discovered handle', () => {
  const found = discoverManagedWindow({
    pre: [windowAt('1', RIGHT, { title: 'Gmail' })],
    post: [windowAt('1', RIGHT, { title: 'Gmail' }), windowAt('2', NOTEBOOK, { title: 'Roblox' })],
    expectedProcessNames: ['chrome'],
    url: 'https://www.roblox.com/',
    label: 'roblox',
  });
  assert.equal(found.ok, true);
  if (found.ok) {
    const record = createManagedWindow({
      openOperationId: 'op1',
      resourceId: 'roblox',
      resourceType: 'website',
      windowHandle: found.window.windowHandle,
      expectedUrl: 'https://www.roblox.com/',
      dedicatedWindow: found.dedicated,
    });
    assert.equal(record.windowHandle, '2');
    assert.equal(record.dedicatedWindow, true);
  }
});

test('5 ambiguous window identity is rejected', () => {
  const found = discoverManagedWindow({
    pre: [],
    post: [
      windowAt('2', NOTEBOOK, { title: 'Roblox' }),
      windowAt('3', NOTEBOOK, { title: 'Roblox - Home' }),
    ],
    expectedProcessNames: ['chrome'],
    url: 'https://www.roblox.com/',
    label: 'roblox',
  });
  assert.equal(found.ok, false);
  if (!found.ok) assert.equal(found.reasonCode, 'WINDOW_IDENTITY_AMBIGUOUS');
});

test('6 dedicated browser window association prefers the new handle', () => {
  const found = discoverManagedWindow({
    pre: [windowAt('8', RIGHT, { title: 'New Tab' })],
    post: [windowAt('8', RIGHT, { title: 'New Tab' }), windowAt('9', NOTEBOOK, { title: 'YouTube' })],
    expectedProcessNames: ['chrome'],
    url: 'https://www.youtube.com/',
    label: 'YouTube',
  });
  assert.equal(found.ok, true);
  if (found.ok) {
    assert.equal(found.window.windowHandle, '9');
    assert.equal(found.dedicated, true);
  }
});

test('7 Roblox and YouTube are not conflated when separate', () => {
  const store = new ManagedWindowStore();
  store.upsert(createManagedWindow({
    managedWindowId: 'mw-roblox',
    openOperationId: 'a',
    resourceId: 'roblox',
    resourceType: 'website',
    windowHandle: '2',
    expectedUrl: 'https://www.roblox.com/',
    dedicatedWindow: true,
  }));
  store.upsert(createManagedWindow({
    managedWindowId: 'mw-yt',
    openOperationId: 'b',
    resourceId: 'youtube',
    resourceType: 'website',
    windowHandle: '9',
    expectedUrl: 'https://www.youtube.com/',
    dedicatedWindow: true,
  }));
  assert.equal(store.findByResource({ url: 'https://www.roblox.com/' })[0]?.windowHandle, '2');
  assert.equal(store.findByResource({ url: 'https://www.youtube.com/' })[0]?.windowHandle, '9');
  assert.notEqual(
    store.findByResource({ url: 'https://www.roblox.com/' })[0]?.windowHandle,
    store.findByResource({ url: 'https://www.youtube.com/' })[0]?.windowHandle,
  );
});

test('8 place verification uses actual bounds', () => {
  const onRight = verifyPlacement(windowAt('2', RIGHT), RIGHT);
  const stillLeft = verifyPlacement(windowAt('2', NOTEBOOK), RIGHT);
  assert.equal(onRight.verified, true);
  assert.equal(stillLeft.verified, false);
});

test('9 failed placement does not update current display', () => {
  const before = { current: 'fp-notebook', previous: 'fp-right' };
  const next = nextVerifiedDisplays(before, 'fp-right', false);
  assert.equal(next.current, 'fp-notebook');
  assert.equal(next.previous, 'fp-right');
});

test('10 failed placement does not overwrite previous display', () => {
  const ctx = context({
    lastDisplay: { raw: 'notebook', fingerprint: 'fp-notebook' },
    previousDisplay: { raw: 'right', fingerprint: 'fp-right' },
    lastOpenedResource: { kind: 'url', url: 'https://www.roblox.com/', label: 'roblox', openState: 'opened', windowHandle: '2' },
  });
  const applied = applyOpenedResource(ctx, {
    ...ctx.lastOpenedResource!,
    display: { raw: 'right', fingerprint: 'fp-right' },
  }, { verified: false });
  assert.equal((applied.previousDisplay as { fingerprint?: string } | undefined)?.fingerprint, 'fp-right');
  assert.equal((applied.lastDisplay as { raw?: string } | undefined)?.raw, 'notebook');
});

test('11 verified placement updates previous and current', () => {
  const before = { current: 'fp-notebook' };
  const next = nextVerifiedDisplays(before, 'fp-right', true);
  assert.equal(next.previous, 'fp-notebook');
  assert.equal(next.current, 'fp-right');
});

test('11b confirmed placement uses observed display, not the prior window display', () => {
  const observed = observedDisplaySelector({
    displayId: RIGHT.id,
    displayFingerprint: 'display.fp:right',
  });
  assert.equal(observed?.name, RIGHT.id);
  assert.equal(observed?.fingerprint, 'display.fp:right');
  const afterOpen = applyOpenedResource(context(), {
    kind: 'url',
    url: 'https://www.roblox.com/',
    label: 'roblox',
    openState: 'opened',
    windowHandle: '2',
    display: { raw: 'notebook', fingerprint: 'fp-notebook', name: NOTEBOOK.id },
    currentDisplayId: NOTEBOOK.id,
  }, { verified: true });
  const afterMove = applyOpenedResource({
    sessionId: 'desk',
    updatedAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    ...afterOpen,
  }, {
    kind: 'url',
    url: 'https://www.roblox.com/',
    label: 'roblox',
    openState: 'opened',
    windowHandle: '2',
    display: observed,
    currentDisplayId: RIGHT.id,
  }, { verified: true });
  assert.equal((afterMove.lastDisplay as { fingerprint?: string } | undefined)?.fingerprint, 'display.fp:right');
  assert.equal((afterMove.previousDisplay as { fingerprint?: string } | undefined)?.fingerprint, 'fp-notebook');
});

test('12 bring-back uses previous VERIFIED display', () => {
  const opened = context({
    lastOpenedResource: {
      kind: 'url',
      url: 'https://www.roblox.com/',
      label: 'roblox',
      openState: 'opened',
      windowHandle: '2',
    },
    lastDisplay: { raw: 'right' },
    previousDisplay: { raw: 'notebook', fingerprint: 'fp-notebook' },
  });
  const routed = routeSemanticIntent('Bring it back.', { catalog, context: opened });
  assert.equal(routed?.capabilityId, DESKTOP_PLACE_WINDOW);
  assert.equal((routed?.arguments?.display as { raw?: string })?.raw, 'notebook');
  assert.equal(routed?.arguments?.windowHandle, '2');
});

test('13 focus operates only a managed window', () => {
  const opened = context({
    lastOpenedResource: {
      kind: 'url',
      url: 'https://www.roblox.com/',
      label: 'roblox',
      openState: 'opened',
      windowHandle: '2',
      managedWindowId: 'mw-roblox',
    },
  });
  const routed = routeSemanticIntent('Focus Roblox.', { catalog, context: opened });
  assert.equal(routed?.capabilityId, DESKTOP_FOCUS_WINDOW);
  assert.equal(routed?.arguments?.windowHandle, '2');
  const bare = routeSemanticIntent('Focus Roblox.', { catalog, context: context() });
  assert.equal(bare?.capabilityId, DESKTOP_FOCUS_WINDOW);
  assert.equal(bare?.arguments?.windowHandle, undefined);
});

test('14b existing YouTube-titled Chrome is not taken over', () => {
  const found = discoverManagedWindow({
    pre: [windowAt('133304', RIGHT, { title: '(334) YouTube - Google Chrome' })],
    post: [windowAt('133304', RIGHT, { title: '(334) YouTube - Google Chrome' })],
    expectedProcessNames: ['chrome'],
    url: 'https://www.youtube.com/',
    label: 'YouTube',
  });
  assert.equal(found.ok, false);
  if (!found.ok) assert.equal(found.reasonCode, 'WINDOW_NOT_FOUND');
});

test('14 unrelated owner browser window stays out of discovery', () => {
  const found = discoverManagedWindow({
    pre: [windowAt('1', RIGHT, { title: 'Owner Mail' })],
    post: [windowAt('1', RIGHT, { title: 'Owner Mail' })],
    expectedProcessNames: ['chrome'],
    url: 'https://www.roblox.com/',
    label: 'roblox',
  });
  assert.equal(found.ok, false);
  if (!found.ok) assert.equal(found.reasonCode, 'WINDOW_NOT_FOUND');
});

test('15b discovered window handle is a scope refinement, not a mismatch', () => {
  const descriptor: CapabilityDescriptor = {
    id: 'desktop.openScopedResource',
    description: 'open',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffect: 'write',
    requiredService: 'desktop',
    providerKind: 'local',
    timeoutMs: 5_000,
    untrustedOutput: false,
    effects: [{
      kind: 'APPLICATION_LAUNCH',
      description: 'open',
      destructive: false,
      reversible: true,
      privilege: 'standard_user',
      targetInputFields: ['url'],
    }],
  };
  const breaker = new DestructiveActionCircuitBreaker();
  const preflight = breaker.createPreflight({
    descriptor,
    capabilityInput: { url: 'https://www.roblox.com/' },
    action: 'open',
    why: 'test',
  });
  const containment = new FailureContainment();
  const incident = containment.observe({
    capabilityId: 'desktop.openScopedResource',
    preflight,
    result: {
      capabilityId: 'desktop.openScopedResource',
      status: 'ok',
      structured: { affectedTargets: ['https://www.roblox.com/', 'window:329310'] },
      content: 'ok',
      sourceUrls: [],
      untrustedOutput: false,
      sideEffect: 'write',
    },
    recovery: { state: 'NOT_REQUIRED', strategy: 'none' },
  });
  assert.equal(incident, undefined);
});

test('15 containment scope is bounded to a managed window', () => {
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
      targetInputFields: ['windowHandle', 'url'],
    }],
  };
  const breaker = new DestructiveActionCircuitBreaker();
  const preflight = breaker.createPreflight({
    descriptor,
    capabilityInput: { url: 'https://www.roblox.com/', windowHandle: '2' },
    action: 'place',
    why: 'test',
  });
  const containment = new FailureContainment();
  const result: CapabilityResult = {
    capabilityId: 'desktop.placeWindow',
    status: 'timeout',
    structured: { reasonCode: 'MUTATION_OUTCOME_UNKNOWN', affectedTargets: ['window:2', 'https://www.roblox.com/'] },
    content: 'timeout',
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
  };
  const incident = containment.observe({
    capabilityId: 'desktop.placeWindow',
    preflight,
    result,
    recovery: { state: 'NOT_REQUIRED', strategy: 'none' },
  });
  assert.ok(incident);
  assert.equal(containment.blocks('desktop.placeWindow', {
    ...preflight,
    affectedTargets: ['window:9', 'https://www.youtube.com/'],
  }), undefined);
  assert.ok(containment.blocks('desktop.placeWindow', preflight));
});

test('16 snapshot and place scripts share a cached host version', () => {
  assert.equal(DESKTOP_HOST_VERSION, 3);
  const snap = buildDesktopSnapshotScript();
  const place = buildPlaceWindowScript({ processName: 'chrome', x: 0, y: 0, width: 800, height: 600, windowHandle: '2' });
  const focus = buildFocusWindowScript('2');
  assert.match(snap, /\[JarvisSee\]::Snapshot\(\)/);
  assert.ok(place);
  assert.match(String(place), /Add-Type/);
  assert.doesNotMatch(String(place), /Select-Object -First 1/);
  assert.ok(focus);
  assert.match(String(focus), /\[JarvisSee\]::SetForegroundWindow/);
  assert.match(String(focus), /IsIconic/);
  assert.doesNotMatch(String(focus), /ShowWindow\(\$hwnd, 9\); \[void\]\[JarvisSee\]::SetForegroundWindow/);
  const unscoped = buildPlaceWindowScript({ processName: 'chrome', x: 0, y: 0, width: 800, height: 600 });
  assert.match(String(unscoped), /PLACE_REQUIRES_MANAGED_WINDOW/);
  const inspect = buildInspectWindowScript({ processName: 'chrome' });
  assert.match(String(inspect), /PLACE_REQUIRES_MANAGED_WINDOW/);
});

test('17 window perception provider surface is read-only', () => {
  const snapshot = buildPerceptionSnapshot({ displays: [NOTEBOOK], windows: [], cachedHost: true });
  assert.equal(snapshot.readOnly, true);
  assert.equal('placeWindow' in snapshot, false);
});

test('18 model cannot fabricate a WindowSnapshot', () => {
  assert.equal(parseWindowSnapshot({ title: 'Roblox', Width: 800, Height: 600 }), null);
  assert.equal(parseWindowSnapshot({ Handle: 'abc', Width: 800, Height: 600 }), null);
});

test('19 memory intent does not substitute for verification', async () => {
  const perception = {
    async snapshot() {
      return buildPerceptionSnapshot({ displays: [NOTEBOOK], windows: [], cachedHost: true });
    },
    async getWindow() { return null; },
  };
  const observed = await observeAfterOpen({
    perception,
    pre: await perception.snapshot(),
    expectedProcessNames: ['chrome'],
    url: 'https://www.roblox.com/',
    label: 'roblox',
    attempts: 2,
    delayMs: 0,
  });
  assert.equal(observed.ok, false);
  const applied = applyOpenedResource(context({
    lastDisplay: { raw: 'notebook' },
  }), {
    kind: 'url',
    url: 'https://www.roblox.com/',
    label: 'roblox',
    openState: 'opened',
    display: { raw: 'right' },
  }, { verified: false });
  assert.equal((applied.lastDisplay as { raw?: string } | undefined)?.raw, 'notebook');
});

test('20b Focus Roblox does not reuse a YouTube managed handle', () => {
  const opened = context({
    lastOpenedResource: {
      kind: 'url',
      url: 'https://www.youtube.com/',
      label: 'YouTube',
      openState: 'opened',
      windowHandle: '8',
      managedWindowId: 'mw-yt',
    },
  });
  const routed = routeSemanticIntent('Focus Roblox.', { catalog, context: opened });
  assert.equal(routed?.capabilityId, DESKTOP_FOCUS_WINDOW);
  assert.notEqual(routed?.arguments?.windowHandle, '8');
});

test('20 existing semantic it still resolves to the managed handle', () => {
  const opened = context({
    lastOpenedResource: {
      kind: 'url',
      url: 'https://www.roblox.com/',
      label: 'roblox',
      openState: 'opened',
      windowHandle: '2',
      managedWindowId: 'mw-roblox',
    },
  });
  const routed = routeSemanticIntent('Move it to the right monitor.', { catalog, context: opened });
  assert.equal(routed?.capabilityId, DESKTOP_PLACE_WINDOW);
  assert.equal(routed?.arguments?.windowHandle, '2');
});
