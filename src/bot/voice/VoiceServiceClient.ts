import { getVoiceServiceApiToken, getVoiceServiceBaseUrl } from './VoiceServiceConfig';

export interface VoiceSampleUpload {
  guildId: string;
  userId: string;
  displayName: string;
  filename: string;
  wavBuffer: Buffer;
}

export interface VoiceTrainingStatus {
  speakerId: string;
  displayName?: string;
  sampleCount: number;
  durationSeconds: number;
  modelReady: boolean;
  activeModelVersionId?: string | null;
  activeModelLabel?: string | null;
  checkpointSelection?: {
    active: 'best' | 'latest';
    bestEpoch?: number | null;
    bestScore?: number | null;
    latestEpoch?: number | null;
    metric?: string | null;
  } | null;
  availableModels?: {
    best: boolean;
    latest: boolean;
  };
  job?: {
    id: string;
    status: 'queued' | 'training' | 'stopping' | 'ready' | 'failed';
    message?: string;
    trainingMode?: 'fresh' | 'finetune';
    modelSelection?: 'best' | 'latest' | null;
    epochs?: number;
    completedEpochs?: number | null;
    datasetVersionId?: string | null;
    learningSessionId?: string | null;
    modelLabel?: string | null;
    currentEpoch?: number | null;
    stopAfterEpoch?: number | null;
    stopRequested?: boolean;
  } | null;
  modelVersions?: Array<{
    id: string;
    isCurrent: boolean;
    label?: string;
    createdAt: number;
    finishedAt?: number | null;
    trainingMode: 'fresh' | 'finetune';
    baseModelSelection?: 'best' | 'latest' | null;
    epochs: number;
    bestEpoch?: number | null;
    bestScore?: number | null;
    latestEpoch?: number | null;
    datasetVersionId?: string | null;
    learningSessionId?: string | null;
    availableModels?: {
      best: boolean;
      latest: boolean;
    };
  }>;
}

export interface VoiceTrainingOptions {
  trainingMode: 'fresh' | 'finetune';
  modelSelection: 'best' | 'latest';
  epochs: number;
  datasetVersionId?: string;
  learningSessionId?: string;
  modelLabel?: string;
}

export interface VoiceTrainingExportOptions extends VoiceTrainingOptions {
  trainingTarget: 'vast_24gb' | 'laptop_4050_6gb';
  includeDataset: boolean;
  includeTranscripts: boolean;
  includeBestModel: boolean;
  includeLatestModel: boolean;
  includeTrainingLogs: boolean;
  includeTrainer: boolean;
  cleanAudio: boolean;
  excludeLowQuality: boolean;
}

export interface VoiceTrainingExportPreview {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  recommendations: string[];
  summary: {
    speakerId: string;
    displayName?: string;
    sampleCount: number;
    durationSeconds: number;
    transcriptCount: number;
    bestModelAvailable: boolean;
    latestModelAvailable: boolean;
  };
  options: VoiceTrainingExportOptions;
  commandScript: string;
  command: string;
}

