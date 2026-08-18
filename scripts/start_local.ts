import { runHardwareDoctor } from './doctor';
import { runLocalBenchmark } from './benchmark';
import dotenv from 'dotenv';
import { attachVoiceServiceShutdown, startLocalVoiceService, warmLocalVoiceService } from './local_voice_process';
import { startLocalSttService } from './local_stt_process';
import { startLocalLlmService } from './local_llm_process';
import { startLocalJaiTtsService } from './local_jaitts_process';

dotenv.config({ quiet: true });

async function dashboardIsAlreadyRunning(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:3000/api/health', {
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return false;
    const payload = await response.json() as { status?: string };
    return payload.status === 'ok';
  } catch {
    return false;
  }
}

function reserveGpuForLiveVoice(): void {
  const requested = Number(process.env.LLM_GPU_LAYERS || 999);
  const voiceSafeMaximum = Number(process.env.LLM_VOICE_GPU_LAYERS || 48);
  const safeRequested = Number.isFinite(requested) && requested >= 0 ? Math.floor(requested) : 999;
  const safeMaximum = Number.isFinite(voiceSafeMaximum) && voiceSafeMaximum >= 0
    ? Math.floor(voiceSafeMaximum)
    : 48;
  const selected = Math.min(safeRequested, safeMaximum);
  process.env.LLM_GPU_LAYERS = String(selected);
  console.log(`[Launcher] Qwen GPU offload capped at ${selected} layers so ASR, JaiTTS, and RVC can remain resident.`);
}

async function startLocalZeroCostSystem() {
  console.log('====================================================');
  console.log('   DIGITAL ME — ZERO-COST LOCAL LAUNCHER           ');
  console.log('====================================================\n');

  if (await dashboardIsAlreadyRunning()) {
    console.log('[Launcher] Digital Me is already running at http://127.0.0.1:3000.');
    console.log('[Launcher] Nothing else needs to be started.\n');
    return;
  }

  let localVoiceUrl = '';

  // 1. Start the authenticated local RVC service before the bot begins capturing samples.
  try {
    const voiceService = await startLocalVoiceService();
    localVoiceUrl = voiceService.url;
    attachVoiceServiceShutdown(voiceService.child);
  } catch (error) {
    throw new Error(`Local voice service could not start: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Load the expressive Thai source model. RVC falls back to Edge-TTS if this optional service fails.
  try {
    const jaiTtsService = await startLocalJaiTtsService();
    process.env.JAITTS_ENABLED = jaiTtsService.ready ? 'true' : 'false';
    attachVoiceServiceShutdown(jaiTtsService.child);
  } catch (error) {
    process.env.JAITTS_ENABLED = 'false';
    console.warn(`[JaiTTS] ${error instanceof Error ? error.message : String(error)}`);
    console.warn('[JaiTTS] Continuing with the existing Edge-TTS -> RVC fallback.');
  }

  // 3. Start Thai-English speech recognition before the Discord receiver is created.
  try {
    const sttService = await startLocalSttService();
    attachVoiceServiceShutdown(sttService.child);
  } catch (error) {
    throw new Error(`Local STT service could not start: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 4. Warm the configured Thai-first LLM after reserving space for lazy RVC model loading.
  reserveGpuForLiveVoice();
  const llmService = await startLocalLlmService();
  attachVoiceServiceShutdown(llmService.child);

  // 5. Load the selected voice now so the first live Discord reply is not a 30-second cold start.
  if (localVoiceUrl) await warmLocalVoiceService(localVoiceUrl);

  // 6. Run Hardware Doctor
  const hw = runHardwareDoctor();
  console.log(`[Doctor] Detected Profile: [ ${hw.recommendedProfile} ]`);
  console.log(`[Doctor] System RAM: ${hw.totalRamGB} GB | GPU: ${hw.gpuInfo}`);

  // 7. Run Local Service Benchmark
  await runLocalBenchmark();

  // 8. Start the dashboard. server.ts also connects the bot when a token exists.
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.log('\n[Launcher] ⚡ DISCORD_TOKEN is missing in .env.');
    console.log('[Launcher] Dashboard will start without a Discord connection.');
    console.log('[Launcher] Add DISCORD_TOKEN to .env or paste it into the local dashboard.\n');
  } else {
    console.log('[Launcher] Discord token found; the dashboard will connect the bot.');
  }

  // Local voice use favors stable inference latency over frontend hot reload.
  // This keeps Vite from watching model, dataset, checkpoint, and runtime-log trees.
  process.env.DISABLE_HMR ??= 'true';
  await import('../server');
}

startLocalZeroCostSystem().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
