import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteJarvisMemoryStore } from '../src/bot/memory/jarvis/SqliteJarvisMemoryStore';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-live-sem-'));
const dbPath = path.join(dir, 'jarvis.db');

function summarize(label: string, out: Awaited<ReturnType<ReturnType<typeof createJarvisLabRuntime>['ask']>>) {
  const action = out.result.actionResults?.[0];
  return {
    label,
    kind: out.intent?.kind,
    detail: out.intent?.detail,
    capability: out.intent?.capabilityId,
    spoken: String(out.presented?.text || out.result.suggestedContent || '').slice(0, 280),
    pending: out.pendingConfirmation?.capabilityId || null,
    pendingTarget: out.pendingConfirmation?.target || null,
    action: action?.name || null,
    actionSummary: action?.summary || null,
  };
}

async function main() {
  const store = SqliteJarvisMemoryStore.open(dbPath);
  const runtime = createJarvisLabRuntime({
    attachDefaultCapabilities: true,
    memoryStore: store,
    attachDefaultSpeech: false,
    attachDefaultPresentation: true,
    commandCenter: false,
    reminders: false,
    research: false,
    workspace: false,
  });
  const sessionId = 'live-sem';
  const rows = [];
  for (const text of [
    'open roblox website in notebook monitor',
    'Move it to the right monitor.',
    'Bring it back.',
    'What do you remember about my monitors?',
    'When I say notebook monitor, I mean the built-in laptop display.',
    'What do you remember about my monitors?',
  ]) {
    rows.push(summarize(text, await runtime.ask({ text, sessionId, speak: false })));
  }
  store.close();
  const store2 = SqliteJarvisMemoryStore.open(dbPath);
  const runtime2 = createJarvisLabRuntime({
    attachDefaultCapabilities: true,
    memoryStore: store2,
    attachDefaultSpeech: false,
    attachDefaultPresentation: true,
    commandCenter: false,
    reminders: false,
    research: false,
    workspace: false,
  });
  rows.push(summarize('restart: Open Roblox on notebook monitor.', await runtime2.ask({
    text: 'Open Roblox on notebook monitor.',
    sessionId: 'live-sem-2',
    speak: false,
  })));
  rows.push(summarize('mixed', await runtime2.ask({
    text: 'Jarvis เปิด Roblox website บน laptop display',
    sessionId: 'live-sem-2',
    speak: false,
  })));
  rows.push(summarize('gap click', await runtime2.ask({
    text: 'Search Roblox and click the first game',
    sessionId: 'live-sem-2',
    speak: false,
  })));
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

void main();
