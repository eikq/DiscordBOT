import { VoiceConnectionManager } from '../VoiceConnectionManager';
import { LocalTTSProvider } from './LocalTTSProvider';
import { TTSProvider } from './TTSProvider';

export class VoiceOutputManager {
  private voiceManager: VoiceConnectionManager;
  private ttsProvider: TTSProvider;
  private currentTurnId: string | null = null;
  private activeCancellationTokens: Map<string, boolean> = new Map();

  constructor(voiceManager: VoiceConnectionManager, ttsProvider?: TTSProvider) {
    this.voiceManager = voiceManager;
    this.ttsProvider = ttsProvider || new LocalTTSProvider();
  }

  public async speakTurn(guildId: string, text: string, speakerName?: string): Promise<boolean> {
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.currentTurnId = turnId;
    this.activeCancellationTokens.set(turnId, false);

    console.log(`[VoiceOutputManager] Generating turn speech [${turnId}] (speaker: ${speakerName || 'default'}): "${text}"`);
    const audioBuffer = await this.ttsProvider.synthesize(text, speakerName);

    if (this.isCancelled(turnId)) {
      console.log(`[VoiceOutputManager] Turn [${turnId}] was cancelled before playback.`);
      this.activeCancellationTokens.delete(turnId);
      if (this.currentTurnId === turnId) this.currentTurnId = null;
      return false;
    }

    if (!audioBuffer) {
      this.activeCancellationTokens.delete(turnId);
      if (this.currentTurnId === turnId) this.currentTurnId = null;
      return false;
    }

    console.log(`[VoiceOutputManager] Playing audio for turn [${turnId}]`);
    const played = await this.voiceManager.playAudio(guildId, audioBuffer);
    const cancelled = this.isCancelled(turnId);
    this.activeCancellationTokens.delete(turnId);
    if (this.currentTurnId === turnId) this.currentTurnId = null;
    return played && !cancelled;
  }

  public cancelCurrentTurn(guildId: string): void {
    if (this.currentTurnId) {
      console.log(`[VoiceOutputManager] BARGE-IN DETECTED! Cancelling turn [${this.currentTurnId}]`);
      this.activeCancellationTokens.set(this.currentTurnId, true);
      this.voiceManager.stopAudio(guildId);
      this.currentTurnId = null;
    }
  }

  public isCancelled(turnId: string): boolean {
    return this.activeCancellationTokens.get(turnId) === true;
  }
}
