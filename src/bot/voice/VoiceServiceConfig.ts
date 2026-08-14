export type VoiceBackend = 'local' | 'colab';

export function getVoiceBackend(): VoiceBackend {
  return process.env.VOICE_BACKEND?.trim().toLowerCase() === 'colab' ? 'colab' : 'local';
}

export function getVoiceServiceBaseUrl(): string {
  const explicitUrl = process.env.VOICE_SERVICE_URL?.trim();
  if (explicitUrl) return explicitUrl.replace(/\/$/, '');

  if (getVoiceBackend() === 'local') {
    return (process.env.TTS_BASE_URL?.trim() || 'http://127.0.0.1:8766').replace(/\/$/, '');
  }

  return (process.env.COLAB_VOICE_URL || process.env.COLAB_TTS_URL || '').trim().replace(/\/$/, '');
}

export function getVoiceServiceApiToken(): string {
  return (process.env.VOICE_API_TOKEN || process.env.COLAB_API_TOKEN || '').trim();
}
