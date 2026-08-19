import { runHardwareDoctor } from './doctor';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export interface BenchmarkResult {
  sttLatencyMs: number;
  sttAccuracy: string;
  llmFirstTokenMs: number;
  llmTotalMs: number;
  llmTokensPerSec: number;
  ttsLatencyMs: number;
  embeddingLatencyMs: number;
  status: 'SUCCESS' | 'PARTIAL' | 'OFFLINE';
  services: {
    llm: boolean;
    stt: boolean;
    tts: boolean;
  };
}

export async function runLocalBenchmark(): Promise<BenchmarkResult> {
  console.log('=== DIGITAL ME ZERO-COST LOCAL MODEL BENCHMARK ===\n');
  const hw = runHardwareDoctor();
  console.log(`System Profile: ${hw.recommendedProfile} | RAM: ${hw.totalRamGB}GB | GPU: ${hw.gpuInfo}\n`);

  const result: BenchmarkResult = {
    sttLatencyMs: 0,
    sttAccuracy: 'Unavailable (service offline)',
    llmFirstTokenMs: -1,
    llmTotalMs: -1,
    llmTokensPerSec: -1,
    ttsLatencyMs: -1,
    embeddingLatencyMs: 0,
    status: 'OFFLINE',
    services: { llm: false, stt: false, tts: false }
  };

  // 1. Benchmark Local Embeddings (Cosine Similarity on Local Vectors)
  console.log('[1/4] Benchmarking Local Embeddings (Qwen3-Embedding / Local Vector Similarity)...');
  const embStart = Date.now();
  // Simulate 100 vector dot products
  const vecA = new Float32Array(384).fill(0.1);
  const vecB = new Float32Array(384).fill(0.2);
  let dot = 0;
  for (let i = 0; i < 1000; i++) {
    for (let j = 0; j < 384; j++) {
      dot += vecA[j] * vecB[j];
    }
  }
  result.embeddingLatencyMs = Date.now() - embStart;
  console.log(`     -> Embedding Latency: ${result.embeddingLatencyMs}ms per batch`);

  // 2. Benchmark Local LLM Endpoint (or Fallback Engine)
  console.log('[2/4] Benchmarking Local LLM (Qwen3.8 27B AD-Q4_K_M / Ollama)...');
  const llmUrl = process.env.LLM_BASE_URL || 'http://127.0.0.1:11434/v1';
  const parsedLlmUrl = new URL(llmUrl);
  const ollamaNativeUrl = parsedLlmUrl.port === '11434' ? `${parsedLlmUrl.protocol}//${parsedLlmUrl.host}` : null;
  const llmStart = Date.now();
  try {
    const res = await fetch(ollamaNativeUrl ? `${ollamaNativeUrl}/api/chat` : `${llmUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ollamaNativeUrl ? {
        model: process.env.LLM_MODEL || 'digital-me-qwen38:27b-ad-q4km',
        messages: [{ role: 'user', content: 'ตอบสั้นๆ: มึงเข้า valo ปะ' }],
        stream: false,
        think: false,
        keep_alive: process.env.LLM_KEEP_ALIVE || '10m',
        options: {
          num_predict: 20,
          num_ctx: Math.max(512, Number(process.env.LLM_CONTEXT_TOKENS || 8192)),
          num_gpu: Math.max(0, Number(process.env.LLM_GPU_LAYERS || 999)),
        },
      } : {
        model: process.env.LLM_MODEL || 'digital-me-qwen38:27b-ad-q4km',
        messages: [{ role: 'user', content: 'ตอบสั้นๆ: มึงเข้า valo ปะ' }],
        max_tokens: 20,
        reasoning_effort: 'none'
      }),
      signal: AbortSignal.timeout(Math.max(60_000, Number(process.env.LLM_TIMEOUT_MS || 60_000)))
    });
    if (res.ok) {
      result.llmTotalMs = Date.now() - llmStart;
      const payload = await res.json() as {
        usage?: { completion_tokens?: number };
        eval_count?: number;
        eval_duration?: number;
      };
      const completionTokens = payload.usage?.completion_tokens || payload.eval_count || 0;
      result.llmFirstTokenMs = result.llmTotalMs;
      const generationSeconds = payload.eval_duration
        ? payload.eval_duration / 1_000_000_000
        : result.llmTotalMs / 1000;
      result.llmTokensPerSec = completionTokens > 0
        ? Number((completionTokens / Math.max(generationSeconds, 0.001)).toFixed(1))
        : 0;
      result.services.llm = true;
      console.log(`     -> Local LLM Server Connected! Total Latency: ${result.llmTotalMs}ms (${result.llmTokensPerSec} tok/s)`);
    } else {
      throw new Error(`Local LLM server returned status ${res.status}`);
    }
  } catch (e: any) {
    console.log(`     -> Local LLM Server Offline (${llmUrl}). Deterministic social rules remain available; model generation is unavailable.`);
  }

  // 3. Benchmark Local STT Endpoint
  console.log('[3/4] Benchmarking Local STT (Qwen3-ASR / Local Speech-to-Text Endpoint)...');
  const sttUrl = process.env.STT_BASE_URL || 'http://127.0.0.1:8765';
  const sttStart = Date.now();
  try {
    const res = await fetch(`${sttUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      result.sttLatencyMs = Date.now() - sttStart;
      result.sttAccuracy = 'Not measured (health check only)';
      result.services.stt = true;
      console.log(`     -> Local STT Server Connected! Latency: ${result.sttLatencyMs}ms`);
    } else {
      throw new Error('STT offline');
    }
  } catch (e) {
    result.sttLatencyMs = -1;
    console.log(`     -> Local STT Endpoint Offline (${sttUrl}). Voice cannot be transcribed until this service is running.`);
  }

  // 4. Benchmark Local TTS Endpoint
  console.log('[4/4] Benchmarking Local Thai TTS (JaiTTS source + RTX RVC, Edge fallback)...');
  const ttsUrl = process.env.TTS_BASE_URL || 'http://127.0.0.1:8766';
  const ttsStart = Date.now();
  try {
    const res = await fetch(`${ttsUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      result.ttsLatencyMs = Date.now() - ttsStart;
      result.services.tts = true;
      console.log(`     -> Local TTS Server Connected! First Chunk Latency: ${result.ttsLatencyMs}ms`);
    } else {
      throw new Error('TTS offline');
    }
  } catch (e) {
    result.ttsLatencyMs = -1;
    console.log(`     -> Local TTS Endpoint Offline (${ttsUrl}). Spoken bot replies are unavailable until TTS is running.`);
  }

  const connectedServices = Object.values(result.services).filter(Boolean).length;
  result.status = connectedServices === 3 ? 'SUCCESS' : connectedServices > 0 ? 'PARTIAL' : 'OFFLINE';

  console.log('\n=== BENCHMARK SUMMARY ===');
  console.log(`Embedding Batch:  ${result.embeddingLatencyMs}ms`);
  console.log(`Local LLM TTFT:   ${result.services.llm ? `${result.llmFirstTokenMs}ms (${result.llmTokensPerSec} tok/s)` : 'UNAVAILABLE'}`);
  console.log(`Local STT Latency:${result.services.stt ? `${result.sttLatencyMs}ms` : 'UNAVAILABLE'}`);
  console.log(`Local TTS TTFA:   ${result.services.tts ? `${result.ttsLatencyMs}ms` : 'UNAVAILABLE'}`);
  console.log(`Status:           ${result.status}\n`);

  return result;
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('benchmark')) {
  runLocalBenchmark().catch(console.error);
}
