import { CANONICAL_LLM_BASE_URL, CANONICAL_LLM_MODEL } from '../../bot/llm/canonicalRuntime';
import type { ModelProfile } from './types';

export const QWEN38_CYBER_PROFILE_ID = CANONICAL_LLM_MODEL;
export const QWEN38_CYBER_DISPLAY_NAME = 'Qwen3.8 27B Cyber Abliterated';
export const QWEN38_CYBER_DEFAULT_BASE_URL = CANONICAL_LLM_BASE_URL;
export const QWEN38_CYBER_CONTEXT_WINDOW = 32_768;
export const QWEN38_CYBER_MAX_OUTPUT = 4_096;
export const QWEN38_CYBER_FAMILY = 'Qwen3.8 27B Cyber Abliterated Q4_K_M';

export const QWEN38_CYBER_SPECIALIZATION = [
  'coding',
  'cybersecurity',
  'planning',
  'tool-use',
  'general-assistant',
] as const;

export const QWEN_OFFLINE_OWNER_MESSAGE = 'Qwen local ยังไม่พร้อม ผมยังไม่ได้เริ่มงานนี้';

export function qwen38CyberProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: QWEN38_CYBER_PROFILE_ID,
    displayName: QWEN38_CYBER_DISPLAY_NAME,
    family: QWEN38_CYBER_FAMILY,
    architecture: 'Qwen3.8',
    source: 'local-openai-compatible',
    runtime: 'openai-compatible',
    quantization: 'Q4_K_M',
    parameterCount: 27_000_000_000,
    contextLimits: {
      inputTokens: QWEN38_CYBER_CONTEXT_WINDOW,
      outputTokens: QWEN38_CYBER_MAX_OUTPUT,
    },
    modalities: ['text'],
    structuredOutput: true,
    toolUse: true,
    languages: ['th', 'en'],
    specialization: [...QWEN38_CYBER_SPECIALIZATION],
    certificationState: 'NOT_TESTED',
    ...overrides,
  };
}

export function isQwen38CyberIdentity(value: string | undefined): boolean {
  const id = value?.trim().toLocaleLowerCase() || '';
  return id === QWEN38_CYBER_PROFILE_ID
    || id.startsWith('qwen38-cyber')
    || id.includes('qwen3.8') && id.includes('cyber');
}
