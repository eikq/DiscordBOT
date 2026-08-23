import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeCommunitySetup, readCommunitySetup, setupIsComplete, shouldRedirectToCommunitySetup } from '../src/jarvis/community/setup/store';
import { isLoopbackHttpUrl, probeOpenAiCompatibleEndpoint } from '../src/jarvis/community/setup/modelProbe';
import { assertKnownServiceId, readOwnership, stopCommunityService } from '../src/jarvis/community/runtime/serviceManager';

test('incomplete setup API payload redirects to the wizard', () => {
  assert.equal(shouldRedirectToCommunitySetup({ completed: false }, true), true);
  assert.equal(shouldRedirectToCommunitySetup({ completed: true }, true), false);
  assert.equal(shouldRedirectToCommunitySetup({ completed: false }, false), false);
  assert.equal(shouldRedirectToCommunitySetup(null, true), false);
});

test('setup store writes community config without secrets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-setup-'));
  const saved = writeCommunitySetup({
    schemaVersion: 1,
    completed: true,
    language: 'th',
    profile: 'standard',
    autoStart: true,
    closeBehavior: 'keep-model',
    managedServiceIds: ['jarvis-core'],
    updatedAt: new Date().toISOString(),
    model: { mode: 'endpoint', baseUrl: 'http://127.0.0.1:8086/v1', modelId: 'local-model', hasApiKey: true },
  }, root);
  assert.equal(setupIsComplete(saved), true);
  const raw = fs.readFileSync(path.join(root, 'config', 'setup.json'), 'utf8');
  assert.doesNotMatch(raw, /sk-|\"apiKey\"|\"secret\"/i);
  assert.equal(readCommunitySetup(root).model.baseUrl, 'http://127.0.0.1:8086/v1');
});

test('model probe rejects non-loopback endpoints', async () => {
  const result = await probeOpenAiCompatibleEndpoint({ baseUrl: 'https://example.com/v1' });
  assert.equal(result.ok, false);
  assert.equal(isLoopbackHttpUrl('https://example.com/v1'), false);
});

test('model probe treats 127.0.0.1 with a port as loopback', () => {
  assert.equal(isLoopbackHttpUrl('http://127.0.0.1:8086/v1'), true);
  assert.equal(isLoopbackHttpUrl('http://localhost:8086/v1'), true);
  assert.equal(isLoopbackHttpUrl(''), false);
});

test('JSON body parser is registered before community setup routes', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  const jsonAt = source.indexOf('express.json');
  const communityAt = source.indexOf('registerCommunityRuntimeRoutes(app');
  assert.ok(jsonAt >= 0 && communityAt >= 0 && jsonAt < communityAt);
});

test('service manager refuses unknown ids and unowned stops', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-svc-'));
  assert.throws(() => assertKnownServiceId('discord'));
  await assert.rejects(() => stopCommunityService('local-ai', root));
  assert.equal(readOwnership(root).some(item => (item.serviceId as string) === 'discord'), false);
});

test('managed model spawn stays on loopback and does not force-kill', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/jarvis/community/runtime/serviceManager.ts'), 'utf8');
  assert.match(source, /127\.0\.0\.1/);
  assert.doesNotMatch(source, /taskkill[^\n]*\/F/i);
  assert.doesNotMatch(source, /['"]\/F['"]/);
  assert.doesNotMatch(source, /req\.body\?\.pid/);
  assert.doesNotMatch(source, /req\.body\?\.command/);
});
