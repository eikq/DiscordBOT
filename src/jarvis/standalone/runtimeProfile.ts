/**
 * Runtime profiles for local Qwen.
 *
 * `voice` (start:local): cap LLM GPU layers so ASR + JaiTTS + RVC coexist.
 * `interactive` (JARVIS_STANDALONE=1 lab): keep Qwen warm; do not reserve TTS/RVC.
 *
 * Does not raise GPU layers. Does not change start:local.
 */
export type JarvisRuntimeProfileId = 'voice' | 'interactive';

export type JarvisRuntimeProfile = {
  id: JarvisRuntimeProfileId;
  keepAlive: string | number;
  contextTokens: number;
  timeoutMs: number;
  gpuLayers: number;
  voiceGpuCapApplied: boolean;
};

const VOICE_KEEP_ALIVE_DEFAULT = '10m';
const INTERACTIVE_KEEP_ALIVE_DEFAULT = '30m';
const INTERACTIVE_CONTEXT_DEFAULT = 4096;
const VOICE_CONTEXT_DEFAULT = 8192;

export function resolveJarvisRuntimeProfileId(env: NodeJS.ProcessEnv = process.env): JarvisRuntimeProfileId {
  const explicit = env.JARVIS_PROFILE?.trim().toLowerCase();
  if (explicit === 'interactive' || explicit === 'voice') return explicit;
  return env.JARVIS_STANDALONE === '1' ? 'interactive' : 'voice';
}

/**
 * Apply interactive env defaults for the standalone lab.
 * start:local must not call this; it keeps the voice coexistence cap.
 */
export function applyJarvisInteractiveProfile(env: NodeJS.ProcessEnv = process.env): JarvisRuntimeProfile {
  env.JARVIS_PROFILE = 'interactive';
  const keepAlive = env.JARVIS_INTERACTIVE_KEEP_ALIVE?.trim()
    || (env.LLM_KEEP_ALIVE?.trim() === VOICE_KEEP_ALIVE_DEFAULT || !env.LLM_KEEP_ALIVE?.trim()
      ? INTERACTIVE_KEEP_ALIVE_DEFAULT
      : env.LLM_KEEP_ALIVE.trim());
  env.LLM_KEEP_ALIVE = String(keepAlive);

  const context = readPositive(env.JARVIS_INTERACTIVE_CONTEXT_TOKENS, INTERACTIVE_CONTEXT_DEFAULT);
  if (!env.JARVIS_KEEP_VOICE_CONTEXT) {
    env.LLM_CONTEXT_TOKENS = String(context);
  }

  const timeout = readPositive(env.JARVIS_INTERACTIVE_TIMEOUT_MS, 120_000);
  const currentTimeout = readPositive(env.LLM_TIMEOUT_MS, 60_000);
  if (currentTimeout < timeout) env.LLM_TIMEOUT_MS = String(timeout);

  return describeJarvisRuntimeProfile(env);
}

export function describeJarvisRuntimeProfile(env: NodeJS.ProcessEnv = process.env): JarvisRuntimeProfile {
  const id = resolveJarvisRuntimeProfileId(env);
  return {
    id,
    keepAlive: env.LLM_KEEP_ALIVE?.trim() || (id === 'interactive' ? INTERACTIVE_KEEP_ALIVE_DEFAULT : VOICE_KEEP_ALIVE_DEFAULT),
    contextTokens: readPositive(env.LLM_CONTEXT_TOKENS, id === 'interactive' ? INTERACTIVE_CONTEXT_DEFAULT : VOICE_CONTEXT_DEFAULT),
    timeoutMs: readPositive(env.LLM_TIMEOUT_MS, 60_000),
    gpuLayers: Math.max(0, Number(env.LLM_GPU_LAYERS || 999)),
    voiceGpuCapApplied: false,
  };
}

function readPositive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