export class VoiceServiceClient {
  public isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiToken);
  }

  public async health(): Promise<{
    status: string;
    rvcInstalled: boolean;
    cudaAvailable?: boolean;
    cudaDevice?: string | null;
  }> {
    const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Voice service health check failed with HTTP ${response.status}.`);
    return await response.json() as {
      status: string;
      rvcInstalled: boolean;
      cudaAvailable?: boolean;
      cudaDevice?: string | null;
    };
  }

  public async uploadSample(sample: VoiceSampleUpload): Promise<VoiceTrainingStatus> {
    const response = await this.request('/v1/samples', {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/wav',
        'X-Discord-User-Id': sample.userId,
        'X-Discord-Guild-Id': sample.guildId,
        'X-Display-Name-B64': Buffer.from(sample.displayName, 'utf8').toString('base64'),
        'X-Filename': sample.filename,
      },
      body: sample.wavBuffer,
    }, 30_000);
    return response as VoiceTrainingStatus;
  }

  public async startTraining(
    userId: string,
    displayName: string,
    options: VoiceTrainingOptions = { trainingMode: 'fresh', modelSelection: 'best', epochs: 100 },
  ): Promise<VoiceTrainingStatus> {
    return await this.requestJson('/v1/train', {
      speakerId: userId,
      displayName,
      ...options,
    }) as VoiceTrainingStatus;
  }

  public async getStatus(userId: string): Promise<VoiceTrainingStatus> {
    return await this.request(`/v1/speakers/${encodeURIComponent(userId)}`, { method: 'GET' }, 15_000) as VoiceTrainingStatus;
  }

  public async stopTrainingAfterCurrentEpoch(userId: string): Promise<VoiceTrainingStatus> {
    return await this.requestJson('/v1/train/stop', {
      speakerId: userId,
    }) as VoiceTrainingStatus;
  }

  public async selectActiveModel(
    userId: string,
    modelSelection: 'best' | 'latest',
    modelVersionId?: string,
  ): Promise<VoiceTrainingStatus> {
    return await this.requestJson('/v1/models/select', {
      speakerId: userId,
      modelSelection,
      modelVersionId,
    }) as VoiceTrainingStatus;
  }

  public async deleteSpeaker(userId: string): Promise<{ deleted: boolean }> {
    return await this.request(`/v1/speakers/${encodeURIComponent(userId)}`, { method: 'DELETE' }, 30_000) as { deleted: boolean };
  }

  public async listVoices(): Promise<VoiceTrainingStatus[]> {
    const response = await this.request('/v1/speakers', { method: 'GET' }, 15_000) as { speakers?: VoiceTrainingStatus[] };
    return response.speakers ?? [];
  }

  public async previewTrainingExport(
    userId: string,
    options: VoiceTrainingExportOptions,
  ): Promise<VoiceTrainingExportPreview> {
    return await this.requestJson('/v1/exports/preview', {
      speakerId: userId,
      ...options,
    }, 60_000) as VoiceTrainingExportPreview;
  }

  public async createTrainingExport(
    userId: string,
    options: VoiceTrainingExportOptions,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string; headers: Headers }> {
    if (!this.baseUrl) throw new Error('VOICE_SERVICE_URL is not configured.');
    if (!this.apiToken) throw new Error('VOICE_API_TOKEN is not configured.');
    const response = await fetch(`${this.baseUrl}/v1/exports`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ speakerId: userId, ...options }),
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { detail?: unknown };
      throw new Error(`Voice service: ${String(payload.detail || `HTTP ${response.status}`)}`);
    }
    const disposition = response.headers.get('content-disposition') || '';
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const filename = encoded ? decodeURIComponent(encoded) : plain || `digital-me-${userId}-vast.zip`;
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      filename,
      contentType: response.headers.get('content-type') || 'application/zip',
      headers: response.headers,
    };
  }

  private get baseUrl(): string {
    return getVoiceServiceBaseUrl();
  }

  private get apiToken(): string {
    return getVoiceServiceApiToken();
  }

  private async requestJson(route: string, body: unknown, timeoutMs = 30_000): Promise<unknown> {
    return await this.request(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
  }

  private async request(route: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    if (!this.baseUrl) throw new Error('VOICE_SERVICE_URL is not configured.');
    if (!this.apiToken) throw new Error('VOICE_API_TOKEN is not configured.');

    const response = await fetch(`${this.baseUrl}${route}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${this.apiToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = { message: text.slice(0, 500) }; }
    }
    if (!response.ok) {
      const detail = typeof payload === 'object' && payload && 'detail' in payload
        ? String((payload as { detail: unknown }).detail)
        : `HTTP ${response.status}`;
      throw new Error(`Voice service: ${detail}`);
    }
    return payload;
  }
}
