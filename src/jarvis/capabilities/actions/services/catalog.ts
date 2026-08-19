export const JARVIS_SERVICE_IDS = [
  'ollama',
  'qwen-asr',
  'jarvis-tts',
  'rvc',
  'embedding',
  'jarvis-lab',
] as const;

export type JarvisServiceId = (typeof JARVIS_SERVICE_IDS)[number];

export type JarvisServiceCategory = 'model' | 'speech' | 'lab';

export type JarvisServiceLifecycle =
  | 'STOPPED'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'DEGRADED'
  | 'UNKNOWN';

export type JarvisServiceHealth = 'healthy' | 'degraded' | 'offline' | 'unavailable';

export type JarvisServiceRecord = {
  id: JarvisServiceId;
  displayName: string;
  category: JarvisServiceCategory;
  startAllowed: boolean;
  stopAllowed: boolean;
  restartAllowed: boolean;
  optional: boolean;
};

export const JARVIS_SERVICE_CATALOG: readonly JarvisServiceRecord[] = [
  {
    id: 'ollama',
    displayName: 'Ollama / Qwen',
    category: 'model',
    startAllowed: true,
    stopAllowed: true,
    restartAllowed: true,
    optional: false,
  },
  {
    id: 'qwen-asr',
    displayName: 'Qwen ASR',
    category: 'speech',
    startAllowed: true,
    stopAllowed: true,
    restartAllowed: true,
    optional: false,
  },
  {
    id: 'jarvis-tts',
    displayName: 'JaiTTS',
    category: 'speech',
    startAllowed: true,
    stopAllowed: true,
    restartAllowed: true,
    optional: true,
  },
  {
    id: 'rvc',
    displayName: 'RVC',
    category: 'speech',
    startAllowed: true,
    stopAllowed: true,
    restartAllowed: true,
    optional: true,
  },
  {
    id: 'embedding',
    displayName: 'Embeddings',
    category: 'model',
    startAllowed: false,
    stopAllowed: false,
    restartAllowed: false,
    optional: true,
  },
  {
    id: 'jarvis-lab',
    displayName: 'Jarvis Lab',
    category: 'lab',
    startAllowed: false,
    stopAllowed: false,
    restartAllowed: false,
    optional: false,
  },
];

export function isJarvisServiceId(value: string): value is JarvisServiceId {
  return (JARVIS_SERVICE_IDS as readonly string[]).includes(value);
}

export function serviceRecord(id: string): JarvisServiceRecord | undefined {
  return JARVIS_SERVICE_CATALOG.find(item => item.id === id);
}

export const SERVICE_ALIASES: Record<string, JarvisServiceId> = {
  ollama: 'ollama',
  qwen: 'ollama',
  llm: 'ollama',
  'qwen-asr': 'qwen-asr',
  asr: 'qwen-asr',
  stt: 'qwen-asr',
  'jarvis-tts': 'jarvis-tts',
  tts: 'jarvis-tts',
  jaitts: 'jarvis-tts',
  rvc: 'rvc',
  embedding: 'embedding',
  embeddings: 'embedding',
  'jarvis-lab': 'jarvis-lab',
  lab: 'jarvis-lab',
  'ระบบเสียง': 'qwen-asr',
  'voice stack': 'qwen-asr',
  'voice system': 'qwen-asr',
};
