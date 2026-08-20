import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConfirmationStore,
  PermissionPolicy,
  createActionGate,
  createStandaloneCapabilityHost,
  validateActionInput,
} from '../src/jarvis';
import { CapabilityRegistry } from '../src/jarvis/capabilities/CapabilityRegistry';
import {
  DESKTOP_FOCUS_JARVIS_WINDOW,
  DESKTOP_GET_JARVIS_WINDOW,
  DESKTOP_LIST_DISPLAYS,
  DESKTOP_MOVE_JARVIS_WINDOW,
  DESKTOP_SET_JARVIS_LAYOUT,
  DESKTOP_SET_JARVIS_WINDOW_BOUNDS,
  JarvisPresenceStore,
  applyOwnerDisplayNames,
  createJarvisWindowHost,
  inferDesktopPresenceIntent,
  parseClientWindowReport,
  parseDisplayJson,
  registerDesktopPresenceCapabilities,
  resolveDisplaySelector,
} from '../src/jarvis/desktop';
import type { DisplayInfo, NativeJarvisWindowAdapter } from '../src/jarvis/desktop';
import type { DesktopAllowlists } from '../src/jarvis/capabilities/actions/types';

const DISPLAYS: DisplayInfo[] = [
  {
    id: '\\\\.\\DISPLAY1',
    name: 'DISPLAY1',
    aliases: ['1'],
    primary: true,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workingArea: { x: 0, y: 0, width: 1920, height: 1040 },
    ownerNamed: false,
  },
  {
    id: '\\\\.\\DISPLAY2',
    name: 'DISPLAY2',
    aliases: ['2'],
    primary: false,
    bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
    workingArea: { x: 1920, y: 0, width: 2560, height: 1400 },
    ownerNamed: false,
  },
];

function allowlists(): DesktopAllowlists {
  return {
    applications: [],
    projects: [],
    trustedOrigins: ['http://127.0.0.1:3010'],
    trustedPathPrefixes: ['/jarvis-lab'],
    explorerExecutable: 'C:\\Safe\\explorer.exe',
    workspaceRoot: process.cwd(),
  };
}

function hostWith(native?: NativeJarvisWindowAdapter) {
  const presence = new JarvisPresenceStore();
  presence.reportClientWindow({
    screenX: 80,
    screenY: 40,
    outerWidth: 1400,
    outerHeight: 900,
  });
  const windowHost = createJarvisWindowHost({
    presence,
    hostKind: native ? 'test' : 'browser',
    ownerNames: [{ id: '\\\\.\\DISPLAY1', name: 'notebook', aliases: ['laptop', 'จอโน้ตบุ๊ก'] }],
    enumerateDisplays: async () => DISPLAYS,
    native,
  });
  const registry = new CapabilityRegistry();
  registerDesktopPresenceCapabilities(registry, { windowHost });
  const gate = createActionGate(registry, {
    allowlists: allowlists(),
    policy: new PermissionPolicy(),
    confirmations: new ConfirmationStore(),
    now: () => 1_700_000_000_000,
  });
  return { gate, presence, windowHost };
}

test('display selector resolves index, primary, external, and owner-named notebook', () => {
  const named = applyOwnerDisplayNames(DISPLAYS, [
    { id: '\\\\.\\DISPLAY1', name: 'notebook', aliases: ['laptop'] },
  ]);
  const second = resolveDisplaySelector(named, { index: 2 });
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.display.id, '\\\\.\\DISPLAY2');
  const primary = resolveDisplaySelector(named, { role: 'primary' });
  assert.equal(primary.ok && primary.display.primary, true);
  const external = resolveDisplaySelector(named, { role: 'external' });
  assert.equal(external.ok && external.display.id, '\\\\.\\DISPLAY2');
  const notebook = resolveDisplaySelector(named, { role: 'notebook' });
  assert.equal(notebook.ok && notebook.display.name, 'notebook');
  const missing = resolveDisplaySelector(named, { name: 'projector' });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reasonCode, 'DISPLAY_NOT_FOUND');
});

