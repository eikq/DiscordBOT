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
  job?: {
    id: string;
    status: 'queued' | 'training' | 'ready' | 'failed';
    message?: string;
  } | null;
}

export class ColabVoiceClient {
  public isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiToken);
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

  public async startTraining(userId: string, displayName: string): Promise<VoiceTrainingStatus> {
    return await this.requestJson('/v1/train', {
      speakerId: userId,
      displayName,
      force: true,
    }) as VoiceTrainingStatus;
  }

  public async getStatus(userId: string): Promise<VoiceTrainingStatus> {
    return await this.request(`/v1/speakers/${encodeURIComponent(userId)}`, {
      method: 'GET',
    }, 15_000) as VoiceTrainingStatus;
  }

  public async deleteSpeaker(userId: string): Promise<{ deleted: boolean }> {
    return await this.request(`/v1/speakers/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }, 30_000) as { deleted: boolean };
  }

  public async listVoices(): Promise<VoiceTrainingStatus[]> {
    const response = await this.request('/v1/speakers', { method: 'GET' }, 15_000) as { speakers?: VoiceTrainingStatus[] };
    return response.speakers ?? [];
  }

  private get baseUrl(): string {
    return (process.env.COLAB_VOICE_URL || process.env.COLAB_TTS_URL || '').trim().replace(/\/$/, '');
  }

  private get apiToken(): string {
    return (process.env.COLAB_API_TOKEN || '').trim();
  }

  private async requestJson(route: string, body: unknown): Promise<unknown> {
    return await this.request(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 30_000);
  }

  private async request(route: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    if (!this.baseUrl) throw new Error('COLAB_VOICE_URL or COLAB_TTS_URL is not configured.');
    if (!this.apiToken) throw new Error('COLAB_API_TOKEN is not configured.');

    const response = await fetch(`${this.baseUrl}${route}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${this.apiToken}`,
      },
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
      throw new Error(`Colab voice service: ${detail}`);
    }
    return payload;
  }
}
