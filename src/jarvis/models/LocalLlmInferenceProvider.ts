import type { LocalLlmProvider } from '../../bot/llm/LocalLlmProvider';
import type { InferenceProvider } from './InferenceProvider';
import { isQwen38CyberIdentity, qwen38CyberProfile } from './qwen38Cyber';
import type {
  InferenceGenerateRequest,
  InferenceGenerateResult,
  InferenceHealth,
  InferenceMetrics,
  ModelProfile,
  ModelRuntime,
} from './types';

export class LocalLlmInferenceProvider implements InferenceProvider {
  private latestMetrics: InferenceMetrics = {};

  public constructor(
    public readonly id: string,
    private readonly provider: LocalLlmProvider,
    private readonly profile?: ModelProfile,
  ) {}

  public async health(): Promise<InferenceHealth> {
    const status = await this.provider.getRuntimeStatus();
    return {
      providerId: this.id,
      available: status.health === 'MODEL_READY',
      modelAvailable: status.modelAvailable === true && status.health === 'MODEL_READY',
      detail: status.ownerMessage || status.error,
    };
  }

  public async generate(request: InferenceGenerateRequest): Promise<InferenceGenerateResult> {
    const result = await this.provider.generateTextDetailed(request);
    this.latestMetrics = result.metrics ? {
      promptTokens: result.metrics.promptTokens,
      outputTokens: result.metrics.outputTokens,
      timeToFirstTokenMs: result.metrics.ttftMs,
      promptTokensPerSecond: result.metrics.promptTokensPerSec,
      generationTokensPerSecond: result.metrics.tokensPerSec,
    } : {};
    return { text: result.text, ...(result.metrics ? { metrics: this.latestMetrics } : {}) };
  }

  public stream(request: InferenceGenerateRequest): AsyncIterable<string> {
    return this.provider.streamText(request);
  }

  public async modelInfo(): Promise<ModelProfile | undefined> {
    if (this.profile) return cloneProfile(this.profile);
    const status = await this.provider.getRuntimeStatus();
    if (!status.model) return undefined;
    return configuredLocalModelProfile({
      id: this.id,
      displayName: status.model,
      runtime: status.provider,
    });
  }

  public metrics(): InferenceMetrics {
    return { ...this.latestMetrics };
  }
}

export function configuredLocalModelProfile(input: {
  id: string;
  displayName: string;
  runtime: ModelRuntime;
}): ModelProfile {
  if (isQwen38CyberIdentity(input.id) || isQwen38CyberIdentity(input.displayName)) {
    return qwen38CyberProfile({
      id: 'qwen38-cyber',
      displayName: input.displayName.includes('Qwen') ? input.displayName : 'Qwen3.8 27B Cyber Abliterated',
      runtime: input.runtime === 'unknown' ? 'openai-compatible' : input.runtime,
    });
  }
  return {
    id: input.id,
    displayName: input.displayName,
    runtime: input.runtime,
    modalities: ['text'],
    certificationState: 'NOT_TESTED',
  };
}

function cloneProfile(profile: ModelProfile): ModelProfile {
  return {
    ...profile,
    modalities: [...profile.modalities],
    ...(profile.languages ? { languages: [...profile.languages] } : {}),
    ...(profile.specialization ? { specialization: [...profile.specialization] } : {}),
  };
}
