import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import dotenv from 'dotenv';
import { applyCommunityEditionEnv, jarvisDataRoot } from '../src/jarvis/edition/resolve';

function majorNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  return Number.isFinite(major) ? major : 0;
}

function portInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ port, host });
    socket.setTimeout(400);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

async function choosePort(): Promise<string> {
  const requested = process.env.PORT?.trim();
  const candidates = requested
    ? [requested, requested === '3012' ? '3013' : '3012']
    : ['3012', '3013'];
  for (const port of candidates) {
    if (!(await portInUse(Number(port)))) return port;
  }
  return candidates[0]!;
}

async function main() {
  if (majorNodeVersion() < 18) {
    console.error('JARVIS Community Edition needs Node.js 18 or newer.');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(process.cwd(), 'node_modules'))) {
    console.error('Dependencies are missing. Run npm install first.');
    process.exit(1);
  }

  process.env.JARVIS_EDITION = 'community';
  process.env.JARVIS_STANDALONE = '1';
  process.env.HOST = '127.0.0.1';
  dotenv.config({ path: '.env.community', quiet: true });
  process.env.PORT = await choosePort();
  applyCommunityEditionEnv();

  const root = jarvisDataRoot();
  const port = process.env.PORT || '3012';
  const model = process.env.JARVIS_LLM_MODEL || process.env.LOCAL_QWEN_MODEL || 'local-model';
  const endpoint = process.env.JARVIS_LLM_BASE_URL || process.env.LOCAL_QWEN_BASE_URL || 'http://127.0.0.1:8086/v1';

  console.log('====================================================');
  console.log('  JARVIS Community Edition');
  console.log('====================================================');
  console.log(`Data root: ${root}`);
  console.log(`Bind:      127.0.0.1:${port}`);
  console.log(`Open:      http://127.0.0.1:${port}/jarvis`);
  console.log(`Model:     ${model}`);
  console.log(`Endpoint:  ${endpoint}`);
  console.log('Community does not start Discord, CCTV, or private device control.');
  console.log('Start an OpenAI-compatible local model separately if needed.');
  console.log('');

  await import('../server.ts');
}

void main();
