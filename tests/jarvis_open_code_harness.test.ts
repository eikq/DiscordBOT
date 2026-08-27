import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createOpenCodeHarness,
  shouldUseOpenCodeHarness,
  worldIntelMcpCommand,
  writeOpenCodeWorkspaceConfig,
} from '../src/jarvis/coding/openCodeHarness';

function fakeSpawn(capture: { binary?: string; argv?: string[]; options?: { shell?: boolean } }) {
  return (binary: string, argv: string[], options: { shell?: boolean }) => {
    capture.binary = binary;
    capture.argv = argv;
    capture.options = options;
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    queueMicrotask(() => {
      child.stdout.emit('data', '{"ok":true}');
      child.emit('close', 0);
    });
    return child;
  };
}

test('shouldUseOpenCodeHarness matches cinematic React/Vite BUILD_WEBSITE briefs', () => {
  assert.equal(shouldUseOpenCodeHarness('สร้างเว็บพรีเซนต์ React + Vite 7 สไลด์ BUILD_WEBSITE ใน ProjectWorkspace'), true);
  assert.equal(shouldUseOpenCodeHarness('hello there'), false);
});

test('OpenCode harness is skipped inside unit tests by default', async () => {
  const result = await createOpenCodeHarness().run({
    workspaceDir: os.tmpdir(),
    brief: 'BUILD_WEBSITE React + Vite',
    title: 'Deck',
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.wroteConfig, false);
});

test('OpenCode harness reports unavailable when the binary is missing', async () => {
  const result = await createOpenCodeHarness({
    skipLive: false,
    resolveBinary: () => undefined,
  }).run({
    workspaceDir: os.tmpdir(),
    brief: 'BUILD_WEBSITE',
    title: 'Deck',
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.argv.length, 0);
});

test('OpenCode harness writes bash-deny config, attaches MCP only when present, and never skips permissions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-opencode-'));
  const capture: { binary?: string; argv?: string[]; options?: { shell?: boolean } } = {};
  const cmd = path.join(dir, 'opencode.cmd');
  const mcp = path.join(dir, 'world-intel-mcp.exe');
  fs.writeFileSync(cmd, '@echo off\n');
  fs.writeFileSync(mcp, 'fake');
  const previous = process.env.WORLD_INTEL_MCP_COMMAND;
  process.env.WORLD_INTEL_MCP_COMMAND = mcp;
  try {
    assert.equal(worldIntelMcpCommand(), mcp);
    const written = writeOpenCodeWorkspaceConfig(dir, mcp);
    const config = fs.readFileSync(written.configPath, 'utf8');
    assert.match(config, /"bash": "deny"/);
    assert.match(config, /"webfetch": "deny"/);
    assert.equal(written.mcpAttached, true);
    const missing = writeOpenCodeWorkspaceConfig(dir, path.join(dir, 'missing-mcp.exe'));
    assert.equal(missing.mcpAttached, false);

    const result = await createOpenCodeHarness({
      skipLive: false,
      resolveBinary: () => cmd,
      spawnImpl: fakeSpawn(capture) as never,
    }).run({
      workspaceDir: dir,
      brief: '7 slide JARVIS capability deck React + Vite',
      title: 'JARVIS Capability Deck',
    });
    assert.equal(result.status, 'completed');
    if (process.platform === 'win32') {
      assert.equal(capture.options?.shell, true);
    }
    assert.ok(capture.argv);
    assert.equal(capture.argv[0], 'run');
    assert.equal(capture.argv.includes('--dir'), true);
    assert.equal(capture.argv.includes(dir), true);
    assert.doesNotMatch(capture.argv.join(' '), /dangerously-skip-permissions/i);
    assert.match(result.argv.join(' '), /--format json/);
  } finally {
    if (previous === undefined) delete process.env.WORLD_INTEL_MCP_COMMAND;
    else process.env.WORLD_INTEL_MCP_COMMAND = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