test('intents map monitor phrases to Jarvis-window capabilities only', () => {
  const move = inferDesktopPresenceIntent('move yourself to monitor 2');
  assert.equal(move.kind, 'action');
  if (move.kind === 'action') {
    assert.equal(move.capabilityId, DESKTOP_MOVE_JARVIS_WINDOW);
    assert.deepEqual(move.arguments.displaySelector, { index: 2 });
  }
  const main = inferDesktopPresenceIntent('move to the main monitor');
  assert.equal(main.kind, 'action');
  if (main.kind === 'action') {
    assert.deepEqual(main.arguments.displaySelector, { role: 'primary' });
  }
  const notebook = inferDesktopPresenceIntent('move to the notebook display');
  assert.equal(notebook.kind, 'action');
  if (notebook.kind === 'action') {
    assert.deepEqual(notebook.arguments.displaySelector, { role: 'notebook' });
  }
  const presenter = inferDesktopPresenceIntent('open presenter mode on the external screen');
  assert.equal(presenter.kind, 'action');
  if (presenter.kind === 'action') {
    assert.equal(presenter.capabilityId, DESKTOP_SET_JARVIS_LAYOUT);
    assert.equal(presenter.arguments.layout, 'presenter');
  }
  const maximize = inferDesktopPresenceIntent('maximize on the current display');
  assert.equal(maximize.kind, 'action');
  if (maximize.kind === 'action') {
    assert.equal(maximize.capabilityId, DESKTOP_SET_JARVIS_LAYOUT);
    assert.equal(maximize.arguments.layout, 'maximized');
  }
  assert.equal(inferDesktopPresenceIntent('open Chrome').kind, 'none');
  assert.equal(inferDesktopPresenceIntent('click the other app').kind, 'none');
  assert.equal(inferDesktopPresenceIntent('ย้ายไปเปิด Chrome').kind, 'none');
});

test('browser host can list/report displays but fails closed on move', async () => {
  const { gate } = hostWith();
  const listed = await gate.invoke({ id: DESKTOP_LIST_DISPLAYS, input: {} });
  assert.equal(listed.status, 'ok');
  assert.equal((listed.structured as { displays: unknown[] }).displays.length, 2);
  const current = await gate.invoke({ id: DESKTOP_GET_JARVIS_WINDOW, input: {} });
  assert.equal(current.status, 'ok');
  const move = await gate.invoke({
    id: DESKTOP_MOVE_JARVIS_WINDOW,
    input: { displaySelector: { index: 2 } },
  });
  assert.equal(move.status, 'confirmation_required');
});

test('browser move without confirmation stays gated; after confirm it reports UNSUPPORTED_HOST', async () => {
  const { gate } = hostWith();
  const pending = await gate.invoke({
    id: DESKTOP_MOVE_JARVIS_WINDOW,
    input: { displaySelector: { role: 'external' } },
  });
  assert.equal(pending.status, 'confirmation_required');
  const confirmed = await gate.confirm({
    proposalId: String(pending.structured.proposalId),
    token: String(pending.structured.confirmToken),
  });
  assert.equal(confirmed.status, 'unavailable');
  assert.equal(confirmed.error, 'UNSUPPORTED_HOST');
});

test('native helper can move and restore the Jarvis window only', async () => {
  let bounds = { x: 80, y: 40, width: 1400, height: 900 };
  const native: NativeJarvisWindowAdapter = {
    setBounds: async next => {
      bounds = next;
      return {
        status: 'moved',
        message: 'moved',
        hostKind: 'test',
        window: {
          available: true,
          hostKind: 'test',
          bounds,
          displayId: next.x >= 1920 ? '\\\\.\\DISPLAY2' : '\\\\.\\DISPLAY1',
          displayName: next.x >= 1920 ? 'DISPLAY2' : 'notebook',
          state: 'normal',
          source: 'native',
        },
      };
    },
    getWindow: async () => ({
      available: true,
      hostKind: 'test',
      bounds,
      displayId: bounds.x >= 1920 ? '\\\\.\\DISPLAY2' : '\\\\.\\DISPLAY1',
      displayName: bounds.x >= 1920 ? 'DISPLAY2' : 'notebook',
      state: 'normal',
      source: 'native',
    }),
  };
  const { gate } = hostWith(native);
  const pending = await gate.invoke({
    id: DESKTOP_MOVE_JARVIS_WINDOW,
    input: { displaySelector: { index: 2 } },
  });
  const moved = await gate.confirm({
    proposalId: String(pending.structured.proposalId),
    token: String(pending.structured.confirmToken),
  });
  assert.equal(moved.status, 'ok');
  assert.equal((moved.structured as { result?: string }).result, 'moved');
  assert.ok(bounds.x >= 1920);
  const restorePending = await gate.invoke({
    id: DESKTOP_SET_JARVIS_LAYOUT,
    input: { layout: 'restore' },
  });
  const restored = await gate.confirm({
    proposalId: String(restorePending.structured.proposalId),
    token: String(restorePending.structured.confirmToken),
  });
  assert.equal(restored.status, 'ok');
  assert.ok(bounds.x < 1920);
});

