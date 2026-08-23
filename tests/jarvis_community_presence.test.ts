import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PRESENCE_LAYERS, boxesOverlap, livePendingConfirmation, permissionFooterReachable } from '../src/jarvis/ui/presence/presenceLayers';
import { presencePhaseLabel } from '../src/jarvis/ui/presence/presenceRuntime';

test('permission footer is not covered by context when context is hidden', () => {
  const footer = { left: 760, top: 520, width: 400, height: 64 };
  const context = { left: 700, top: 500, width: 520, height: 180 };
  const blocked = permissionFooterReachable({
    permissionOpen: true,
    contextHiddenWhilePermission: false,
    modalFooter: footer,
    context,
    canvasPointerEvents: 'none',
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blockers.includes('jarvis-context'));

  const fixed = permissionFooterReachable({
    permissionOpen: true,
    contextHiddenWhilePermission: true,
    modalFooter: footer,
    context,
    canvas: { left: 0, top: 0, width: 1916, height: 904 },
    canvasPointerEvents: 'none',
  });
  assert.equal(fixed.ok, true);
  assert.equal(boxesOverlap(footer, context), true);
  assert.ok(PRESENCE_LAYERS.modal > PRESENCE_LAYERS.dock);
  assert.ok(PRESENCE_LAYERS.dock > PRESENCE_LAYERS.webgl);
});

test('community health copy does not say owner offline', () => {
  assert.equal(presencePhaseLabel('IDLE', 'community'), 'JARVIS READY');
  assert.equal(presencePhaseLabel('OFFLINE', 'community'), 'MODEL OFFLINE');
  assert.equal(presencePhaseLabel('IDLE'), 'JARVIS READY');
  assert.doesNotMatch(presencePhaseLabel('IDLE'), /owner/i);
  assert.equal(presencePhaseLabel('IDLE', 'owner'), 'Awaiting the owner');
  const runtime = fs.readFileSync(path.join(process.cwd(), 'src/jarvis/ui/presence/presenceRuntime.ts'), 'utf8');
  assert.doesNotMatch(runtime, /OWNER OFFLINE/);
});

test('cinematic CSS no longer stacks approve with the dock', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/jarvis/ui/presence/cinematic/cinematic.css'), 'utf8');
  const grouped = css.match(/\.jp\[data-cinematic="true"\] \.jp-mark,[\s\S]*?z-index:\s*var\(--jp-z-hud/);
  assert.ok(grouped);
  assert.doesNotMatch(grouped?.[0] || '', /\.jp-approve/);
  assert.doesNotMatch(grouped?.[0] || '', /\.jp-dock/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /\.jp-approve__row/);
});

test('stale permission cards are dropped when expiry is required', () => {
  assert.equal(livePendingConfirmation({ proposalId: 'p1', token: 't1' }, { requireExpiry: true }), null);
  assert.equal(livePendingConfirmation({ proposalId: 'p1', token: 't1', expiresAt: '2000-01-01T00:00:00.000Z' }), null);
  assert.equal(livePendingConfirmation({ proposalId: 'p1', token: 't1', expiresAt: '2099-01-01T00:00:00.000Z' })?.proposalId, 'p1');
});

test('permission actions are native buttons and allow-once is focused', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/jarvis/ui/presence/PresenceApproval.tsx'), 'utf8');
  assert.match(source, /onceRef\.current\?\.focus\(\)/);
  assert.match(source, /data-testid="jp-permission-deny"/);
  assert.match(source, /data-testid="jp-permission-once"/);
  assert.match(source, /data-testid="jp-permission-task"/);
  assert.match(source, /type="button"/);
  assert.match(source, /role="dialog"/);
});
