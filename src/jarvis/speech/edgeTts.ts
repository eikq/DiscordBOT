import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SourceTtsResult } from './types';

export function resolveEdgeTtsPython(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.STANDALONE_EDGE_TTS_PYTHON?.trim();
  if (configured && fs.existsSync(configured)) return configured;
  const candidates = [
    path.join(process.cwd(), '.venv-rvc', 'Scripts', 'python.exe'),
    path.join(process.cwd(), '.venv-rvc', 'bin', 'python'),
  ];
  return candidates.find(item => fs.existsSync(item)) || null;
}

export function edgeTtsAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveEdgeTtsPython(env));
}

export async function synthesizeEdgeTts(
  text: string,
  options: { turnId: string; voice?: string; rate?: string; python?: string; timeoutMs?: number } = { turnId: 'edge' },
): Promise<SourceTtsResult> {
  const python = options.python || resolveEdgeTtsPython();
  if (!python) throw new Error('Edge-TTS Python environment is not available.');
  const voice = options.voice || process.env.EDGE_TTS_VOICE || 'th-TH-NiwatNeural';
  const rate = options.rate || process.env.EDGE_TTS_RATE || '-8%';
  const outFile = path.join(os.tmpdir(), `jarvis-edge-${options.turnId}-${Date.now()}.mp3`);
  const script = [
    'import asyncio, edge_tts, sys',
    'text, voice, rate, out = sys.argv[1:5]',
    'asyncio.run(edge_tts.Communicate(text, voice, rate=rate).save(out))',
  ].join('\n');
  const started = Date.now();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, ['-c', script, text, voice, rate, outFile], {
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Edge-TTS timed out'));
    }, options.timeoutMs ?? 30_000);
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Edge-TTS exited with code ${code}`));
    });
  });
  try {
    const audio = fs.readFileSync(outFile);
    if (audio.byteLength < 16) throw new Error('Edge-TTS returned empty audio.');
    return { audio, mime: 'audio/mpeg', engine: 'edge', latencyMs: Date.now() - started };
  } finally {
    try { fs.rmSync(outFile, { force: true }); } catch { /* temp only */ }
  }
}