test('schema rejects other-window targeting and unknown capabilities stay denied', async () => {
  const lists = allowlists();
  const hwnd = validateActionInput(DESKTOP_MOVE_JARVIS_WINDOW, { hwnd: '0x1234' }, lists);
  assert.equal(hwnd.ok, false);
  if (!hwnd.ok) assert.equal(hwnd.reasonCode, 'FORBIDDEN_ARGUMENT');
  const process = validateActionInput(DESKTOP_FOCUS_JARVIS_WINDOW, { processName: 'chrome.exe' }, lists);
  assert.equal(process.ok, false);
  const { gate } = hostWith();
  const other = await gate.invoke({ id: 'desktop.moveOtherWindow', input: { processName: 'notepad' } });
  assert.ok(other.status === 'rejected' || other.status === 'error' || other.status === 'unavailable');
});

test('read-only list/get do not require confirmation', async () => {
  const { gate } = hostWith();
  const listed = await gate.invoke({ id: DESKTOP_LIST_DISPLAYS, input: {} });
  const current = await gate.invoke({ id: DESKTOP_GET_JARVIS_WINDOW, input: {} });
  assert.equal(listed.status, 'ok');
  assert.equal(current.status, 'ok');
  assert.notEqual(listed.status, 'confirmation_required');
});

test('standalone host registers presence capabilities', () => {
  const host = createStandaloneCapabilityHost({
    worldIntel: false,
    reminders: false,
    research: false,
    workspace: false,
    actions: {
      allowlists: allowlists(),
    },
  });
  const ids = host.list().map(item => item.id);
  assert.ok(ids.includes(DESKTOP_LIST_DISPLAYS));
  assert.ok(ids.includes(DESKTOP_GET_JARVIS_WINDOW));
  assert.ok(ids.includes(DESKTOP_MOVE_JARVIS_WINDOW));
  assert.ok(ids.includes(DESKTOP_SET_JARVIS_WINDOW_BOUNDS));
  assert.ok(ids.includes(DESKTOP_FOCUS_JARVIS_WINDOW));
  assert.ok(ids.includes(DESKTOP_SET_JARVIS_LAYOUT));
});

test('client presence reports reject other-window fields', () => {
  const ok = parseClientWindowReport({ screenX: 10, screenY: 10, outerWidth: 1200, outerHeight: 800 });
  assert.equal(ok.ok, true);
  const hwnd = parseClientWindowReport({ screenX: 10, screenY: 10, outerWidth: 1200, outerHeight: 800, hwnd: '0x1' });
  assert.equal(hwnd.ok, false);
  if (!hwnd.ok) assert.equal(hwnd.reasonCode, 'FORBIDDEN_ARGUMENT');
});

test('Windows display JSON parser is fail-closed on garbage', () => {
  assert.deepEqual(parseDisplayJson(''), []);
  assert.deepEqual(parseDisplayJson('not-json'), []);
  const parsed = parseDisplayJson(JSON.stringify({
    DeviceName: '\\\\.\\DISPLAY1',
    Primary: true,
    X: 0,
    Y: 0,
    Width: 1920,
    Height: 1080,
    WorkingX: 0,
    WorkingY: 0,
    WorkingWidth: 1920,
    WorkingHeight: 1040,
  }));
  assert.equal(parsed[0]?.primary, true);
  assert.equal(parsed[0]?.bounds.width, 1920);
});
