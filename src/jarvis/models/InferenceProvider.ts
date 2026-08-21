import type {
  InferenceGenerateRequest,
  InferenceGenerateResult,
  InferenceHealth,
  InferenceMetrics,
  ModelProfile,
} from './types';

export interface InferenceProvider {
  readonly id: string;
  health(): Promise<InferenceHealth>;
  generate(request: InferenceGenerateRequest): Promise<InferenceGenerateResult>;
  stream(request: InferenceGenerateRequest): AsyncIterable<string>;
  modelInfo(): Promise<ModelProfile | undefined>;
  metrics(): InferenceMetrics;
  embed?(input: string[]): Promise<number[][]>;
  vision?(input: { prompt: string; image: Uint8Array; mimeType: string }): Promise<InferenceGenerateResult>;
}
