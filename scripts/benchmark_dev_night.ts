import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadNightConfig } from '../src/agent/night/loadConfig';

type CtxProbe = {
  numCtx: number;
  ok: boolean;
  cold?: Record<string, unknown>;
  warm?: Record<string, unknown>;
  error?: string;
  gpuAfter?: string;
};

function gpuSnapshot(): string {
  try {
    return execFileSync('nvidia-smi', [
      '--query-gpu=name,memory.used,memory.total,memory.free,utilization.gpu',
      '--format=csv,noheader,nounits',
    ], { encoding: 'utf8' }).trim();
  } catch {
    return 'nvidia-smi unavailable';
  }
}

function ramSnapshot(): { totalMb: number; freeMb: number } {
  return {
    totalMb: Math.round(os.totalmem() / 1_048_576),
    freeMb: Math.round(os.freemem() / 1_048_576),
  };
}

async function probeHttp(url: string): Promise<{ ok: boolean; body?: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    const body = await response.text();
    return { ok: response.ok, body: body.slice(0, 400) };
  } catch (error) {
    return { ok: false, body: error instanceof Error ? error.message : String(error) };
  }
}

async function ollamaGenerate(input: {
  baseUrl: string;
  model: string;
  numCtx: number;
  keepAlive: string;
  gpuLayers: number;
  prompt: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch(input.baseUrl.replace(/\/$/, '') + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      stream: false,
      think: false,
      keep_alive: input.keepAlive,
      options: {
        temperature: 0,
        num_ctx: input.numCtx,
        num_predict: 32,
        num_gpu: input.gpuLayers,
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error('Ollama HTTP ' + response.status + ' ' + (await response.text()).slice(0, 300));
  const json = await response.json() as Record<string, unknown>;
  const promptCount = Number(json.prompt_eval_count || 0);
  const promptNs = Number(json.prompt_eval_duration || 0);
  const evalCount = Number(json.eval_count || 0);
  const evalNs = Number(json.eval_duration || 0);
  return {
    loadDurationNs: json.load_duration,
    evalCount,
    evalDurationNs: evalNs,
    promptEvalCount: promptCount,
    promptEvalDurationNs: promptNs,
    promptTokPerSec: promptNs > 0 ? Number((promptCount / (promptNs / 1e9)).toFixed(2)) : null,
    genTokPerSec: evalNs > 0 ? Number((evalCount / (evalNs / 1e9)).toFixed(2)) : null,
    sample: String(json.response || '').slice(0, 120),
  };
}

async function ollamaPs(baseUrl: string): Promise<unknown> {
  const response = await fetch(baseUrl.replace(/\/$/, '') + '/api/ps', { signal: AbortSignal.timeout(3000) });
  if (!response.ok) return { error: 'ps HTTP ' + response.status };
  return response.json();
}

const { config } = loadNightConfig();
const services = {
  asr: await probeHttp('http://127.0.0.1:8765/health'),
  rvc: await probeHttp('http://127.0.0.1:8766/health'),
  jaitts: await probeHttp('http://127.0.0.1:8768/health'),
};

const gpuAtStart = gpuSnapshot();
const ramAtStart = ramSnapshot();
const candidates = [16_384, 32_768, 49_152];
const probes: CtxProbe[] = [];
const prompt = [
  'You are a coding worker. Reply with exactly one word: ready.',
  'Context padding: ' + 'alpha '.repeat(80),
].join('\n');

for (const numCtx of candidates) {
  const probe: CtxProbe = { numCtx, ok: false };
  try {
    probe.cold = await ollamaGenerate({
      baseUrl: config.qwen.baseUrl,
      model: config.qwen.model,
      numCtx,
      keepAlive: '30m',
      gpuLayers: config.qwen.gpuLayers,
      prompt,
    });
    probe.warm = await ollamaGenerate({
      baseUrl: config.qwen.baseUrl,
      model: config.qwen.model,
      numCtx,
      keepAlive: '30m',
      gpuLayers: config.qwen.gpuLayers,
      prompt,
    });
    probe.ok = true;
    probe.gpuAfter = gpuSnapshot();
  } catch (error) {
    probe.error = error instanceof Error ? error.message : String(error);
    probe.gpuAfter = gpuSnapshot();
    probes.push(probe);
    break;
  }
  probes.push(probe);
}

const stable = probes.filter((item) => item.ok);
const recommended = stable.some((item) => item.numCtx === 32768) ? 32768 : (stable[0]?.numCtx ?? 16384);
const report = {
  createdAt: new Date().toISOString(),
  profile: 'DEV_NIGHT',
  agentSlots: 1,
  discord: 'not started by this benchmark',
  services,
  ram: ramAtStart,
  gpuBefore: gpuAtStart,
  ollamaPs: await ollamaPs(config.qwen.baseUrl),
  model: config.qwen.model,
  probes,
  recommendedContextTokens: recommended,
  notes: [
    'Do not assume the largest context is best.',
    'Voice services still reachable: ' + JSON.stringify({ asr: services.asr.ok, rvc: services.rvc.ok, jaitts: services.jaitts.ok }),
    'This benchmark does not start Discord.',
  ],
};

const outDir = path.join(process.cwd(), 'benchmarks');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'dev_night_qwen.json');
fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
console.log('wrote ' + outFile);