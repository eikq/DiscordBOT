import fs from 'node:fs';
import path from 'node:path';

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
  const fromEnv = (process.env.VOICE_API_TOKEN || process.env.COLAB_API_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const saved = fs.readFileSync(path.join(process.cwd(), '.runtime', 'voice_api_token'), 'utf8').trim();
    if (saved.length >= 24) return saved;
  } catch {
    // The launcher writes this file; npm run dev should reuse it.
  }
  return '';
}
