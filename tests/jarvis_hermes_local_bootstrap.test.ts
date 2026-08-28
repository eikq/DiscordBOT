import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveOwnerHermesRuntimeBootstrap } from '../src/jarvis/runtime';

test('owner runtime respects explicit legacy mode', () => {
  const result = resolveOwnerHermesRuntimeBootstrap({
    JARVIS_AGENT_RUNTIME: 'legacy',
    JARVIS_HERMES_API_KEY: 'must-not-matter',
  });
  assert.equal(result.runtime, 'legacy');
  assert.equal(result.source, 'explicit');
});

test('owner runtime reuses the local Hermes API secret without writing it to repo env', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-hermes-bootstrap-'));
  const hermes = path.join(root, 'hermes');
  fs.mkdirSync(hermes, { recursive: true });
  fs.writeFileSync(path.join(hermes, '.env'), [
    'API_SERVER_ENABLED=true',
    'API_SERVER_PORT=9876',
    'API_SERVER_KEY=local-secret',
  ].join('\n'));
  const result = resolveOwnerHermesRuntimeBootstrap({}, {
    localAppData: root,
    workspaceRoot: 'C:\\owner\\DiscordBOT-hermes',
  });
  assert.equal(result.runtime, 'hermes');
  assert.equal(result.source, 'local-hermes');
  assert.equal(result.secretSource, 'hermes-local-env');
  assert.equal(result.env.JARVIS_HERMES_API_KEY, 'local-secret');
  assert.equal(result.env.JARVIS_HERMES_BASE_URL, 'http://127.0.0.1:9876');
  assert.equal(result.env.JARVIS_HERMES_PROFILE, 'jarvis');
  assert.equal(result.env.JARVIS_HERMES_MCP_SERVERS, 'serena-jarvis-hermes');
  assert.equal(result.env.JARVIS_PROJECT_ID, 'jarvis');
  assert.equal(result.env.JARVIS_WORKSPACE_ROOT, 'C:\\owner\\DiscordBOT-hermes');
  fs.rmSync(root, { recursive: true, force: true });
});

test('owner runtime stays legacy when no Hermes secret is available', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-no-hermes-'));
  const result = resolveOwnerHermesRuntimeBootstrap({}, { localAppData: root });
  assert.equal(result.runtime, 'legacy');
  assert.equal(result.source, 'legacy');
  fs.rmSync(root, { recursive: true, force: true });
});
