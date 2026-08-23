import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { applyCommunityEditionEnv } from '../src/jarvis/edition/resolve';
import { readCommunitySetup, setupIsComplete } from '../src/jarvis/community/setup/store';
import { startCommunityService, stopOwnedServicesForShutdown } from '../src/jarvis/community/runtime/serviceManager';

const ROOT = process.cwd();

function portOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(400);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

function httpOk(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      res.resume();
      resolve((res.statusCode || 500) < 500);
    });
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
}

async function waitForHealth(port: string): Promise<boolean> {
  for (let i = 0; i < 40; i += 1) {
    if (await httpOk(`http://127.0.0.1:${port}/api/health`)) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function start() {
  if (Number(process.versions.node.split('.')[0]) < 18) {
    console.error('JARVIS needs Node.js 18 or newer.');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    console.log('Installing program components once (npm ci)...');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const install = spawn(npm, ['ci'], { cwd: ROOT, stdio: 'inherit', windowsHide: false });
    const code: number = await new Promise(resolve => install.on('exit', value => resolve(value ?? 1)));
    if (code !== 0) process.exit(code);
  }

  process.env.JARVIS_EDITION = 'community';
  process.env.JARVIS_STANDALONE = '1';
  process.env.HOST = '127.0.0.1';
  dotenv.config({ path: '.env.community', quiet: true });
  applyCommunityEditionEnv();
  const port = process.env.PORT || '3012';
  const setup = readCommunitySetup();
  const pathName = setupIsComplete(setup) ? '/jarvis' : '/setup';
  const url = `http://127.0.0.1:${port}${pathName}`;

  if (await httpOk(`http://127.0.0.1:${port}/api/health`)) {
    console.log('JARVIS is already running.');
    openBrowser(url);
    return;
  }
  if (await portOpen(Number(port))) {
    console.log(`Port ${port} is already in use. Opening the existing page.`);
    openBrowser(url);
    return;
  }

  if (setupIsComplete(setup) && setup.model.mode === 'managed' && setup.managedServiceIds.includes('local-ai')) {
    try {
      await startCommunityService('local-ai');
    } catch (error) {
      console.warn(error instanceof Error ? error.message : String(error));
    }
  }

  console.log('Starting JARVIS Community...');
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/start_jarvis_community.ts'], {
    cwd: ROOT,
    env: { ...process.env, JARVIS_EDITION: 'community', HOST: '127.0.0.1', PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  child.stdout?.on('data', chunk => process.stdout.write(chunk));
  child.stderr?.on('data', chunk => process.stderr.write(chunk));
  const ready = await waitForHealth(port);
  if (!ready) {
    console.error('JARVIS did not become ready.');
    process.exit(1);
  }
  openBrowser(url);
  console.log(`Open: ${url}`);
  await new Promise<void>(resolve => child.on('exit', () => resolve()));
}

function stop() {
  process.env.JARVIS_EDITION = 'community';
  dotenv.config({ path: '.env.community', quiet: true });
  applyCommunityEditionEnv();
  const setup = readCommunitySetup();
  stopOwnedServicesForShutdown(setup.closeBehavior === 'stop-owned-model' ? 'stop-owned-model' : 'keep-model');
  console.log(setup.closeBehavior === 'stop-owned-model'
    ? 'Stopped JARVIS-owned services, including Local AI.'
    : 'Stopped JARVIS-owned services. Local AI was left running.');
}

const command = process.argv[2];
if (command === 'stop') void stop();
else void start().catch(error => {
  console.error(error);
  process.exit(1);
});
